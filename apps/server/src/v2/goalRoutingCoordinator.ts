import { routeV2Goal, type V2GoalRouterResult } from "@socrates/core"
import type { V2GoalRoutingRun, V2Message, V2Turn } from "@socrates/contracts"
import type { ModelProvider, ModelUsage } from "@socrates/providers"
import type { SocratesStore } from "../services/store"
import type { V2FlowStore } from "../services/v2/flowStore"

type ResolveFlowGoalInput = {
  projectId: string
  flowId: string
  turnId: string
  messageId: string
  messageContent: string
  preferredGoalId?: string
  workspacePath: string
  store: V2FlowStore
  sharedStore: SocratesStore
  routerProvider?: ModelProvider
  clarificationAnswer?: string
  recordUsage: (modelCallId: string, usage: ModelUsage) => void
}

export type ResolvedFlowGoal =
  | { status: "clarification"; routingRun: V2GoalRoutingRun; message: V2Message; turn: V2Turn }
  | { status: "resolved"; goalId: string; applied: ReturnType<V2FlowStore["applyRouting"]>; result: V2GoalRouterResult }

export const resolveFlowGoal = async (input: ResolveFlowGoalInput): Promise<ResolvedFlowGoal> => {
  const snapshot = input.store.getSnapshot(input.projectId, input.flowId)
  const selectedGoalId = input.preferredGoalId && snapshot.goals.some((goal) => goal.id === input.preferredGoalId)
    ? input.preferredGoalId
    : snapshot.flow.foregroundGoalId
  const previousGoalId = input.store.previousRoutingGoalId(input.flowId, selectedGoalId)
  const retrievedGoalIds = await input.sharedStore.searchGoalCards(input.projectId, input.messageContent, 12).catch(() => [] as string[])
  const setting = input.sharedStore.getWorkerModelSetting("goal_router")
  const model = {
    providerId: setting.providerId,
    ...(setting.authMode ? { authMode: setting.authMode } : {}),
    modelId: setting.modelId,
    thinkingEnabled: setting.thinkingEnabled,
    ...(setting.thinkingEffort ? { thinkingEffort: setting.thinkingEffort } : {}),
    timeoutMs: 8_000,
  }
  const routing = await routeV2Goal({
    projectId: input.projectId,
    flowId: input.flowId,
    turnId: input.turnId,
    workspacePath: input.workspacePath,
    userMessage: input.messageContent,
    goals: snapshot.goals,
    ...(selectedGoalId ? { selectedGoalId } : {}),
    ...(previousGoalId ? { previousGoalId } : {}),
    capsules: snapshot.latestCapsules,
    recentTurns: input.store.listRecentRoutingTurns(input.flowId, 3),
    ...(selectedGoalId ? { selectedGoalTurns: input.store.listGoalRoutingTurns(input.flowId, selectedGoalId, 5) } : {}),
    candidateGoalIds: retrievedGoalIds,
    ...(input.clarificationAnswer ? { clarificationAnswer: input.clarificationAnswer } : {}),
    goalSearch: async (searchInput) => {
      const semanticGoalIds = searchInput.mode === "lexical"
        ? []
        : await input.sharedStore.searchGoalCards(input.projectId, searchInput.query, 25).catch(() => [] as string[])
      return input.store.listGoalSearchMatches({
        flowId: input.flowId,
        query: searchInput.query,
        mode: searchInput.mode,
        limit: searchInput.limit,
        semanticGoalIds,
      })
    },
    ...(input.routerProvider ? { provider: input.routerProvider, model } : {}),
  })
  recordGoalRouterAttempt(input, routing)
  if (routing.decision.action === "clarify" && !input.clarificationAnswer) {
    const clarification = input.store.requestRoutingClarification({
      projectId: input.projectId,
      flowId: input.flowId,
      turnId: input.turnId,
      messageId: input.messageId,
      result: routing,
      ...(input.routerProvider ? { providerId: model.providerId, modelId: model.modelId } : {}),
    })
    return { status: "clarification", ...clarification }
  }
  const effective = routing.decision.action === "clarify"
    ? { ...routing, decision: routing.candidates.foreground
        ? { action: routing.candidates.foreground.goal.status === "foreground" ? "continue" as const : "resume" as const, primaryGoalId: routing.candidates.foreground.goal.id }
        : { action: "create" as const, title: input.messageContent.trim().slice(0, 120) || "New focus" } }
    : routing
  const applied = input.store.applyRouting({
    projectId: input.projectId,
    flowId: input.flowId,
    turnId: input.turnId,
    messageId: input.messageId,
    messageContent: input.messageContent,
    result: effective,
    ...(input.routerProvider ? { providerId: model.providerId, modelId: model.modelId } : {}),
  })
  return { status: "resolved", goalId: applied.goal.id, applied, result: effective }
}

const recordGoalRouterAttempt = (input: ResolveFlowGoalInput, routing: V2GoalRouterResult): void => {
  if (!routing.modelAttempt) return
  const attempt = routing.modelAttempt
  const modelCallId = input.store.createModelCall({
    projectId: input.projectId,
    flowId: input.flowId,
    turnId: input.turnId,
    role: "goal_router",
    providerId: attempt.providerId,
    modelId: attempt.modelId,
    request: { phase: "goal_routing", candidateCount: routing.candidates.candidates.length },
  })
  const error = attempt.status === "failed"
    ? input.store.recordError({
        projectId: input.projectId,
        flowId: input.flowId,
        turnId: input.turnId,
        source: "goal_router",
        code: `v2_goal_router_${attempt.errorCode ?? "failed"}`,
        message: attempt.errorCode === "timeout"
          ? "The Flow goal router timed out."
          : attempt.errorCode === "invalid_output"
            ? "The Flow goal router returned invalid structured output after one repair attempt."
            : "The Flow goal router provider failed.",
        details: { fallbackReason: routing.fallbackReason, errorMessage: attempt.errorMessage },
        recoverable: true,
      })
    : undefined
  input.store.completeModelCall({
    modelCallId,
    response: {
      source: routing.source,
      fallbackReason: routing.fallbackReason,
      decision: routing.decision.action,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      durationMs: attempt.durationMs,
    },
    ...(error ? { errorId: error.id } : {}),
  })
  if (attempt.usage) input.recordUsage(modelCallId, attempt.usage)
}
