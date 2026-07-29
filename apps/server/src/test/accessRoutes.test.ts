import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { ApiResponse, FilesystemAccessState } from "@socrates/contracts"
import { buildServer } from "../app"

const cleanup: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

describe("filesystem access HTTP contract", () => {
  it("persists selected paths and explicit Full access through the shared global routes", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-access-http-"))
    const selectedPath = path.join(home, "selected")
    fs.mkdirSync(selectedPath)
    cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }))
    const app = await buildServer({ dbPath: path.join(home, "socrates.sqlite"), socratesHome: home })
    cleanup.push(() => app.close())

    expect((await app.inject({ method: "POST", url: "/api/onboarding", payload: { displayName: "Access Test" } })).statusCode).toBe(200)
    const initial = (await app.inject({ method: "GET", url: "/api/access" })).json<ApiResponse<FilesystemAccessState>>()
    expect(initial).toMatchObject({ ok: true, data: { mode: "selected", roots: [] } })

    const added = (await app.inject({
      method: "POST",
      url: "/api/access/paths",
      payload: { path: selectedPath, label: "Selected" },
    })).json<ApiResponse<{ access: FilesystemAccessState; root: { id: string; path: string } }>>()
    expect(added).toMatchObject({ ok: true, data: { access: { mode: "selected" }, root: { path: fs.realpathSync.native(selectedPath) } } })
    if (!added.ok) throw new Error("Expected selected path to be added.")

    const full = (await app.inject({ method: "PATCH", url: "/api/access", payload: { mode: "full" } })).json<ApiResponse<FilesystemAccessState>>()
    expect(full).toMatchObject({ ok: true, data: { mode: "full" } })

    const removed = (await app.inject({ method: "DELETE", url: `/api/access/paths/${added.data.root.id}` })).json<ApiResponse<{ access: FilesystemAccessState }>>()
    expect(removed).toMatchObject({ ok: true, data: { access: { mode: "full", roots: [] } } })
  })
})
