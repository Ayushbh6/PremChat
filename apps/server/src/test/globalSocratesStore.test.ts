import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { SocratesGoalResolutionResult } from "@socrates/core"
import { createId } from "@socrates/shared"
import { openDatabase, runMigrations, type DatabaseHandle } from "../db/client"
import { GlobalSocratesStore } from "../services/socrates/socratesStore"

const handles: DatabaseHandle[] = []
const roots: string[] = []

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const runtimeConfig = {
  providerId: "openrouter" as const,
  authMode: "api_key" as const,
  modelId: "deepseek/deepseek-v4-pro",
  thinkingEnabled: false,
  approvalMode: "manual" as const,
  sandboxMode: "workspace_write" as const,
  contextWindowTokens: 1_048_576,
}

const createDecision = (store: GlobalSocratesStore): SocratesGoalResolutionResult => ({
  decision: { action: "create", title: "Recovery goal" },
  candidates: { parked: [], candidates: [], totalEligibleParked: 0, parkedCandidateLimit: 5 },
  source: "fallback",
  fallbackReason: "invalid_output",
})

describe("GlobalSocratesStore capsules", () => {
  it("replaces a failed capsule after a successful retry clears its recovery question", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-global-store-"))
    roots.push(root)
    const handle = openDatabase(path.join(root, "socrates.sqlite"))
    handles.push(handle)
    runMigrations(handle)
    const store = new GlobalSocratesStore(handle, { globalWorkspacePath: root })
    store.bootstrap()
    expect(store.terminalSupervisorCursorForRecovery("terminal_without_output", 7)).toBe(0)

    const failed = store.createTurn({
      projectId: "global",
      clientMessageId: createId("socramessage"),
      content: "Verify recovery.",
      runtimeConfig,
    })
    const goal = store.applyRouting({
      projectId: "global",
      turnId: failed.turn.id,
      messageId: failed.userMessage.id,
      messageContent: failed.userMessage.content,
      result: createDecision(store),
    }).goal
    store.failTurn({ projectId: "global", turnId: failed.turn.id, error: new Error("Deliberate failure") })
    expect(store.getSnapshot().latestCapsules.find((capsule) => capsule.goalId === goal.id)?.openQuestions).toHaveLength(1)

    const retry = store.createTurn({
      projectId: "global",
      clientMessageId: createId("socramessage"),
      content: "Verify recovery.",
      runtimeConfig,
    })
    const candidate = { goal: store.listGoalsForResolution().find((item) => item.id === goal.id)!, candidate: 1 }
    store.applyRouting({
      projectId: "global",
      turnId: retry.turn.id,
      messageId: retry.userMessage.id,
      messageContent: retry.userMessage.content,
      result: {
        decision: { action: "continue", primaryGoalId: goal.id },
        candidates: { foreground: candidate, parked: [], candidates: [candidate], totalEligibleParked: 0, parkedCandidateLimit: 5 },
        source: "model",
      },
    })
    const toolCallId = createId("v2tcall")
    store.createToolCall({
      id: toolCallId,
      projectId: "global",
      goalId: goal.id,
      turnId: retry.turn.id,
      toolName: "read",
      arguments: { uri: "socrates://context/active" },
      requiresApproval: false,
    })
    store.completeToolCall(toolCallId, { content: "Recovery evidence." })
    store.commitValidatedTurn({
      projectId: "global",
      turnId: retry.turn.id,
      content: "Recovery is verified.",
      goalFinalization: { state: "active", note: "Recovery is verified and the goal remains active." },
    })

    const capsule = store.getSnapshot().latestCapsules.find((item) => item.goalId === goal.id)
    expect(capsule).toMatchObject({ version: 3, openQuestions: [] })
    expect(capsule?.summary).toContain("Latest outcome: Recovery is verified.")
    expect(capsule?.summary).not.toContain("Deliberate failure")
    expect(store.getSnapshot().canonicalToolCalls).toMatchObject([{
      id: toolCallId,
      turnId: retry.turn.id,
      status: "completed",
      toolName: "read",
    }])
  }, 60_000)

  it("cancels pending interactions when a user interrupts a turn", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-global-cancel-"))
    roots.push(root)
    const handle = openDatabase(path.join(root, "socrates.sqlite"))
    handles.push(handle)
    runMigrations(handle)
    const store = new GlobalSocratesStore(handle, { globalWorkspacePath: root })
    store.bootstrap()
    const created = store.createTurn({
      projectId: "global",
      clientMessageId: createId("socramessage"),
      content: "Run a protected action.",
      runtimeConfig,
    })
    const toolCallId = createId("v2tcall")
    store.createToolCall({
      id: toolCallId,
      projectId: "global",
      turnId: created.turn.id,
      toolName: "bash",
      arguments: { operation: "start", command: "echo protected" },
      requiresApproval: true,
    })
    store.createApproval({
      id: createId("v2appr"),
      projectId: "global",
      turnId: created.turn.id,
      toolCallId,
      actionKind: "shell_command",
      action: { command: "echo protected" },
    })
    const taskId = store.getSnapshot().activeTask?.id
    if (!taskId) throw new Error("Expected an active task.")
    const olderTurnId = createId("v2turn")
    const olderToolCallId = createId("v2tcall")
    const timestamp = new Date().toISOString()
    handle.sqlite.prepare(
      "INSERT INTO v2_turns (id, project_id, ordinal, status, started_at, updated_at, metadata_json) VALUES (?, 'global', 99, 'suspended', ?, ?, ?)",
    ).run(olderTurnId, timestamp, timestamp, JSON.stringify({ terminalTaskId: taskId }))
    store.createToolCall({
      id: olderToolCallId,
      projectId: "global",
      turnId: olderTurnId,
      toolName: "bash",
      arguments: { operation: "start", command: "echo older" },
      requiresApproval: true,
    })
    store.createApproval({
      id: createId("v2appr"),
      projectId: "global",
      turnId: olderTurnId,
      toolCallId: olderToolCallId,
      actionKind: "shell_command",
      action: { command: "echo older" },
    })

    const cancelled = store.cancelTurn(created.turn.id, "The user rejected this tool call.")

    expect(cancelled).toMatchObject({ status: "cancelled", waitingReason: "The user rejected this tool call." })
    const snapshot = store.getSnapshot()
    expect(snapshot.activeTask).toBeUndefined()
    expect(snapshot.pendingApprovals).toEqual([])
    expect(snapshot.canonicalToolCalls).toMatchObject([{ id: toolCallId, status: "failed" }])
    const pendingCount = handle.sqlite.prepare("SELECT COUNT(*) AS count FROM v2_approvals WHERE status = 'pending'").get() as { count: number }
    const olderTool = handle.sqlite.prepare("SELECT status FROM v2_tool_calls WHERE id = ?").get(olderToolCallId) as { status: string }
    expect(pendingCount.count).toBe(0)
    expect(olderTool.status).toBe("failed")
  }, 60_000)
})
