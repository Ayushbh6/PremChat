import fs from "node:fs"
import path from "node:path"
import type {
  AddFilesystemRootRequest,
  AddFilesystemRootResponse,
  FilesystemAccessMode,
  FilesystemAccessState,
  FilesystemAuthorizationSnapshot,
  FilesystemRoot,
  RemoveFilesystemRootResponse,
  UpdateFilesystemRootRequest,
  UpdateFilesystemRootResponse,
} from "@socrates/contracts"
import { createId, nowIso, SocratesError } from "@socrates/shared"
import { and, asc, eq, inArray } from "drizzle-orm"
import { filesystemAccessSettings, filesystemRoots, projectWorkspaces, projects, turnFilesystemAuthorizations, users } from "../../db/schema"
import { StoreBase } from "./shared"

type FilesystemRootRow = typeof filesystemRoots.$inferSelect

const labelForPath = (rootPath: string): string => path.basename(rootPath) || rootPath

const canonicalExistingDirectory = (requestedPath: string): string => {
  if (!path.isAbsolute(requestedPath)) {
    throw new SocratesError("filesystem_root_not_absolute", "Selected paths must be absolute.", {
      recoverable: true,
      details: { path: requestedPath },
    })
  }
  const normalized = path.resolve(requestedPath)
  let stat: fs.Stats
  try {
    stat = fs.statSync(normalized)
  } catch {
    throw new SocratesError("filesystem_root_not_found", "The selected path does not exist.", {
      recoverable: true,
      details: { path: normalized },
    })
  }
  if (!stat.isDirectory()) {
    throw new SocratesError("filesystem_root_not_directory", "The selected path must be a folder.", {
      recoverable: true,
      details: { path: normalized },
    })
  }
  return fs.realpathSync.native(normalized)
}

const canonicalLegacyPath = (workspacePath: string): { path: string; status: "active" | "missing" } => {
  const normalized = path.resolve(workspacePath)
  try {
    const stat = fs.statSync(normalized)
    return stat.isDirectory()
      ? { path: fs.realpathSync.native(normalized), status: "active" }
      : { path: normalized, status: "missing" }
  } catch {
    return { path: normalized, status: "missing" }
  }
}

const mapRoot = (row: FilesystemRootRow): FilesystemRoot => ({
  id: row.id,
  label: row.label,
  path: row.path,
  isDefault: row.isDefault,
  status: row.status as FilesystemRoot["status"],
  source: row.source as FilesystemRoot["source"],
  sourceProjectId: row.sourceProjectId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  revokedAt: row.revokedAt,
})

export class AccessStore extends StoreBase {
  getDefaultWorkingRoot(): string | undefined {
    const user = this.getCurrentUserRow()
    if (!user) return undefined
    this.ensureSettings(user.id)
    this.importLegacyWorkspaces(user.id)
    const roots = this.handle.db
      .select()
      .from(filesystemRoots)
      .where(and(eq(filesystemRoots.userId, user.id), eq(filesystemRoots.status, "active")))
      .orderBy(asc(filesystemRoots.createdAt))
      .all()
    return roots.find((root) => root.isDefault)?.path ?? roots[0]?.path
  }

  getState(): FilesystemAccessState {
    const user = this.requireAccessUser()
    this.ensureSettings(user.id)
    this.importLegacyWorkspaces(user.id)
    return this.stateForUser(user.id)
  }

  setMode(mode: FilesystemAccessMode): FilesystemAccessState {
    const user = this.requireAccessUser()
    this.ensureSettings(user.id)
    this.importLegacyWorkspaces(user.id)
    const now = nowIso()
    this.handle.db
      .update(filesystemAccessSettings)
      .set({ mode, revision: this.currentRevision(user.id) + 1, updatedAt: now })
      .where(eq(filesystemAccessSettings.userId, user.id))
      .run()
    return this.stateForUser(user.id)
  }

  addRoot(input: AddFilesystemRootRequest): AddFilesystemRootResponse {
    const user = this.requireAccessUser()
    this.ensureSettings(user.id)
    const rootPath = canonicalExistingDirectory(input.path)
    const existing = this.handle.db
      .select()
      .from(filesystemRoots)
      .where(and(eq(filesystemRoots.userId, user.id), eq(filesystemRoots.path, rootPath)))
      .get()
    const now = nowIso()
    const shouldBeDefault = input.isDefault ?? this.activeRoots(user.id).length === 0
    if (shouldBeDefault) this.clearDefault(user.id, now)

    let rootId: string
    if (existing) {
      rootId = existing.id
      this.handle.db
        .update(filesystemRoots)
        .set({
          label: input.label ?? existing.label,
          isDefault: shouldBeDefault || existing.isDefault,
          status: "active",
          source: "user",
          sourceProjectId: null,
          updatedAt: now,
          revokedAt: null,
        })
        .where(eq(filesystemRoots.id, existing.id))
        .run()
    } else {
      rootId = createId("fsroot")
      this.handle.db.insert(filesystemRoots).values({
        id: rootId,
        userId: user.id,
        label: input.label ?? labelForPath(rootPath),
        path: rootPath,
        isDefault: shouldBeDefault,
        status: "active",
        source: "user",
        sourceProjectId: null,
        createdAt: now,
        updatedAt: now,
      }).run()
    }
    this.bumpRevision(user.id, now)
    return { access: this.stateForUser(user.id), root: this.mustGetRoot(user.id, rootId) }
  }

