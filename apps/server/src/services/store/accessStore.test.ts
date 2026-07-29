import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { openDatabase, runMigrations, type DatabaseHandle } from "../../db/client"
import { projectWorkspaces, projects, users } from "../../db/schema"
import { AccessStore } from "./accessStore"

const handles: DatabaseHandle[] = []
const roots: string[] = []

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const setup = () => {
  const handle = openDatabase(":memory:")
  handles.push(handle)
  runMigrations(handle)
  const now = "2026-07-29T12:00:00.000Z"
  handle.db.insert(users).values({
    id: "user_test",
    displayName: "Test User",
    onboardingCompleted: true,
    createdAt: now,
    updatedAt: now,
  }).run()
  return { handle, now, store: new AccessStore({ handle, appendEvent: () => undefined }) }
}

const tempRoot = (name: string): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `socrates-access-${name}-`))
  roots.push(root)
  return root
}

describe("AccessStore", () => {
  it("imports legacy project workspaces once and creates an immutable turn snapshot", () => {
    const { handle, now, store } = setup()
    const workspacePath = tempRoot("legacy")
    handle.db.insert(projects).values({
      id: "proj_test",
      userId: "user_test",
      name: "Legacy project",
      status: "active",
      createdAt: now,
      updatedAt: now,
    }).run()
    handle.db.insert(projectWorkspaces).values({
      id: "pws_test",
      projectId: "proj_test",
      kind: "existing_folder",
      path: workspacePath,
      isPrimary: true,
      status: "active",
      createdAt: now,
      updatedAt: now,
    }).run()

    const state = store.getState()
    expect(state.mode).toBe("selected")
    expect(state.roots).toEqual([
      expect.objectContaining({ path: fs.realpathSync.native(workspacePath), source: "legacy_project", isDefault: true }),
    ])
    expect(store.getState().roots).toHaveLength(1)

    const snapshot = store.createTurnSnapshot("turn_test", workspacePath)
    expect(snapshot).toMatchObject({ mode: "selected", workingRootPath: fs.realpathSync.native(workspacePath) })
    store.setMode("full")
    expect(store.createTurnSnapshot("turn_test", workspacePath)).toEqual(snapshot)
    expect(store.createTurnSnapshot("turn_next", workspacePath).mode).toBe("full")
  })

  it("adds, selects, revokes, and safely re-adds canonical roots", () => {
    const { store } = setup()
    const first = tempRoot("first")
    const second = tempRoot("second")

    const addedFirst = store.addRoot({ path: first, label: "First" })
    expect(addedFirst.root).toMatchObject({ label: "First", isDefault: true, status: "active" })
    const addedSecond = store.addRoot({ path: second, label: "Second" })
    expect(addedSecond.access.roots).toHaveLength(2)

    expect(store.updateRoot(addedSecond.root.id, { isDefault: true }).root.isDefault).toBe(true)
    const removed = store.removeRoot(addedSecond.root.id)
    expect(removed.access.roots).toHaveLength(1)
    expect(removed.access.roots[0]?.isDefault).toBe(true)

    const readded = store.addRoot({ path: second, label: "Second again" })
    expect(readded.root.id).toBe(addedSecond.root.id)
    expect(readded.root).toMatchObject({ label: "Second again", status: "active", source: "user" })
  })

  it("never selects a missing legacy root as the working path", () => {
    const { handle, now, store } = setup()
    const parent = tempRoot("missing")
    const missingPath = path.join(parent, "moved-away")
    handle.db.insert(projects).values({
      id: "proj_missing",
      userId: "user_test",
      name: "Missing legacy project",
      status: "active",
      createdAt: now,
      updatedAt: now,
    }).run()
    handle.db.insert(projectWorkspaces).values({
      id: "pws_missing",
      projectId: "proj_missing",
      kind: "existing_folder",
      path: missingPath,
      isPrimary: true,
      status: "missing",
      createdAt: now,
      updatedAt: now,
    }).run()

    const root = store.getState().roots[0]
    expect(root).toMatchObject({ path: missingPath, status: "missing", isDefault: false })
    expect(() => store.updateRoot(root!.id, { isDefault: true })).toThrowError(/available selected path/)
  })
})
