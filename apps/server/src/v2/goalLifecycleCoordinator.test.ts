import { SocratesAgent } from "@socrates/core"
import type { V2FlowSnapshot, V2Goal, V2RuntimeConfig } from "@socrates/contracts"
import type { ModelProvider, StructuredModelRequest } from "@socrates/providers"
import { describe, expect, it, vi } from "vitest"
import type { SocratesStore } from "../services/store"
import type { V2FlowStore } from "../services/v2/flowStore"
import { resolveFlowGoal } from "./goalLifecycleCoordinator"

const timestamp = "2026-07-28T12:00:00.000Z"
const goal = (id: string, title: string, status: V2Goal["status"]): V2Goal => ({
  id,
  flowId: "flow_1",
  projectId: "project_1",
  ordinal: id === "goal_current" ? 1 : 2,
  title,
  kind: "work",
  status,
  origin: "user",
  priority: 50,
  pinned: false,
  lastActiveAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
})

describe("Flow goal-aware memory retrieval", () => {
  it("refines memory once against an older goal selected by the same Socrates", async () => {
    const current = goal("goal_current", "Dashboard polish", "foreground")
    const older = goal("goal_older", "Authentication rollout", "parked")
    const snapshot = {
      flow: { id: "flow_1", projectId: "project_1", status: "active", foregroundGoalId: current.id, revision: 1, lastEventSequence: 0, createdAt: timestamp, updatedAt: timestamp },
      foregroundGoal: current,
      goals: [current, older],
      latestCapsules: [],
      messages: [],
      messageWindow: { hasEarlier: false },
      canonicalToolCalls: [],
      activeTerminals: [],
      pendingApprovals: [],
      lastEventSequence: 0,
    } satisfies V2FlowSnapshot
    const provider: ModelProvider = {
      countTokens: async (request) => ({ providerId: request.providerId, modelId: request.modelId, inputTokens: 1, baseTokens: 1, method: "local_tiktoken", safetyMarginPercent: 0 }),
      async *stream() { yield { type: "model.completed" } },
      async generateStructured<TOutput>(_request: StructuredModelRequest<TOutput>) {
        return { output: { decision: "older", candidate: 2, title: null, question: null } as TOutput }
      },
    }
    const store = {
      getSnapshot: vi.fn(() => snapshot),
      previousRoutingGoalId: vi.fn(() => undefined),
      listGoalsForResolution: vi.fn(() => [current, older]),
      listCapsulesForResolution: vi.fn(() => []),
      listGoalRoutingTurns: vi.fn(() => []),
      applyRouting: vi.fn(() => ({ goal: older })),
      getActiveGoalCard: vi.fn(() => ({
        goalId: older.id,
        title: older.title,
        state: "foreground",
        note: "Resume token migration.",
        objective: older.title,
        taskOrdinal: 2,
        taskRequest: "Return to the authentication rollout.",
      })),
      createModelCall: vi.fn(() => "model_call_1"),
      completeModelCall: vi.fn(),
      recordError: vi.fn(() => ({ id: "error_1" })),
    } as unknown as V2FlowStore
    const sharedStore = {
      retrieveGoalCandidates: vi.fn(async () => ({
        results: [{ resultNumber: 1, goalId: older.id, title: older.title, content: older.title, occurredAt: timestamp }],
        totalMatches: 1,
      })),
      retrieveMemoryCandidates: vi.fn()
        .mockResolvedValueOnce({ results: [], totalMatches: 0 })
        .mockResolvedValueOnce({
          results: [{
            resultNumber: 1,
            content: "authentication rollout requires token migration",
            surface: "repo_docs",
            fileName: "REPO_RULES.md",
            sectionId: "workflows",
            sectionHeading: "Workflows",
            scope: "project",
          }],
          totalMatches: 1,
        }),
    } as unknown as SocratesStore
    const runtimeConfig: V2RuntimeConfig = {
      providerId: "openrouter",
      modelId: "deepseek/deepseek-v4-pro",
      thinkingEnabled: false,
      thinkingEffort: "none",
      approvalMode: "manual",
      sandboxMode: "workspace_write",
    }

    const result = await resolveFlowGoal({
      projectId: "project_1",
      flowId: "flow_1",
      turnId: "turn_2",
      messageId: "message_2",
      messageContent: "Return to the authentication rollout.",
      workspacePath: "/workspace",
      store,
      sharedStore,
      agent: new SocratesAgent(provider),
      runtimeConfig,
      recordUsage: vi.fn(),
    })

    expect(result.status).toBe("resolved")
    expect(sharedStore.retrieveMemoryCandidates).toHaveBeenCalledTimes(2)
    expect(sharedStore.retrieveMemoryCandidates).toHaveBeenLastCalledWith(
      "project_1",
      expect.objectContaining({ query: expect.stringContaining("Goal: Authentication rollout") }),
      true,
    )
    if (result.status === "resolved") {
      expect(result.memoryCandidates[0]?.content).toContain("token migration")
    }
  })
})
