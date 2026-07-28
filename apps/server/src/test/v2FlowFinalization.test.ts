import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SocratesGoalResolutionResult } from "@socrates/core"
import { createId, nowIso } from "@socrates/shared"
import { openDatabase, runMigrations, type DatabaseHandle } from "../db/client"
import { V2FlowStore } from "../services/v2/flowStore"

const handles: DatabaseHandle[] = []
const roots: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const handle of handles.splice(0)) handle.close()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("V2FlowStore final-answer commit", () => {
  it("rolls back the assistant answer when authoritative goal finalization fails", () => {
    const { store } = setup()
    const { flow } = store.ensureFlow("proj_atomic")
    const created = store.createTurn({
      projectId: "proj_atomic",
      flowId: flow.id,
      clientMessageId: createId("v2msg"),
      content: "Review the shared runtime.",
      runtimeConfig: {
        providerId: "openai",
        authMode: "api_key",
        modelId: "gpt-test",
        thinkingEnabled: false,
        approvalMode: "manual",
        sandboxMode: "workspace_write",
        contextWindowTokens: 128_000,
      },
    })
    const routed = store.applyRouting({
      projectId: "proj_atomic",
      flowId: flow.id,
      turnId: created.turn.id,
      messageId: created.userMessage.id,
      messageContent: created.userMessage.content,
      result: createGoalRoute(store, flow.id),
    })
    vi.spyOn(store, "finalizeGoal").mockImplementation(() => {
      throw new Error("forced finalization failure")
    })

    expect(() => store.commitValidatedTurn({
      projectId: "proj_atomic",
      flowId: flow.id,
      turnId: created.turn.id,
      content: "Validated answer",
      goalFinalization: { state: "completed", note: "Review completed." },
    })).toThrow("forced finalization failure")

    const turn = store.getTurn("proj_atomic", flow.id, created.turn.id)
    const snapshot = store.getSnapshot("proj_atomic", flow.id)
    expect(turn.status).toBe("running")
    expect(turn.assistantMessageId).toBeUndefined()
    expect(snapshot.messages.some((message) => message.content === "Validated answer")).toBe(false)
    expect(snapshot.goals.find((goal) => goal.id === routed.goal.id)?.status).toBe("foreground")
  })
})

const setup = (): { store: V2FlowStore } => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-v2-finalization-"))
  roots.push(root)
  const handle = openDatabase(path.join(root, "socrates.sqlite"))
  handles.push(handle)
  runMigrations(handle)
  const workspacePath = path.join(root, "workspace")
  fs.mkdirSync(workspacePath, { recursive: true })
  const now = nowIso()
  handle.sqlite.prepare(
    "INSERT INTO users (id, display_name, onboarding_completed, created_at, updated_at) VALUES (?, ?, 1, ?, ?)",
  ).run("user_atomic", "Atomic User", now, now)
  handle.sqlite.prepare(
    "INSERT INTO projects (id, user_id, name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
  ).run("proj_atomic", "user_atomic", "Atomic project", now, now)
  handle.sqlite.prepare(
    "INSERT INTO project_workspaces (id, project_id, kind, path, is_primary, status, created_at, updated_at) VALUES (?, ?, 'existing_folder', ?, 1, 'active', ?, ?)",
  ).run("pws_atomic", "proj_atomic", workspacePath, now, now)
  return { store: new V2FlowStore(handle) }
}

const createGoalRoute = (store: V2FlowStore, flowId: string): SocratesGoalResolutionResult => {
  const foregroundGoal = store.listGoalsForResolution(flowId).find((goal) => goal.status === "foreground")
  const foreground = foregroundGoal ? { goal: foregroundGoal, candidate: 1 } : undefined
  return {
    decision: { action: "create", title: "Review shared runtime" },
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
