import { SocratesAgent } from "@socrates/core"
import type { RuntimeConfig, V2FlowSnapshot, V2Goal } from "@socrates/contracts"
import type { ModelProvider, StructuredModelRequest } from "@socrates/providers"
import { describe, expect, it, vi } from "vitest"
import type { SocratesStore } from "../services/store"
import type { V2FlowStore } from "../services/v2/flowStore"
import { resolveClassicGoal } from "./classicGoalLifecycleCoordinator"

const timestamp = "2026-07-25T12:00:00.000Z"
const selectedGoal: V2Goal = {
  id: "goal_review",
  flowId: "flow_1",
  projectId: "project_1",
  ordinal: 1,
  title: "Review the focus ledger",
  kind: "work",
  status: "foreground",
  origin: "user",
  priority: 50,
  pinned: false,
  lastActiveAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
}

describe("Classic shared goal resolution", () => {
  it("uses the main Socrates phase with the latest exact exchange and parallel candidates", async () => {
    let resolutionPayload: Record<string, unknown> | undefined
    let resolutionSystem = ""
    const provider: ModelProvider = {
      countTokens: async (request) => ({ providerId: request.providerId, modelId: request.modelId, inputTokens: 1, baseTokens: 1, method: "local_tiktoken", safetyMarginPercent: 0 }),
      async *stream() { yield { type: "model.completed" } },
      async generateStructured<TOutput>(request: StructuredModelRequest<TOutput>) {
        resolutionSystem = request.system
        resolutionPayload = JSON.parse(String(request.messages[0]?.content)) as Record<string, unknown>
        return { output: { decision: "current", candidate: null, title: null, question: null } as TOutput }
      },
    }
    const snapshot = {
      flow: { id: "flow_1", projectId: "project_1", status: "active", foregroundGoalId: selectedGoal.id, revision: 1, lastEventSequence: 0, createdAt: timestamp, updatedAt: timestamp },
      foregroundGoal: selectedGoal,
      goals: [selectedGoal],
      latestCapsules: [],
      messages: [],
      messageWindow: { hasEarlier: false },
      canonicalToolCalls: [],
      activeTerminals: [],
      pendingApprovals: [],
      lastEventSequence: 0,
    } satisfies V2FlowSnapshot
    const flowStore = {
      prepareClassicGoalResolution: vi.fn(() => ({ flowId: "flow_1", currentGoalId: selectedGoal.id, currentGoalCandidate: 1, candidates: [] })),
      getSnapshot: vi.fn(() => snapshot),
      previousClassicGoalId: vi.fn(() => undefined),
      listClassicGoalResolutionTurns: vi.fn(() => [{ user: "Inspect the ledger exactly.", assistant: "The exact inspection found coupled lifecycle state." }]),
      applyClassicGoalResolution: vi.fn(() => ({ goalId: selectedGoal.id, title: selectedGoal.title, state: "foreground", note: "Continued." })),
    } as unknown as V2FlowStore
    const sharedStore = {
      retrieveGoalCandidates: vi.fn(async () => ({ results: [], totalMatches: 0 })),
      retrieveMemoryCandidates: vi.fn(async () => ({ results: [], totalMatches: 0 })),
      createModelCall: vi.fn(() => "model_call_1"),
      completeModelCall: vi.fn(),
      failModelCall: vi.fn(),
      recordError: vi.fn(() => "error_1"),
    } as unknown as SocratesStore
    const runtimeConfig: RuntimeConfig = {
      providerId: "openrouter",
      modelId: "deepseek/deepseek-v4-pro",
      thinkingEnabled: false,
      thinkingEffort: "none",
      approvalMode: "manual",
      sandboxMode: "workspace_write",
    }

    const result = await resolveClassicGoal({
      projectId: "project_1",
      conversationId: "conversation_1",
      sessionId: "session_1",
      turnId: "turn_4",
      runtimeConfigId: "runtime_1",
      userMessageId: "message_4",
      userMessage: "Continue with the implementation.",
      workspacePath: "/workspace",
      flowStore,
      sharedStore,
      agent: new SocratesAgent(provider),
      runtimeConfig,
    })

    expect(result.status).toBe("resolved")
    expect(resolutionSystem).toContain("You are Socrates")
    expect(resolutionSystem).toContain("socrates_goal_resolution_phase")
    expect(resolutionPayload?.exactLatestUserMessage).toBe("Continue with the implementation.")
    expect(resolutionPayload?.latestExactExchangeInCurrentGoal).toEqual({
      user: "Inspect the ledger exactly.",
      assistant: "The exact inspection found coupled lifecycle state.",
    })
    expect(sharedStore.retrieveMemoryCandidates).toHaveBeenCalledWith(
      "project_1",
      expect.objectContaining({ query: expect.stringContaining("Goal: Review the focus ledger") }),
      true,
    )
    expect(flowStore.applyClassicGoalResolution).toHaveBeenCalledOnce()
  })
})
