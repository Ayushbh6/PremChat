import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { ChatCompaction, SocratesRuntimeConfig } from "@socrates/contracts"
import { DEFAULT_CONTEXT_COMPRESSION_THRESHOLDS, type SocratesGoalResolutionResult } from "@socrates/core"
import { createId, nowIso } from "@socrates/shared"
import { openDatabase, runMigrations, type DatabaseHandle } from "../db/client"
import type { SocratesStore } from "../services/store"
import {
  createSocratesContextCompressionRuntime,
  socratesWithinTurnCompressionThresholds,
} from "../services/socrates/contextCompressionRuntime"
import { GlobalSocratesStore } from "../services/socrates/socratesStore"

const handles: DatabaseHandle[] = []
const roots: string[] = []

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const runtimeConfig: SocratesRuntimeConfig = {
  providerId: "openai",
  authMode: "api_key",
  modelId: "gpt-test",
  thinkingEnabled: false,
  approvalMode: "manual",
  sandboxMode: "workspace_write",
  contextWindowTokens: 128_000,
}

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-v2-within-turn-compaction-"))
  roots.push(root)
  const handle = openDatabase(path.join(root, "socrates.sqlite"))
  handles.push(handle)
  runMigrations(handle)
  const workspacePath = path.join(root, "workspace")
  fs.mkdirSync(workspacePath, { recursive: true })
  const now = nowIso()
  handle.sqlite.prepare(
    "INSERT INTO users (id, display_name, onboarding_completed, created_at, updated_at) VALUES (?, ?, 1, ?, ?)",
  ).run("user_compaction", "Compaction User", now, now)
  handle.sqlite.prepare(
    "INSERT INTO projects (id, user_id, name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
  ).run("proj_compaction", "user_compaction", "Compaction Project", now, now)
  handle.sqlite.prepare(
    "INSERT INTO project_workspaces (id, project_id, kind, path, is_primary, status, created_at, updated_at) VALUES (?, ?, 'existing_folder', ?, 1, 'active', ?, ?)",
  ).run("pws_compaction", "proj_compaction", workspacePath, now, now)
  const store = new GlobalSocratesStore(handle)
  store.bootstrap()
  const created = store.createTurn({
    projectId: "proj_compaction",
    clientMessageId: createId("v2msg"),
    content: "Inspect a very large set of tool results.",
    runtimeConfig,
  })
  const routed = store.applyRouting({
    projectId: "proj_compaction",
    turnId: created.turn.id,
    messageId: created.userMessage.id,
    messageContent: created.userMessage.content,
    result: forcedCreateResult(store),
  })
  return { handle, store, turnId: created.turn.id, goalId: routed.goal.id }
}

const forcedCreateResult = (store: GlobalSocratesStore): SocratesGoalResolutionResult => {
  const foregroundGoal = store.listGoalsForResolution().find((goal) => goal.status === "foreground")
  const foreground = foregroundGoal ? { goal: foregroundGoal, candidate: 1 } : undefined
  return {
    decision: { action: "create", title: "Test goal" },
    candidates: {
      ...(foreground ? { foreground } : {}),
      parked: [],
      candidates: foreground ? [foreground] : [],
      totalEligibleParked: 0,
      parkedCandidateLimit: 5,
    },
    source: "fallback",
    fallbackReason: "invalid_output",
  }
}

const sharedStore = {
  getWorkerModelSetting: (_workerId: Parameters<SocratesStore["getWorkerModelSetting"]>[0]) => ({
    workerId: "socrates_context_compactor" as const,
    providerId: "openrouter" as const,
    authMode: "api_key" as const,
    modelId: "deepseek/deepseek-v4-flash",
    thinkingEnabled: false,
    updatedAt: nowIso(),
  }),
  listAvailableModels: () => ({ models: [], defaultModel: null }),
}

const summary: ChatCompaction = {
  schemaVersion: 1,
  goal: "Finish the current Socrates goal.",
  constraints: ["Never delete exact evidence."],
  done: ["Read the source material."],
  inProgress: ["Compose the answer."],
  blocked: [],
  decisions: ["Keep only query-relevant tool results in active context."],
  nextSteps: ["Return the result."],
  criticalContext: ["Exact tool output remains in Socrates evidence."],
  relevantFiles: [],
  toolState: ["Older results are retrievable by handle."],
  anchors: ["Turn 1: inspect the exact Socrates trace."],
}

