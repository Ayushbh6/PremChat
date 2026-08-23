import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"
import { createId, SocratesError } from "@socrates/shared"
import {
  CANONICAL_SCHEMA_MARKER,
  hasCanonicalSchema,
  initializeCanonicalDatabase,
} from "./canonicalSchema"
import {
  createVerifiedCutoverArchive,
  databaseNeedsProductionCutover,
  readVerifiedCutoverArchive,
  type CutoverArchiveRecord,
} from "./cutoverArchive"

/**
 * One-way released-state cutover.  This module deliberately consumes only the
 * verified archive, never a live legacy store, so no old record can become a
 * second active authority while the fresh database is being built.
 */
export type ProductionCutoverStage =
  | "archive_verified"
  | "seed_started"
  | "seeded"
  | "fresh_database_verified"
  | "before_swap"
  | "swapped"
  | "completed"

export type CanonicalSeedSummary = Readonly<{
  settings: number
  accessRoots: number
  knowledgeEntries: number
  capabilities: number
}>

export type ProductionCutoverResult = Readonly<{
  status: "created" | "cut_over" | "already_canonical"
  archive?: CutoverArchiveRecord
  seed: CanonicalSeedSummary
}>

type ProductionCutoverInput = Readonly<{
  databasePath: string
  socratesHome: string
  now?: Date
  /** Test-only deterministic fault injection. It is not exposed by routes. */
  onStage?: (stage: ProductionCutoverStage) => void
}>

type ReleasedRow = Record<string, unknown>

const emptySeed: CanonicalSeedSummary = Object.freeze({ settings: 0, accessRoots: 0, knowledgeEntries: 0, capabilities: 0 })

export const performProductionCutover = (input: ProductionCutoverInput): ProductionCutoverResult => {
  const socratesHome = path.resolve(input.socratesHome)
  const databasePath = path.resolve(input.databasePath)
  assertDatabaseIsInsideHome(databasePath, socratesHome)
  fs.mkdirSync(socratesHome, { recursive: true, mode: 0o700 })
  fs.chmodSync(socratesHome, 0o700)

  if (!fs.existsSync(databasePath)) {
    const created = new Database(databasePath)
    try {
      initializeCanonicalDatabase(created, (input.now ?? new Date()).toISOString())
      assertFreshDatabase(created)
    } finally {
      created.close()
    }
    fs.chmodSync(databasePath, 0o600)
    input.onStage?.("completed")
    return { status: "created", seed: emptySeed }
  }

  if (!databaseNeedsProductionCutover(databasePath)) {
    input.onStage?.("completed")
    return { status: "already_canonical", seed: emptySeed }
  }

  const now = input.now ?? new Date()
  const archive = createVerifiedCutoverArchive({ databasePath, socratesHome, now })
  input.onStage?.("archive_verified")
  // Re-read checks the on-disk manifest and every archived byte immediately
  // before it is treated as the source for the fresh state.
  const verifiedArchive = readVerifiedCutoverArchive(archive.archivePath)
  const releasedDatabasePath = path.join(
    verifiedArchive.archivePath,
    "old-state",
    path.relative(socratesHome, databasePath),
  )
  if (!fs.existsSync(releasedDatabasePath)) {
    throw new SocratesError("cutover_archive_database_missing", "The verified archive does not contain the released Socrates database.")
  }

  const nonce = `${now.getTime()}-${process.pid}`
  const temporaryPath = `${databasePath}.cutover-${nonce}.new`
  const rollbackPath = `${databasePath}.cutover-${nonce}.rollback`
  let swapped = false
  let seed = emptySeed
  try {
    input.onStage?.("seed_started")
    const fresh = new Database(temporaryPath)
    try {
      initializeCanonicalDatabase(fresh, now.toISOString())
      seed = seedFreshCanonicalDatabase({
        fresh,
        releasedDatabasePath,
        archiveRoot: path.join(verifiedArchive.archivePath, "old-state"),
        now: now.toISOString(),
      })
      input.onStage?.("seeded")
      assertFreshDatabase(fresh)
      input.onStage?.("fresh_database_verified")
    } finally {
      fresh.close()
    }
    fs.chmodSync(temporaryPath, 0o600)

    input.onStage?.("before_swap")
    removeReleasedWalFiles(databasePath)
    fs.renameSync(databasePath, rollbackPath)
    try {
      fs.renameSync(temporaryPath, databasePath)
      swapped = true
    } catch (error) {
      fs.renameSync(rollbackPath, databasePath)
      throw error
    }
    input.onStage?.("swapped")
    fs.rmSync(rollbackPath, { force: true })
    input.onStage?.("completed")
    return { status: "cut_over", archive: verifiedArchive, seed }
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true })
    if (swapped && fs.existsSync(rollbackPath)) {
      fs.rmSync(databasePath, { force: true })
      fs.renameSync(rollbackPath, databasePath)
    }
    throw error
  } finally {
    fs.rmSync(temporaryPath, { force: true })
  }
}

