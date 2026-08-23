import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"
import type { RuntimeConfig } from "@socrates/contracts"
import type { ToolExecutorContext } from "@socrates/core"
import { initializeCanonicalDatabase } from "../../db/canonicalSchema"
import { CanonicalSocratesStore } from "./canonicalSocratesStore"
import { createCanonicalToolExecutors } from "./canonicalToolExecutors"

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })))

const runtimeConfig: RuntimeConfig = {
  providerId: "openrouter",
  modelId: "deepseek/deepseek-v4-pro",
  authMode: "api_key",
  thinkingEnabled: false,
  approvalMode: "manual",
  sandboxMode: "workspace_write",
}

describe("canonical tool executors", () => {
  it("uses task resource bindings for working context while keeping reads global and repo-local .socrates unavailable", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-canonical-tools-"))
    roots.push(root)
    const resourceRoot = path.join(root, "confirmed-resource")
    const globallyReadable = path.join(root, "globally-readable.txt")
    fs.mkdirSync(resourceRoot)
    fs.writeFileSync(path.join(resourceRoot, "README.md"), "before\n")
    fs.writeFileSync(globallyReadable, "global read\n")
    fs.mkdirSync(path.join(resourceRoot, ".socrates"))
    fs.writeFileSync(path.join(resourceRoot, ".socrates", "MEMORY.md"), "legacy state")

    const database = new Database(path.join(root, "socrates.sqlite"))
    initializeCanonicalDatabase(database)
    const store = new CanonicalSocratesStore(database)
    const task = store.createRootTask({
      content: "Inspect the confirmed resource",
      access: { mode: "selected", revision: 1, roots: [{ id: "root_1", label: "unrelated write root", path: path.join(root, "selected-only") }] },
    })
    const bound = store.bindTaskToGoal({ taskId: task.id, decision: "new", title: "Inspect resource" })
    store.bindConfirmedResource({ ownerKind: "task", ownerId: task.id, requestedPath: resourceRoot, confirmedBy: "explicit_path" })
    const scope = store.getTaskExecutionScope(task.id)
    const executors = createCanonicalToolExecutors({ store, taskId: task.id, filesystemAuthorization: scope.filesystemAuthorization })
    const context = {
      projectId: "",
      conversationId: "",
      sessionId: task.id,
      turnId: task.id,
      workspacePath: resourceRoot,
      filesystemAuthorization: scope.filesystemAuthorization,
      runtimeConfig,
    } satisfies ToolExecutorContext

    expect(scope.resources).toMatchObject([{ canonicalPath: fs.realpathSync.native(resourceRoot) }])
    expect((await executors.read({ path: "README.md" }, context)).content).toBe("before\n")
    // Reads never require a selected root. The selected root remains only an
    // authorization input to core's write policy.
    expect((await executors.read({ path: globallyReadable }, context)).content).toBe("global read\n")
    await expect(executors.read({ path: ".socrates/MEMORY.md" }, context)).rejects.toMatchObject({ code: "repo_local_socrates_ignored" })
    await expect(executors.bash({ operation: "run", command: "pwd" }, context)).rejects.toMatchObject({ code: "canonical_terminal_runner_required" })

    const first = await executors.memory_note?.({ note: "The resource uses a README.", importance: "normal" }, context)
    const repeat = await executors.memory_note?.({ note: "The resource uses a README.", importance: "normal" }, context)
    const second = await executors.memory_note?.({ note: "Use exact resource paths.", importance: "high" }, context)
    expect(first).toMatchObject({ noteNumber: 1, result: "created" })
    expect(repeat).toMatchObject({ noteNumber: 1, result: "already_recorded" })
    expect(second).toMatchObject({ noteNumber: 2, result: "created" })
    expect(database.prepare("SELECT COUNT(*) AS count FROM background_jobs WHERE kind = 'global_memory'").get()).toEqual({ count: 2 })
    expect(database.prepare("SELECT goal_id FROM tasks WHERE id = ?").get(task.id)).toEqual({ goal_id: bound.goalId })
    database.close()
  })
})
