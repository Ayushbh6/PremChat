import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"
import { initializeCanonicalDatabase } from "../../db/canonicalSchema"
import { CanonicalSocratesStore } from "./canonicalSocratesStore"

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })))

const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-canonical-store-"))
  roots.push(root)
  const database = new Database(path.join(root, "socrates.sqlite"))
  initializeCanonicalDatabase(database, "2026-07-30T00:00:00.000Z")
  return { root, database, store: new CanonicalSocratesStore(database) }
}

describe("CanonicalSocratesStore", () => {
  it("owns exact tasks, goal binding, final atomic state, and resource provenance without legacy rows", () => {
    const { root, database, store } = fixture()
    const task = store.createRootTask({ content: "Inspect this repository", access: { mode: "selected", revision: 2, roots: [] } })
    const bound = store.bindTaskToGoal({ taskId: task.id, decision: "new", title: "Inspect repository" })
    const resourcePath = path.join(root, "resource")
    fs.mkdirSync(resourcePath)
    const initialCanonicalPath = fs.realpathSync.native(resourcePath)
    const binding = store.bindConfirmedResource({ ownerKind: "goal", ownerId: bound.goalId, requestedPath: resourcePath, confirmedBy: "explicit_path" })
    // The task freezes the exact resource location used for this exchange;
    // the goal remains the mutable resource selection for future tasks.
    const nextTask = store.createRootTask({ content: "Continue the repository work", access: { mode: "selected", revision: 3, roots: [{ id: "root_1", label: "write only", path: root }] } })
    store.bindTaskToGoal({ taskId: nextTask.id, decision: "existing", goalId: bound.goalId })
    const executionScope = store.getTaskExecutionScope(nextTask.id)
    expect(executionScope.filesystemAuthorization).toMatchObject({ turnId: nextTask.id, mode: "selected", revision: 3, roots: [{ id: "root_1", label: "write only", path: root }] })
    expect(executionScope.resources).toMatchObject([{ id: binding.resourceId, canonicalPath: initialCanonicalPath }])
    const final = store.finalizeTask({
      taskId: task.id,
      answer: "The repository is ready.",
      capsule: { summary: "Repository inspected.", resourceRefs: [{ resourceId: binding.resourceId }] },
      modelEvidence: { provider: "test" },
    })

    expect(final.status).toBe("completed")
    expect(final.goalId).toBe(bound.goalId)
    expect(database.prepare("SELECT content FROM messages WHERE task_id = ? ORDER BY ordinal").all(task.id)).toEqual([
      { content: "Inspect this repository" }, { content: "The repository is ready." },
    ])
    expect(database.prepare("SELECT foreground_goal_id, active_root_task_id FROM app_state WHERE id = 'global'").get()).toEqual({ foreground_goal_id: bound.goalId, active_root_task_id: null })
    expect(database.prepare("SELECT owner_kind, owner_id, confirmed_by FROM resource_bindings WHERE id = ?").get(binding.bindingId)).toEqual({ owner_kind: "goal", owner_id: bound.goalId, confirmed_by: "explicit_path" })
    expect(database.prepare("SELECT COUNT(*) AS count FROM model_calls WHERE task_id = ?").get(task.id)).toEqual({ count: 1 })
    const movedPath = path.join(root, "resource-moved")
    fs.renameSync(resourcePath, movedPath)
    const relinked = store.relinkResource({ resourceId: binding.resourceId, requestedPath: movedPath, confirmedBy: "relink_confirmation" })
    expect(database.prepare("SELECT canonical_path, valid_to FROM resource_locations WHERE id = ?").get(relinked.locationId)).toEqual({ canonical_path: fs.realpathSync.native(movedPath), valid_to: null })
    expect(database.prepare("SELECT COUNT(*) AS count FROM resource_locations WHERE resource_id = ? AND valid_to IS NOT NULL").get(binding.resourceId)).toEqual({ count: 1 })
    expect(store.getTaskExecutionScope(nextTask.id).resources).toMatchObject([{ id: binding.resourceId, canonicalPath: initialCanonicalPath }])
    database.close()
  })

  it("versions knowledge with scope caps and keeps credentials secret-free while Frontier rejection lasts for the task", () => {
    const { database, store } = fixture()
    const task = store.createRootTask({ content: "Set things up", access: { mode: "full", revision: 1, roots: [] } })
    for (let index = 0; index < 10; index += 1) {
      store.reviseKnowledge({ scope: "global", kind: "rule", stableKey: `rule-${index}`, content: `rule ${index}`, status: "accepted", provenance: { source: "user" }, createdBy: "explicit_user" })
    }
    const pending = store.reviseKnowledge({ scope: "global", kind: "memory", stableKey: "memory-review", content: "Candidate memory", status: "pending", provenance: {}, createdBy: "memory_agent" })
    const accepted = store.reviseKnowledge({ scope: "global", kind: "memory", stableKey: "memory-review", content: "Accepted memory", status: "accepted", provenance: {}, createdBy: "direct_edit" })
    expect(accepted.version).toBe(pending.version + 1)
    expect(() => store.reviseKnowledge({ scope: "global", kind: "rule", stableKey: "rule-overflow", content: "too many", status: "accepted", provenance: {}, createdBy: "explicit_user" })).toThrow(/at most ten/i)
    const credential = store.createInteraction({ taskId: task.id, kind: "credential", prompt: "Provide key", publicPayload: { provider: "openrouter" } })
    store.resolveInteraction({ id: credential, decision: "submitted", publicResolution: { value: "not persisted" } })
    expect(database.prepare("SELECT resolution_json FROM interaction_requests WHERE id = ?").get(credential)).toEqual({ resolution_json: JSON.stringify({ received: true }) })
    const frontier = store.createInteraction({ taskId: task.id, kind: "frontier_approval", prompt: "Use frontier", publicPayload: {} })
    store.resolveInteraction({ id: frontier, decision: "rejected" })
    expect(store.isFrontierRejected(task.id)).toBe(true)
    expect(() => store.createInteraction({ taskId: task.id, kind: "frontier_approval", prompt: "Try again", publicPayload: {} })).toThrow(/remains unavailable/i)
    database.close()
  })

  it("marks interrupted active work as recoverable without manufacturing an answer", () => {
    const { database, store } = fixture()
    const task = store.createRootTask({ content: "Resume me", access: { mode: "selected", revision: 1, roots: [] } })
    expect(store.recoverInterruptedTasks()).toMatchObject([{ id: task.id, status: "recovering" }])
    expect(database.prepare("SELECT COUNT(*) AS count FROM messages WHERE task_id = ? AND role = 'assistant'").get(task.id)).toEqual({ count: 0 })
    expect(store.listEvents().at(-1)).toMatchObject({ taskId: task.id, type: "task.recovery_required" })
    database.close()
  })
})
