import { describe, expect, it } from "vitest"
import type { SocratesSnapshot, SocratesGoalExchange, SocratesMessage } from "@socrates/contracts"
import { createSocratesRuntimeState } from "./reducer"
import { selectSocratesPresentation } from "./presentation"

const at = "2026-07-30T10:00:00.000Z"
const message = (input: Partial<SocratesMessage> & Pick<SocratesMessage, "id" | "role" | "content">): SocratesMessage => ({
  id: input.id,
  goalId: input.goalId ?? "goal_current",
  turnId: input.turnId ?? "turn_current",
  ordinal: input.ordinal ?? 1,
  role: input.role,
  kind: input.kind ?? "standard",
  content: input.content,
  status: input.status ?? "completed",
  createdAt: input.createdAt ?? at,
  ...(input.completedAt ? { completedAt: input.completedAt } : {}),
})

const baseSnapshot = (overrides: Partial<SocratesSnapshot> = {}): SocratesSnapshot => ({
  state: {
    id: "global",
    foregroundGoalId: "goal_current",
    revision: 1,
    lastEventSequence: 4,
    createdAt: at,
    updatedAt: at,
  },
  foregroundGoal: {
    id: "goal_current",
    ordinal: 1,
    title: "Current verification goal",
    summary: "Verify global Socrates",
    kind: "work",
    status: "foreground",
    origin: "router",
    priority: 50,
    pinned: false,
    lastActiveAt: at,
    createdAt: at,
    updatedAt: at,
  },
  goals: [],
  latestCapsules: [],
  messages: [],
  messageWindow: { hasEarlier: false },
  canonicalToolCalls: [],
  activeTerminals: [],
  pendingApprovals: [],
  pendingCredentialRequests: [],
  lastEventSequence: 4,
  ...overrides,
})

const historyExchange: SocratesGoalExchange = {
  taskId: "task_history",
  goalId: "goal_history",
  sourceRuntime: "socrates",
  ordinal: 2,
  rootTurnId: "turn_history",
  currentTurnId: "turn_history",
  turnIds: ["turn_history"],
  status: "completed",
  userMessage: message({
    id: "message_history_user",
    goalId: "goal_history",
    turnId: "turn_history",
    ordinal: 3,
    role: "user",
    content: "Show the historical answer.",
  }),
  assistantMessage: message({
    id: "message_history_answer",
    goalId: "goal_history",
    turnId: "turn_history",
    ordinal: 4,
    role: "assistant",
    content: "This is the immutable historical answer.",
    completedAt: at,
  }),
  work: {
    toolCalls: [],
    evidence: [{
      id: "evidence_history",
      turnId: "turn_history",
      sourceKind: "file",
      title: "Historical file",
      sourceUri: "/tmp/history.md",
      createdAt: at,
    }],
    totalToolCalls: 0,
    totalEvidenceItems: 1,
    hasMore: false,
  },
  startedAt: at,
  updatedAt: at,
  completedAt: at,
}

describe("global Socrates presentation", () => {
  it("keeps passive history separate from the canonical current exchange", () => {
    const currentUser = message({ id: "message_current_user", role: "user", content: "Current request" })
    const currentAnswer = message({
      id: "message_current_answer",
      role: "assistant",
      content: "Current saved answer",
      ordinal: 2,
      completedAt: at,
    })
    const runtime = createSocratesRuntimeState(baseSnapshot({
      messages: [currentUser, currentAnswer],
      messageWindow: { hasEarlier: false },
      latestTask: {
        id: "task_current",
        sourceRuntime: "socrates",
        goalId: "goal_current",
        rootTurnId: "turn_current",
        currentTurnId: "turn_current",
        status: "completed",
        runtimeConfig: {} as never,
        waitingOnTerminalIds: [],
        createdAt: at,
        updatedAt: at,
        completedAt: at,
      },
    }))

    const selected = selectSocratesPresentation({
      runtime,
      exchanges: [historyExchange],
      view: { displayMode: "history", viewedGoalId: "goal_history", viewedExchangeId: "task_history" },
      socketStatus: "connected",
    })

    expect(selected.displayedExchange?.taskId).toBe("task_history")
    expect(selected.currentExchange?.taskId).toBe("task_current")
    expect(selected.isDisplayingCurrent).toBe(false)
    expect(selected.stage).toEqual({ kind: "final", label: "Historical exchange" })
    expect(selected.liveWork).toContainEqual(expect.objectContaining({ id: "evidence_history", detail: "/tmp/history.md" }))
    expect(runtime.snapshot.state.foregroundGoalId).toBe("goal_current")
  })

  it("projects recovery only for an active canonical turn", () => {
    const runtime = createSocratesRuntimeState(baseSnapshot({
      activeTurn: {
        id: "turn_current",
        goalId: "goal_current",
        ordinal: 1,
        userMessageId: "message_current_user",
        status: "running",
        startedAt: at,
        updatedAt: at,
      },
      messages: [message({ id: "message_current_user", role: "user", content: "Keep working" })],
      messageWindow: { hasEarlier: false },
      liveActivity: { turnId: "turn_current", phase: "tool", label: "Reading exact evidence…" },
    }))
    const selected = selectSocratesPresentation({
      runtime,
      exchanges: [],
      view: { displayMode: "current" },
      socketStatus: "reconnecting",
    })
    expect(selected.stage).toEqual({ kind: "recovery", label: "Recovering the live task and exact work trace…" })
  })

  it("prioritizes an actionable approval over generic working state", () => {
    const runtime = createSocratesRuntimeState(baseSnapshot({
      activeTurn: {
        id: "turn_current",
        goalId: "goal_current",
        ordinal: 1,
        status: "running",
        startedAt: at,
        updatedAt: at,
      },
      messages: [message({ id: "message_current_user", role: "user", content: "Apply the change" })],
      messageWindow: { hasEarlier: false },
      pendingApprovals: [{ id: "approval_1", status: "pending" } as never],
    }))
    const selected = selectSocratesPresentation({
      runtime,
      exchanges: [],
      view: { displayMode: "current" },
      socketStatus: "connected",
    })
    expect(selected.stage).toEqual({ kind: "awaiting_input", label: "Socrates needs your approval to continue." })
  })
})
