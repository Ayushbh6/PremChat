import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify from "fastify"
import Database from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"
import { initializeCanonicalDatabase } from "../db/canonicalSchema"
import { CanonicalSocratesStore } from "../services/canonical/canonicalSocratesStore"
import { registerCanonicalSocratesRoutes } from "./canonicalSocratesRoutes"

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })))

const fixture = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-canonical-routes-"))
  roots.push(root)
  const database = new Database(path.join(root, "socrates.sqlite"))
  initializeCanonicalDatabase(database)
  const store = new CanonicalSocratesStore(database)
  const app = Fastify()
  await registerCanonicalSocratesRoutes(app, { store, socratesHome: root })
  return { root, database, store, app }
}

describe("canonical global Socrates routes", () => {
  it("hydrates only canonical goal/task state and exposes exact exchange pages", async () => {
    const { database, store, app } = await fixture()
    const before = await app.inject({ method: "POST", url: "/api/socrates/bootstrap", payload: {} })
    expect(before.statusCode).toBe(200)
    expect(before.json()).toMatchObject({ ok: true, data: { snapshot: { goals: [], latestEventSequence: 0 } } })

    const task = store.createRootTask({ content: "Inspect the canonical runtime", access: store.accessForNextTask() })
    const { goalId } = store.bindTaskToGoal({ taskId: task.id, decision: "new", title: "Inspect runtime" })
    store.finalizeTask({ taskId: task.id, answer: "The canonical runtime is active." })

    const goals = await app.inject({ method: "GET", url: "/api/socrates/goals?limit=25" })
    expect(goals.statusCode).toBe(200)
    expect(goals.json()).toMatchObject({ ok: true, data: { goals: [{ id: goalId, title: "Inspect runtime" }] } })

    const exchanges = await app.inject({ method: "GET", url: `/api/socrates/goals/${goalId}/exchanges?limit=25` })
    expect(exchanges.statusCode).toBe(200)
    expect(exchanges.json()).toMatchObject({
      ok: true,
      data: { exchanges: [{ task: { id: task.id, status: "completed" }, userMessage: { content: "Inspect the canonical runtime" }, assistantMessage: { content: "The canonical runtime is active." } }] },
    })
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'conversations'").get()).toBeUndefined()
    await app.close()
    database.close()
  })

  it("binds only explicit resources", async () => {
    const { root, database, store, app } = await fixture()
    const task = store.createRootTask({ content: "Use the fixture", access: store.accessForNextTask() })
    const { goalId } = store.bindTaskToGoal({ taskId: task.id, decision: "new", title: "Use fixture" })
    const resourcePath = path.join(root, "resource")
    fs.mkdirSync(resourcePath)

    const binding = await app.inject({
      method: "POST",
      url: "/api/socrates/resources/bind",
      payload: { ownerKind: "goal", ownerId: goalId, path: resourcePath, confirmedBy: "explicit_path" },
    })
    expect(binding.statusCode).toBe(200)
    const resourceId = binding.json().data.binding.resourceId as string
    const resources = await app.inject({ method: "GET", url: "/api/socrates/resources" })
    expect(resources.json()).toMatchObject({ ok: true, data: { resources: [{ id: resourceId, canonicalPath: fs.realpathSync.native(resourcePath) }] } })

    await app.close()
    database.close()
  })
})
