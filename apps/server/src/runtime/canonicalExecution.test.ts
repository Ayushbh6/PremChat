import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"
import type { SocratesAgent, SocratesAgentTurnInput } from "@socrates/core"
import { initializeCanonicalDatabase } from "../db/canonicalSchema"
import { CanonicalSocratesStore } from "../services/canonical/canonicalSocratesStore"
import { executeCanonicalTask } from "./canonicalExecution"

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })))
const config = { providerId: "openrouter" as const, modelId: "deepseek/deepseek-v4-pro", authMode: "api_key" as const, thinkingEnabled: false, approvalMode: "manual" as const, sandboxMode: "workspace_write" as const, contextWindowTokens: 1_048_576 }

describe("canonical foreground execution", () => {
  it("commits the one validated final answer through the canonical task transaction", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-canonical-execution-"))
    roots.push(root)
    const database = new Database(path.join(root, "db.sqlite"))
    initializeCanonicalDatabase(database)
    const store = new CanonicalSocratesStore(database)
    const task = store.createRootTask({ content: "Do it", access: { mode: "selected", revision: 1, roots: [] } })
    const { goalId, task: boundTask } = store.bindTaskToGoal({ taskId: task.id, decision: "new", title: "Do it" })
    const agent = {
      async *streamTurn(input: SocratesAgentTurnInput) {
        const modelCallId = input.createModelCall!({ providerId: "openrouter", modelId: "deepseek/deepseek-v4-pro", runtimeConfig: config, messages: [], estimatedTokens: 12, tokenCount: { providerId: "openrouter", modelId: "deepseek/deepseek-v4-pro", inputTokens: 12, baseTokens: 12, method: "local_tiktoken", safetyMarginPercent: 0 }, tools: [] })
        yield { type: "model.completed", modelCallId, usage: { totalTokens: 12 }, finishReason: "stop" }
        yield { type: "tool.call.started", toolCallId: "tool_1", toolName: "read", category: "file", displayName: "Read", input: { path: "README.md" }, requiresApproval: false }
        yield { type: "tool.call.completed", toolCallId: "tool_1", toolName: "read", output: { content: "ok" }, summary: "Read README." }
        yield { type: "approval.requested", request: { approvalId: "approval_1", toolCallId: "tool_2", toolName: "edit", actionKind: "file_write", title: "Approve edit", actionPreview: "Edit README", risk: "medium" } }
        yield { type: "agent.final_result", result: { finalAnswer: "Done.", goalFinalization: { state: "completed", note: "Completed." } } }
      },
    } as unknown as Pick<SocratesAgent, "streamTurn">
    const completed = await executeCanonicalTask({ store, agent, task: boundTask, goalId, userMessage: "Do it", runtimeConfig: config, workspacePath: root })
    expect(completed.status).toBe("completed")
    expect(database.prepare("SELECT content FROM messages WHERE task_id = ? ORDER BY ordinal DESC LIMIT 1").get(task.id)).toEqual({ content: "Done." })
    expect(database.prepare("SELECT name, status, input_json, output_json FROM tool_calls").get()).toEqual({ name: "read", status: "completed", input_json: JSON.stringify({ path: "README.md" }), output_json: JSON.stringify({ content: "ok" }) })
    expect(database.prepare("SELECT kind, prompt, public_payload_json FROM interaction_requests").get()).toEqual({ kind: "approval", prompt: "Approve edit", public_payload_json: JSON.stringify({ toolName: "edit", actionKind: "file_write", actionPreview: "Edit README", risk: "medium" }) })
    expect(database.prepare("SELECT role, status, usage_json FROM model_calls WHERE task_id = ?").get(task.id)).toEqual({ role: "main", status: "completed", usage_json: JSON.stringify({ totalTokens: 12 }) })
    database.close()
  })

  it("persists a typed failure and clears the active task when no valid final result arrives", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-canonical-execution-failure-"))
    roots.push(root)
    const database = new Database(path.join(root, "db.sqlite"))
    initializeCanonicalDatabase(database)
    const store = new CanonicalSocratesStore(database)
    const task = store.createRootTask({ content: "Fail", access: { mode: "selected", revision: 1, roots: [] } })
    const { goalId, task: boundTask } = store.bindTaskToGoal({ taskId: task.id, decision: "new", title: "Fail" })
    const agent = { async *streamTurn() {} } as unknown as Pick<SocratesAgent, "streamTurn">
    await expect(executeCanonicalTask({ store, agent, task: boundTask, goalId, userMessage: "Fail", runtimeConfig: config, workspacePath: root })).rejects.toThrow(/validated final result/i)
    expect(database.prepare("SELECT status FROM tasks WHERE id = ?").get(task.id)).toEqual({ status: "failed" })
    expect(store.getSnapshot().activeTask).toBeUndefined()
    database.close()
  })
})