describe("Socrates within-turn context compression runtime", () => {
  it("uses the exact shared Socrates 170k compression ceiling", () => {
    const thresholds = socratesWithinTurnCompressionThresholds()
    expect(thresholds).toEqual(DEFAULT_CONTEXT_COMPRESSION_THRESHOLDS)
    expect(thresholds.triggerTokens).toBe(170_000)
    expect(thresholds.preferredTargetTokens).toBe(100_000)
    expect(thresholds.recentTailTargetTokens).toBe(70_000)
  })

  it("stores immutable Socrates snapshot evidence and restores the latest goal snapshot", async () => {
    const { handle, store, turnId, goalId } = setup()
    const runtime = createSocratesContextCompressionRuntime({
      store,
      sharedStore,
      projectId: "proj_compaction",
      goalId,
      turnId,
      workspacePath: "/tmp/socrates-v2-context-test",
    })
    await runtime.startSnapshot?.({
      snapshotId: "ctxcmp_v2_exact",
      reason: "threshold",
      contextTokensEstimate: 90_000,
      targetTokens: 43_000,
      compressorProviderId: "openrouter",
      compressorModelId: "deepseek/deepseek-v4-flash",
      sourceMessageIds: ["v2msg_source"],
      sourceTurnIds: [turnId],
    })
    await runtime.completeSnapshot?.({
      snapshotId: "ctxcmp_v2_exact",
      summary,
      renderedSummary: "# Socrates context\n\nExact evidence remains retrievable.",
      sourceHandles: [{ turnId, goalId, retrieve: `trace_retrieve({ turnId: \"${turnId}\" })` }],
      inputTokensEstimate: 90_000,
      outputTokensEstimate: 120,
      contextTokensAfter: 42_000,
      usage: { inputTokens: 8_000, outputTokens: 120, totalTokens: 8_120 },
      compressorProviderId: "openrouter",
      compressorModelId: "deepseek/deepseek-v4-flash",
    })

    expect(await runtime.getLatestSnapshot?.()).toMatchObject({
      snapshotId: "ctxcmp_v2_exact",
      summary,
      renderedSummary: "# Socrates context\n\nExact evidence remains retrievable.",
      outputTokensEstimate: 120,
      sourceHandles: [{ turnId, goalId }],
    })
    expect(handle.sqlite.prepare("SELECT COUNT(*) AS count FROM v2_evidence_items").get()).toEqual({ count: 2 })
    expect(handle.sqlite.prepare("SELECT role, status FROM v2_model_calls").get()).toEqual({ role: "context_compactor", status: "completed" })
    expect(handle.sqlite.prepare("SELECT input_tokens, output_tokens FROM v2_usage_events").get()).toEqual({ input_tokens: 8000, output_tokens: 120 })
    expect(classicRowCount(handle)).toBe(0)
  })

  it("audits a failed compaction without replacing the last completed snapshot", async () => {
    const { handle, store, turnId, goalId } = setup()
    const runtime = createSocratesContextCompressionRuntime({
      store,
      sharedStore,
      projectId: "proj_compaction",
      goalId,
      turnId,
      workspacePath: "/tmp/socrates-v2-context-test",
    })
    await runtime.startSnapshot?.({
      snapshotId: "ctxcmp_v2_failed",
      reason: "threshold",
      contextTokensEstimate: 90_000,
      targetTokens: 43_000,
      compressorProviderId: "openrouter",
      compressorModelId: "deepseek/deepseek-v4-flash",
      sourceMessageIds: [],
      sourceTurnIds: [turnId],
    })
    await runtime.failSnapshot?.({
      snapshotId: "ctxcmp_v2_failed",
      code: "context_compaction_target_not_met",
      message: "The compacted request remained too large.",
    })
    expect(await runtime.getLatestSnapshot?.()).toBeUndefined()
    expect(handle.sqlite.prepare("SELECT status FROM v2_model_calls").get()).toEqual({ status: "failed" })
    expect(handle.sqlite.prepare("SELECT code, recoverable FROM v2_errors").get()).toEqual({
      code: "context_compaction_target_not_met",
      recoverable: 1,
    })
    expect(handle.sqlite.prepare("SELECT COUNT(*) AS count FROM v2_evidence_items").get()).toEqual({ count: 2 })
  })
})

const classicRowCount = (handle: DatabaseHandle): number => [
  "conversations", "sessions", "turns", "messages", "model_calls", "tool_calls", "events",
].reduce((total, table) => total + Number((handle.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count), 0)
