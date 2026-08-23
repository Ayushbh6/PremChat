import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"
import type { SocratesAgent } from "@socrates/core"
import { initializeCanonicalDatabase } from "../db/canonicalSchema"
import { CanonicalSocratesStore } from "../services/canonical/canonicalSocratesStore"
import { resolveCanonicalGoal } from "./canonicalGoalResolution"

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })))

const runtimeConfig = { providerId: "openrouter" as const, modelId: "deepseek/deepseek-v4-pro", authMode: "api_key" as const, thinkingEnabled: false, approvalMode: "manual" as const, sandboxMode: "workspace_write" as const, contextWindowTokens: 1_048_576 }
const make = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-canonical-goal-"))
  roots.push(root)
  const database = new Database(path.join(root, "db.sqlite"))
  initializeCanonicalDatabase(database)
  return { root, database, store: new CanonicalSocratesStore(database) }
}
const agentDecision = (decision: unknown) => ({
  resolveGoal: async () => ({ decision, source: "model" as const, attempt: { providerId: "openrouter" as const, modelId: "deepseek/deepseek-v4-pro", status: "completed" as const, startedAt: "2026-07-30T00:00:00.000Z", completedAt: "2026-07-30T00:00:01.000Z", durationMs: 1, usages: [] } }),
}) as unknown as Pick<SocratesAgent, "resolveGoal">

describe("canonical same-Socrates goal resolution", () => {
  it("creates the first goal and uses the same no-tool agent decision for a continuation", async () => {
    const { root, database, store } = make()
    const first = store.createRootTask({ content: "Plan the migration", access: { mode: "selected", revision: 1, roots: [] } })
    const resolvedFirst = await resolveCanonicalGoal({ store, agent: agentDecision({ decision: "new", candidate: null, title: "Migration", question: null }), task: first, userMessage: "Plan the migration", runtimeConfig, workspacePath: root })
    expect(resolvedFirst).toMatchObject({ kind: "bound" })
    const second = store.createRootTask({ content: "Continue the migration", access: { mode: "selected", revision: 1, roots: [] } })
    const resolvedSecond = await resolveCanonicalGoal({ store, agent: agentDecision({ decision: "current", candidate: null, title: null, question: null }), task: second, userMessage: "Continue the migration", runtimeConfig, workspacePath: root })
    expect(resolvedSecond).toMatchObject({ kind: "bound", goalId: (resolvedFirst as { goalId: string }).goalId })
    expect(store.listGoalTaskIds((resolvedFirst as { goalId: string }).goalId)).toEqual([second.id, first.id])
    expect(database.prepare("SELECT role, status FROM model_calls ORDER BY started_at").all()).toEqual([
      { role: "main_goal_decision", status: "completed" },
      { role: "main_goal_decision", status: "completed" },
    ])
    database.close()
  })

  it("stores a typed clarification instead of guessing between goals", async () => {
    const { root, database, store } = make()
    const first = store.createRootTask({ content: "A", access: { mode: "selected", revision: 1, roots: [] } })
    const goal = await resolveCanonicalGoal({ store, agent: agentDecision({ decision: "new", candidate: null, title: "A", question: null }), task: first, userMessage: "A", runtimeConfig, workspacePath: root })
    const second = store.createRootTask({ content: "Which one?", access: { mode: "selected", revision: 1, roots: [] } })
    const clarification = await resolveCanonicalGoal({ store, agent: agentDecision({ decision: "clarify", candidate: null, title: null, question: "Which goal?" }), task: second, userMessage: "Which one?", runtimeConfig, workspacePath: root })
    expect(clarification.kind).toBe("clarification")
    expect(store.getSnapshot().pendingInteractions).toMatchObject([{ taskId: second.id, kind: "clarification", prompt: "Which goal?" }])
    expect(goal.kind).toBe("bound")
    database.close()
  })
})