const seedFreshCanonicalDatabase = (input: {
  fresh: Database.Database
  releasedDatabasePath: string
  archiveRoot: string
  now: string
}): CanonicalSeedSummary => {
  const released = new Database(input.releasedDatabasePath, { readonly: true, fileMustExist: true })
  try {
    const write = input.fresh.transaction(() => {
      let settings = 0
      let accessRoots = 0
      let knowledgeEntries = 0
      let capabilities = 0
      const saveSetting = (key: string, value: unknown): void => {
        input.fresh.prepare(
          `INSERT INTO settings (key, value_json, revision, created_at, updated_at) VALUES (?, ?, 1, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, revision = excluded.revision, updated_at = excluded.updated_at`,
        ).run(key, JSON.stringify(value), input.now, input.now)
        settings += 1
      }

      saveSetting("schema.marker", CANONICAL_SCHEMA_MARKER)
      const access = seedAccessRoots(released, input.fresh, input.now)
      accessRoots += access.count
      saveSetting("access.state", access.state)

      for (const row of legacyRows(released, "worker_model_settings")) {
        saveSetting(`worker.${text(row.worker_id)}`, workerSettingProjection(row))
      }
      const memoryAgent = legacyRows(released, "memory_agent_global_settings")[0]
      if (memoryAgent) saveSetting("worker.memory_agent", workerSettingProjection(memoryAgent))

      const identity = archivedText(input.archiveRoot, "identity.md")
      const profile = archivedText(input.archiveRoot, "user_profile.md")
      const user = legacyRows(released, "users")[0]
      if (identity.trim()) knowledgeEntries += writeKnowledge(input.fresh, input.now, "identity", "identity", identity, { source: "cutover_archive", path: "identity.md" })
      if (profile.trim()) knowledgeEntries += writeKnowledge(input.fresh, input.now, "profile", "profile", profile, { source: "cutover_archive", path: "user_profile.md" })
      if (!profile.trim() && text(user?.display_name).trim()) {
        knowledgeEntries += writeKnowledge(input.fresh, input.now, "profile", "profile", `User name: ${text(user?.display_name).trim()}`, {
          source: "cutover_archive",
          table: "users",
        })
      }

      for (const rule of extractGlobalRules(profile)) {
        knowledgeEntries += writeKnowledge(input.fresh, input.now, "rule", `rule:${stableKey(rule)}`, rule, {
          source: "cutover_archive",
          path: "user_profile.md",
          explicit: true,
        })
      }
      for (const row of legacyRows(released, "memory_doc_sections").filter((candidate) => text(candidate.scope) === "global")) {
        const content = text(row.content)
        if (!content.trim()) continue
        knowledgeEntries += writeKnowledge(input.fresh, input.now, "memory", `legacy:${stableKey(`${text(row.path)}:${text(row.section_id)}`)}`, content, {
          source: "cutover_archive",
          table: "memory_doc_sections",
          heading: text(row.heading),
          sectionId: text(row.section_id),
        })
      }

      capabilities += seedGlobalSkills(input.fresh, input.archiveRoot, input.now)
      capabilities += seedGlobalMcpConfig(input.fresh, input.archiveRoot, input.now)
      return { settings, accessRoots, knowledgeEntries, capabilities }
    })()
    return write
  } finally {
    released.close()
  }
}

