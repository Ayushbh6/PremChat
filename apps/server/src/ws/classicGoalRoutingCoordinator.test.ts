import type { V2FlowSnapshot, V2Goal } from "@socrates/contracts";
import type { ModelProvider, StructuredModelRequest } from "@socrates/providers";
import { describe, expect, it, vi } from "vitest";
import type { SocratesStore } from "../services/store";
import type { V2FlowStore } from "../services/v2/flowStore";
import { routeClassicGoal } from "./classicGoalRoutingCoordinator";

const timestamp = "2026-07-25T12:00:00.000Z";
const selectedGoal: V2Goal = {
  id: "goal_review",
  flowId: "flow_1",
  projectId: "project_1",
  ordinal: 1,
  title: "Review the focus ledger",
  kind: "work",
  status: "completed",
  origin: "router",
  priority: 50,
  pinned: false,
  lastActiveAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  completedAt: timestamp,
};

describe("Classic shared Goal Router orchestration", () => {
  it("sends the preceding visible Q&A and selected-goal history before applying the route", async () => {
    let routerPayload: Record<string, unknown> | undefined;
    const provider: ModelProvider = {
      countTokens: async (request) => ({
        providerId: request.providerId,
        modelId: request.modelId,
        inputTokens: 1,
        baseTokens: 1,
        method: "local_tiktoken",
        safetyMarginPercent: 0,
      }),
      async *stream() {
        yield { type: "model.completed" };
      },
      async generateStructured<TOutput>(request: StructuredModelRequest<TOutput>) {
        routerPayload = JSON.parse(String(request.messages[0]?.content)) as Record<string, unknown>;
        return { output: { action: "use", candidates: [1], title: null } as TOutput };
      },
    };
    const snapshot = {
      flow: { id: "flow_1", projectId: "project_1", status: "active", foregroundGoalId: selectedGoal.id, revision: 1, lastEventSequence: 0, createdAt: timestamp, updatedAt: timestamp },
      foregroundGoal: selectedGoal,
      goals: [selectedGoal],
      latestCapsules: [],
      messages: [],
      messageWindow: { hasEarlier: false },
      activeTerminals: [],
      pendingApprovals: [],
      lastEventSequence: 0,
    } satisfies V2FlowSnapshot;
    const flowStore = {
      prepareClassicGoalRouting: vi.fn(() => ({ flowId: "flow_1", currentGoalId: selectedGoal.id, currentGoalCandidate: 1, candidates: [] })),
      getSnapshot: vi.fn(() => snapshot),
      previousClassicGoalId: vi.fn(() => undefined),
      listClassicGoalRoutingTurns: vi.fn(() => [{ user: "Inspect the ledger", assistant: "The inspection found coupled lifecycle state." }]),
      listGoalSearchMatches: vi.fn(() => []),
      applyClassicGoalRoute: vi.fn(() => ({ goalId: selectedGoal.id, title: selectedGoal.title, state: "foreground", note: "Reopened for the follow-up." })),
    } as unknown as V2FlowStore;
    const sharedStore = {
      searchGoalCards: vi.fn(async () => []),
      getWorkerModelSetting: vi.fn(() => ({ workerId: "goal_router", providerId: "openai", modelId: "router-test", thinkingEnabled: false, updatedAt: timestamp })),
      createModelCall: vi.fn(() => "model_call_1"),
      completeModelCall: vi.fn(),
      failModelCall: vi.fn(),
      recordError: vi.fn(() => "error_1"),
      recordGoalRouterUsage: vi.fn(),
    } as unknown as SocratesStore;

    await routeClassicGoal({
      projectId: "project_1",
      conversationId: "conversation_1",
      sessionId: "session_1",
      turnId: "turn_4",
      runtimeConfigId: "runtime_1",
      userMessageId: "message_4",
      userMessage: "What????",
      workspacePath: "/workspace",
      recentMessages: [
        { role: "user", content: "First question" },
        { role: "assistant", content: "First answer" },
        { role: "user", content: "Inspect the ledger" },
        { role: "assistant", content: "The inspection found coupled lifecycle state." },
        { role: "user", content: "What????" },
      ],
      flowStore,
      sharedStore,
      provider,
    });

    expect(routerPayload?.userMessage).toBe("What????");
    expect(routerPayload?.immediatelyPrecedingExchanges).toEqual([
      { user: "First question", assistant: "First answer" },
      { user: "Inspect the ledger", assistant: "The inspection found coupled lifecycle state." },
    ]);
    expect(routerPayload?.selectedGoalHistory).toEqual([
      { user: "Inspect the ledger", assistant: "The inspection found coupled lifecycle state." },
    ]);
    expect(flowStore.applyClassicGoalRoute).toHaveBeenCalledOnce();
  });
});