  updateRoot(rootId: string, input: UpdateFilesystemRootRequest): UpdateFilesystemRootResponse {
    const user = this.requireAccessUser()
    const existing = this.mustGetRootRow(user.id, rootId)
    if (existing.status === "revoked") {
      throw new SocratesError("filesystem_root_not_found", "Selected path was not found.", { recoverable: true })
    }
    if (input.isDefault === true && existing.status !== "active") {
      throw new SocratesError("filesystem_root_not_active", "Only an available selected path can be the working path.", {
        recoverable: true,
      })
    }
    const now = nowIso()
    if (input.isDefault) this.clearDefault(user.id, now)
    this.handle.db
      .update(filesystemRoots)
      .set({
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        updatedAt: now,
      })
      .where(eq(filesystemRoots.id, rootId))
      .run()
    this.ensureOneDefault(user.id, now)
    this.bumpRevision(user.id, now)
    return { access: this.stateForUser(user.id), root: this.mustGetRoot(user.id, rootId) }
  }

  removeRoot(rootId: string): RemoveFilesystemRootResponse {
    const user = this.requireAccessUser()
    const existing = this.mustGetRootRow(user.id, rootId)
    if (existing.status === "revoked") {
      throw new SocratesError("filesystem_root_not_found", "Selected path was not found.", { recoverable: true })
    }
    const now = nowIso()
    this.handle.db
      .update(filesystemRoots)
      .set({ status: "revoked", isDefault: false, revokedAt: now, updatedAt: now })
      .where(eq(filesystemRoots.id, rootId))
      .run()
    this.ensureOneDefault(user.id, now)
    this.bumpRevision(user.id, now)
    return { access: this.stateForUser(user.id), removedRootId: rootId }
  }

  createTurnSnapshot(turnId: string, workspacePath?: string): FilesystemAuthorizationSnapshot {
    const prior = this.handle.db
      .select()
      .from(turnFilesystemAuthorizations)
      .where(eq(turnFilesystemAuthorizations.turnId, turnId))
      .get()
    if (prior) return this.mapSnapshot(prior)

    const user = this.requireAccessUser()
    const state = this.getState()
    const activeRoots = state.roots.filter((root) => root.status === "active")
    const normalizedWorkspace = workspacePath ? canonicalLegacyPath(workspacePath).path : undefined
    const workingRootPath = normalizedWorkspace && activeRoots.some((root) => root.path === normalizedWorkspace)
      ? normalizedWorkspace
      : activeRoots.find((root) => root.isDefault)?.path ?? activeRoots[0]?.path ?? normalizedWorkspace ?? null
    const now = nowIso()
    const id = createId("fsauth")
    const roots = activeRoots.map(({ id: rootId, label, path: rootPath }) => ({ id: rootId, label, path: rootPath }))
    this.handle.db.insert(turnFilesystemAuthorizations).values({
      id,
      turnId,
      userId: user.id,
      mode: state.mode,
      revision: state.revision,
      rootsJson: JSON.stringify(roots),
      workingRootPath,
      createdAt: now,
    }).run()
    return { id, turnId, mode: state.mode, revision: state.revision, roots, workingRootPath, createdAt: now }
  }

  getTurnSnapshot(turnId: string): FilesystemAuthorizationSnapshot | null {
    const row = this.handle.db
      .select()
      .from(turnFilesystemAuthorizations)
      .where(eq(turnFilesystemAuthorizations.turnId, turnId))
      .get()
    return row ? this.mapSnapshot(row) : null
  }

  private ensureSettings(userId: string): void {
    const existing = this.handle.db
      .select()
      .from(filesystemAccessSettings)
      .where(eq(filesystemAccessSettings.userId, userId))
      .get()
    if (existing) return
    const now = nowIso()
    this.handle.db.insert(filesystemAccessSettings).values({
      userId,
      mode: "selected",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    }).run()
  }

  private requireAccessUser(): typeof users.$inferSelect {
    const user = this.getCurrentUserRow()
    if (!user) throw new SocratesError("user_not_found", "Socrates needs the current user record before configuring filesystem access.")
    return user
  }