const seedAccessRoots = (released: Database.Database, fresh: Database.Database, now: string): { count: number; state: unknown } => {
  const setting = legacyRows(released, "filesystem_access_settings")[0]
  const mode = ["read_only", "selected", "full"].includes(text(setting?.mode)) ? text(setting?.mode) : "selected"
  const revision = positiveInteger(setting?.revision, 1)
  const seen = new Set<string>()
  let count = 0
  for (const row of legacyRows(released, "filesystem_roots")) {
    const requestedPath = text(row.path)
    if (!requestedPath || seen.has(requestedPath)) continue
    seen.add(requestedPath)
    const status = ["active", "missing", "revoked"].includes(text(row.status)) ? text(row.status) : "missing"
    fresh.prepare(
      `INSERT INTO access_roots (id, label, canonical_path, is_default, status, created_at, updated_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      text(row.id) || createId("fsroot"),
      text(row.label) || path.basename(requestedPath) || requestedPath,
      requestedPath,
      bool(row.is_default) ? 1 : 0,
      status,
      text(row.created_at) || now,
      text(row.updated_at) || now,
      status === "revoked" ? text(row.revoked_at) || now : null,
    )
    count += 1
  }
  return { count, state: { mode, revision, updatedAt: text(setting?.updated_at) || now } }
}

const writeKnowledge = (
  fresh: Database.Database,
  now: string,
  kind: "identity" | "profile" | "rule" | "memory" | "repo_fact",
  stableKeyValue: string,
  content: string,
  provenance: Record<string, unknown>,
): number => {
  const entryId = createId("mdoc")
  const versionId = createId("mdsec")
  fresh.prepare(
    `INSERT INTO knowledge_entries (id, scope_kind, resource_id, kind, stable_key, active_version, created_at, updated_at)
     VALUES (?, 'global', NULL, ?, ?, 1, ?, ?)`,
  ).run(entryId, kind, stableKeyValue, now, now)
  fresh.prepare(
    `INSERT INTO knowledge_versions (id, entry_id, version, status, content_json, provenance_json, created_by, created_at)
     VALUES (?, ?, 1, 'accepted', ?, ?, 'cutover', ?)`,
  ).run(versionId, entryId, JSON.stringify({ content }), JSON.stringify(provenance), now)
  return 1
}

const seedGlobalSkills = (fresh: Database.Database, archiveRoot: string, now: string): number => {
  const archivedSkills = path.join(archiveRoot, "skills", "global")
  if (!fs.existsSync(archivedSkills)) return 0
  let count = 0
  for (const skillPath of findNamedFiles(archivedSkills, "SKILL.md")) {
    const relative = path.relative(archivedSkills, skillPath)
    const name = path.dirname(relative).split(path.sep).join("/")
    const contentHash = sha256(fs.readFileSync(skillPath))
    const capabilityId = createId("socracap")
    fresh.prepare(
      `INSERT INTO capabilities (id, scope_kind, resource_id, kind, name, enabled, active_version, created_at, updated_at)
       VALUES (?, 'global', NULL, 'skill', ?, 1, 1, ?, ?)`,
    ).run(capabilityId, name, now, now)
    fresh.prepare(
      `INSERT INTO capability_versions (id, capability_id, version, content_hash, config_json, approval_provenance_json, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?)`,
    ).run(createId("mdsec"), capabilityId, contentHash, JSON.stringify({ relativePath: `skills/global/${relative.split(path.sep).join("/")}` }), JSON.stringify({ source: "cutover_archive" }), now)
    count += 1
  }
  return count
}

const seedGlobalMcpConfig = (fresh: Database.Database, archiveRoot: string, now: string): number => {
  const configPath = path.join(archiveRoot, "mcp.json")
  if (!fs.existsSync(configPath)) return 0
  let parsed: { servers?: Record<string, unknown>; mcpServers?: Record<string, unknown> }
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as typeof parsed
  } catch {
    return 0
  }
  const servers = parsed.servers ?? parsed.mcpServers ?? {}
  let count = 0
  for (const [name, raw] of Object.entries(servers)) {
    if (!raw || typeof raw !== "object") continue
    const config = raw as Record<string, unknown>
    const capabilityId = createId("socracap")
    const safeConfig = {
      command: text(config.command),
      args: Array.isArray(config.args) ? config.args.filter((value): value is string => typeof value === "string") : [],
      enabled: config.enabled !== false,
      secretBindings: Object.keys(asRecord(config.secretBindings) ?? asRecord(config.env) ?? {}).sort(),
    }
    fresh.prepare(
      `INSERT INTO capabilities (id, scope_kind, resource_id, kind, name, enabled, active_version, created_at, updated_at)
       VALUES (?, 'global', NULL, 'mcp', ?, ?, 1, ?, ?)`,
    ).run(capabilityId, name, safeConfig.enabled ? 1 : 0, now, now)
    fresh.prepare(
      `INSERT INTO capability_versions (id, capability_id, version, content_hash, config_json, approval_provenance_json, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?)`,
    ).run(createId("mdsec"), capabilityId, sha256(Buffer.from(JSON.stringify(safeConfig))), JSON.stringify(safeConfig), JSON.stringify({ source: "cutover_archive", secretValuesPersisted: false }), now)
    count += 1
  }
  return count
}

const assertFreshDatabase = (database: Database.Database): void => {
  const integrity = database.pragma("integrity_check") as Array<{ integrity_check: string }>
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok" || !hasCanonicalSchema(database)) {
    throw new SocratesError("cutover_fresh_database_invalid", "The fresh canonical Socrates database did not pass verification.")
  }
}

const legacyRows = (database: Database.Database, table: string): ReleasedRow[] => {
  if (!hasTable(database, table)) return []
  return database.prepare(`SELECT * FROM ${table}`).all() as ReleasedRow[]
}

const hasTable = (database: Database.Database, table: string): boolean => Boolean(database.prepare(
  "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
).get(table))

const archivedText = (archiveRoot: string, relativePath: string): string => {
  const filePath = path.join(archiveRoot, relativePath)
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : ""
}

const extractGlobalRules = (profile: string): string[] => {
  const heading = /^##\s+Global Always Apply Rules\s*$/im.exec(profile)
  if (!heading || heading.index === undefined) return []
  const following = profile.slice(heading.index + heading[0].length).split(/^##\s+/m, 1)[0] ?? ""
  return following.split(/\r?\n/)
    .map((line) => /^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/.exec(line)?.[1]?.trim())
    .filter((rule): rule is string => Boolean(rule))
    .slice(0, 10)
}

const findNamedFiles = (root: string, name: string): string[] => {
  const result: string[] = []
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile() && entry.name === name) result.push(absolute)
    }
  }
  visit(root)
  return result.sort()
}

const workerSettingProjection = (row: ReleasedRow): Record<string, unknown> => ({
  providerId: text(row.provider_id),
  authMode: text(row.auth_mode) || "api_key",
  modelId: text(row.model_id),
  thinkingEnabled: bool(row.thinking_enabled),
  ...(text(row.thinking_effort) ? { thinkingEffort: text(row.thinking_effort) } : {}),
  ...(typeof row.enabled === "number" || typeof row.enabled === "boolean" ? { enabled: bool(row.enabled) } : {}),
})

const removeReleasedWalFiles = (databasePath: string): void => {
  fs.rmSync(`${databasePath}-wal`, { force: true })
  fs.rmSync(`${databasePath}-shm`, { force: true })
}

const assertDatabaseIsInsideHome = (databasePath: string, socratesHome: string): void => {
  const expected = path.join(socratesHome, "socrates.sqlite")
  if (databasePath !== expected) {
    throw new SocratesError("cutover_database_scope_invalid", "The Socrates database must be the canonical socrates.sqlite file inside the selected Socrates home.")
  }
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const text = (value: unknown): string => typeof value === "string" ? value : ""
const bool = (value: unknown): boolean => value === true || value === 1
const positiveInteger = (value: unknown, fallback: number): number => typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback
const stableKey = (value: string): string => sha256(Buffer.from(value)).slice(0, 24)
const sha256 = (value: Buffer): string => crypto.createHash("sha256").update(value).digest("hex")
