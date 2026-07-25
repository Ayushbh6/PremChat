import { routeV2Goal, type ActiveGoalCard, type V2GoalRouterResult } from "@socrates/core"
import type { ModelMessage, ModelProvider } from "@socrates/providers"
import type { SocratesStore } from "../services/store"
import type { V2FlowStore } from "../services/v2/flowStore"

type RouteClassicGoalInput = {
  projectId: string
  conversationId: string
  sessionId: string
  turnId: string
  runtimeConfigId: string
  userMessageId: string
  userMessage: string
  workspacePath: string
  recentMessages: ModelMessage[]
  flowStore: V2FlowStore
  sharedStore: SocratesStore
  provider?: ModelProvider
}

export const routeClassicGoal = async (input: RouteClassicGoalInput): Promise<ActiveGoalCard> => {
  const retrievedGoalIds = await input.sharedStore.searchGoalCards(input.projectId, input.userMessage, 12).catch(() => [] as string[])
  const context = input.flowStore.prepareClassicGoalRouting(input.projectId, input.conversationId, retrievedGoalIds)
  const snapshot = input.flowStore.getSnapshot(input.projectId, context.flowId)
  const setting = input.sharedStore.getWorkerModelSetting("goal_router")
  const result = await routeV2Goal({
    projectId: input.projectId,
    flowId: context.flowId,
    turnId: input.turnId,
    workspacePath: input.workspacePath,
    userMessage: input.userMessage,
    goals: snapshot.goals,
    ...(context.currentGoalId ? { selectedGoalId: context.currentGoalId } : {}),
    ...(() => {
      const previousGoalId = input.flowStore.previousClassicGoalId(input.conversationId, context.currentGoalId)
      return previousGoalId ? { previousGoalId } : {}
    })(),
    capsules: snapshot.latestCapsules,
    recentTurns: extractVisibleQnaPairs(input.recentMessages, 3),
    ...(context.currentGoalId ? { selectedGoalTurns: input.flowStore.listClassicGoalRoutingTurns(input.conversationId, context.currentGoalId, 5) } : {}),
    candidateGoalIds: retrievedGoalIds,
    goalSearch: async (searchInput) => {
      const semanticGoalIds = searchInput.mode === "lexical"
        ? []
        : await input.sharedStore.searchGoalCards(input.projectId, searchInput.query, 25).catch(() => [] as string[])
      return input.flowStore.listGoalSearchMatches({
        flowId: context.flowId,
        query: searchInput.query,
        mode: searchInput.mode,
        limit: searchInput.limit,
        semanticGoalIds,
      })
    },
    ...(input.provider ? {
      provider: input.provider,
      model: {
        providerId: setting.providerId,
        ...(setting.authMode ? { authMode: setting.authMode } : {}),
        modelId: setting.modelId,
        thinkingEnabled: setting.thinkingEnabled,
        ...(setting.thinkingEffort ? { thinkingEffort: setting.thinkingEffort } : {}),
        timeoutMs: 8_000,
      },
    } : {}),
  })
  recordClassicGoalRouterAttempt(input, result)
  const effectiveDecision = result.decision.action === "clarify"
    ? context.currentGoalId
      ? { action: "resume" as const, primaryGoalId: context.currentGoalId }
      : { action: "create" as const, title: input.userMessage.trim().slice(0, 120) || "New focus" }
    : result.decision
  const selectedCandidate = effectiveDecision.primaryGoalId
    ? result.candidates.candidates.find((candidate) => candidate.goal.id === effectiveDecision.primaryGoalId)
    : undefined
  const route = effectiveDecision.action === "create"
    ? { action: "create" as const, candidates: [], title: effectiveDecision.title ?? "New focus" }
    : selectedCandidate
      ? { action: "use" as const, candidates: [selectedCandidate.candidate], title: null }
      : { action: "create" as const, candidates: [], title: input.userMessage.trim().slice(0, 120) || "New focus" }
  const appliedContext = {
    flowId: context.flowId,
    ...(context.currentGoalId ? { currentGoalId: context.currentGoalId } : {}),
    ...(context.currentGoalCandidate ? { currentGoalCandidate: context.currentGoalCandidate } : {}),
    candidates: result.candidates.candidates.map((candidate) => ({
      goalId: candidate.goal.id,
      candidate: candidate.candidate,
      status: candidate.goal.status,
      title: candidate.goal.title,
      note: candidate.capsule?.summary ?? candidate.goal.summary ?? "No progress note yet.",
    })),
  }
  return input.flowStore.applyClassicGoalRoute({
    projectId: input.projectId,
    conversationId: input.conversationId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    userMessageId: input.userMessageId,
    userMessage: input.userMessage,
    context: appliedContext,
    route,
  })
}

export const extractVisibleQnaPairs = (messages: readonly ModelMessage[], limit: number): Array<{ user: string; assistant: string }> => {
  const pairs: Array<{ user: string; assistant: string }> = []
  let pendingUser: string | undefined
  for (const message of messages) {
    const content = modelMessageText(message)
    if (message.role === "user") pendingUser = content
    if (message.role === "assistant" && pendingUser) {
      pairs.push({ user: pendingUser, assistant: content })
      pendingUser = undefined
    }
  }
  return pairs.slice(-limit)
}

const modelMessageText = (message: ModelMessage): string => typeof message.content === "string"
  ? message.content
  : message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")

const recordClassicGoalRouterAttempt = (input: RouteClassicGoalInput, result: V2GoalRouterResult): void => {
  const attempt = result.modelAttempt
  if (!attempt) return
  const modelCallId = input.sharedStore.createModelCall({
    conversationId: input.conversationId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    runtimeConfigId: input.runtimeConfigId,
    providerId: attempt.providerId,
    modelId: attempt.modelId,
    request: { role: "goal_router", phase: "goal_routing", candidateCount: result.candidates.candidates.length },
  })
  if (attempt.status === "completed") {
    input.sharedStore.completeModelCall({
      modelCallId,
      response: { source: result.source, decision: result.decision.action, durationMs: attempt.durationMs },
      ...(attempt.usage ? { usage: storedUsage(attempt.usage) } : {}),
    })
  } else {
    const errorId = input.sharedStore.recordError({
      conversationId: input.conversationId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      source: "goal_router",
      code: `goal_router_${attempt.errorCode ?? "failed"}`,
      message: attempt.errorMessage ?? "The Goal Router failed and used its bounded fallback.",
      details: { fallbackReason: result.fallbackReason, durationMs: attempt.durationMs },
      recoverable: true,
    })
    input.sharedStore.failModelCall(modelCallId, errorId)
  }
  if (attempt.usage) {
    input.sharedStore.recordGoalRouterUsage({
      projectId: input.projectId,
      conversationId: input.conversationId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      sourceId: `${input.turnId}:goal_router`,
      providerId: attempt.providerId,
      modelId: attempt.modelId,
      status: attempt.status,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      usage: storedUsage(attempt.usage),
      metadata: { durationMs: attempt.durationMs, source: result.source },
    })
  }
}

const storedUsage = (usage: import("@socrates/providers").ModelUsage) => ({
  ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
  ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
  ...(usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
  ...(usage.cachedInputTokens === undefined ? {} : { cachedInputTokens: usage.cachedInputTokens }),
  ...(usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: usage.cacheWriteTokens }),
  ...(usage.uncachedInputTokens === undefined ? {} : { uncachedInputTokens: usage.uncachedInputTokens }),
  ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
  ...(usage.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
  ...(usage.raw === undefined ? {} : { raw: usage.raw }),
})