  private importLegacyWorkspaces(userId: string): void {
    const rows = this.handle.db
      .select({ projectId: projectWorkspaces.projectId, path: projectWorkspaces.path, projectMetadataJson: projects.metadataJson })
      .from(projectWorkspaces)
      .innerJoin(projects, eq(projects.id, projectWorkspaces.projectId))
      .where(and(
        eq(projects.userId, userId),
        inArray(projectWorkspaces.status, ["active", "missing"]),
        eq(projectWorkspaces.isPrimary, true),
      ))
      .all()
    let changed = false
    for (const row of rows) {
      if (!row.path) continue
      const canonical = canonicalLegacyPath(row.path)
      const existing = this.handle.db
        .select()
        .from(filesystemRoots)
        .where(and(eq(filesystemRoots.userId, userId), eq(filesystemRoots.path, canonical.path)))
        .get()
      if (existing) continue
      const now = nowIso()
      this.handle.db.insert(filesystemRoots).values({
        id: createId("fsroot"),
        userId,
        label: labelForPath(canonical.path),
        path: canonical.path,
        isDefault: canonical.status === "active" && this.activeRoots(userId).length === 0,
        status: canonical.status,
        source: "legacy_project",
        sourceProjectId: row.projectId,
        createdAt: now,
        updatedAt: now,
      }).run()
      changed = true
    }
    if (changed) this.bumpRevision(userId, nowIso())
  }

  private stateForUser(userId: string): FilesystemAccessState {
    const settings = this.handle.db
      .select()
      .from(filesystemAccessSettings)
      .where(eq(filesystemAccessSettings.userId, userId))
      .get()
    if (!settings) throw new SocratesError("filesystem_access_not_found", "Filesystem access settings were not found.")
    const roots = this.handle.db
      .select()
      .from(filesystemRoots)
      .where(and(eq(filesystemRoots.userId, userId), inArray(filesystemRoots.status, ["active", "missing"])))
      .orderBy(asc(filesystemRoots.createdAt))
      .all()
      .map(mapRoot)
    return {
      mode: settings.mode as FilesystemAccessMode,
      revision: settings.revision,
      roots,
      updatedAt: settings.updatedAt,
    }
  }

  private activeRoots(userId: string): FilesystemRootRow[] {
    return this.handle.db
      .select()
      .from(filesystemRoots)
      .where(and(eq(filesystemRoots.userId, userId), eq(filesystemRoots.status, "active")))
      .all()
  }

  private currentRevision(userId: string): number {
    const settings = this.handle.db
      .select({ revision: filesystemAccessSettings.revision })
      .from(filesystemAccessSettings)
      .where(eq(filesystemAccessSettings.userId, userId))
      .get()
    return settings?.revision ?? 1
  }

  private bumpRevision(userId: string, now: string): void {
    this.handle.db
      .update(filesystemAccessSettings)
      .set({ revision: this.currentRevision(userId) + 1, updatedAt: now })
      .where(eq(filesystemAccessSettings.userId, userId))
      .run()
  }

  private clearDefault(userId: string, now: string): void {
    this.handle.db
      .update(filesystemRoots)
      .set({ isDefault: false, updatedAt: now })
      .where(and(eq(filesystemRoots.userId, userId), eq(filesystemRoots.isDefault, true)))
      .run()
  }

  private ensureOneDefault(userId: string, now: string): void {
    const active = this.activeRoots(userId)
    if (active.some((root) => root.isDefault) || !active[0]) return
    this.handle.db
      .update(filesystemRoots)
      .set({ isDefault: true, updatedAt: now })
      .where(eq(filesystemRoots.id, active[0].id))
      .run()
  }

  private mustGetRootRow(userId: string, rootId: string): FilesystemRootRow {
    const row = this.handle.db
      .select()
      .from(filesystemRoots)
      .where(and(eq(filesystemRoots.userId, userId), eq(filesystemRoots.id, rootId)))
      .get()
    if (!row) throw new SocratesError("filesystem_root_not_found", "Selected path was not found.", { recoverable: true })
    return row
  }

  private mustGetRoot(userId: string, rootId: string): FilesystemRoot {
    return mapRoot(this.mustGetRootRow(userId, rootId))
  }

  private mapSnapshot(row: typeof turnFilesystemAuthorizations.$inferSelect): FilesystemAuthorizationSnapshot {
    const roots = JSON.parse(row.rootsJson) as FilesystemAuthorizationSnapshot["roots"]
    return {
      id: row.id,
      turnId: row.turnId,
      mode: row.mode as FilesystemAccessMode,
      revision: row.revision,
      roots,
      workingRootPath: row.workingRootPath,
      createdAt: row.createdAt,
    }
  }
}
