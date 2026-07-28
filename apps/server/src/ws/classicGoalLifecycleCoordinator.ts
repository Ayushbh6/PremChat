import {
  resolveSocratesGoal,
  type ActiveGoalCard,
  type SocratesAgent,
  type SocratesGoalResolutionResult,
} from "@socrates/core"
import type { CandidateRetrievalStatus, CapabilityCandidate, MemoryCandidate, RuntimeConfig } from "@socrates/contracts"
import type { SocratesStore } from "../services/store"
import type { V2FlowStore } from "../services/v2/flowStore"
import {
  memoryCandidateQueryForTurn,
  memoryGoalContextFromSnapshot,
  refineTurnMemoryCandidates,
  retrieveTurnCandidates,
} from "../services/turn/turnCandidateRetrieval"

type RouteClassicGoalInput = {
  projectId: string
  conversationId: string
  sessionId: string
  turnId: string
  runtimeConfigId: string
  userMessageId: string
  userMessage: string
  workspacePath: string
  flowStore: V2FlowStore
  sharedStore: SocratesStore
  agent: SocratesAgent
  runtimeConfig: RuntimeConfig
  abortSignal?: AbortSignal
}

export type RoutedClassicGoal =
  | {
      status: "resolved"
      goal: ActiveGoalCard
      memoryCandidates: readonly MemoryCandidate[]
      capabilityCandidates: readonly CapabilityCandidate[]
      retrieval: CandidateRetrievalStatus
    }
  | {
      status: "clarification"
      question: string
      memoryCandidates: readonly MemoryCandidate[]
      capabilityCandidates: readonly CapabilityCandidate[]
      retrieval: CandidateRetrievalStatus
    }

export const resolveClassicGoal = async (input: RouteClassicGoalInput): Promise<RoutedClassicGoal> => {
  const initialContext = input.flowStore.prepareClassicGoalResolution(input.projectId, input.conversationId)
  const initialSnapshot = input.flowStore.getSnapshot(input.projectId, initialContext.flowId)
  const initialMemoryGoal = memoryGoalContextFromSnapshot({
    ...(initialContext.currentGoalId ? { goalId: initialContext.currentGoalId } : {}),
    goals: initialSnapshot.goals,
    capsules: initialSnapshot.latestCapsules,
  })
  const retrieved = await retrieveTurnCandidates({
    retrieveGoals: () => input.sharedStore.retrieveGoalCandidates(input.projectId, input.userMessage, 3),
    retrieveMemory: () => input.sharedStore.retrieveMemoryCandidates(input.projectId, memoryCandidateQueryForTurn({
      userMessage: input.userMessage,
      ...(initialMemoryGoal ? { goal: initialMemoryGoal } : {}),
      phase: "broad",
    }), true),
    retrieveCapabilities: () => input.sharedStore.retrieveCapabilityCandidates(input.projectId, input.userMessage, 5),
  })
  const retrievedGoalIds = retrieved.goalCandidates.map((candidate) => candidate.goalId)
  const context = retrievedGoalIds.length > 0
    ? input.flowStore.prepareClassicGoalResolution(input.projectId, input.conversationId, retrievedGoalIds)
    : initialContext
  const snapshot = input.flowStore.getSnapshot(input.projectId, context.flowId)
  const previousGoalId = input.flowStore.previousClassicGoalId(input.conversationId, context.currentGoalId)
  const result = await resolveSocratesGoal({
    agent: input.agent,
    projectId: input.projectId,
    conversationId: input.conversationId,
    sessionId: input.sessionId,
    flowId: context.flowId,
    turnId: input.turnId,
    workspacePath: input.workspacePath,
    runtimeConfig: input.runtimeConfig,
    userMessage: input.userMessage,
    goals: snapshot.goals,
    ...(context.currentGoalId ? { selectedGoalId: context.currentGoalId } : {}),
    ...(previousGoalId ? { previousGoalId } : {}),
    capsules: snapshot.latestCapsules,
    ...(context.currentGoalId ? {
      selectedGoalTurns: input.flowStore.listClassicGoalResolutionTurns(input.conversationId, context.currentGoalId, 1),
    } : {}),
    candidateGoalIds: retrievedGoalIds,
    cacheKey: `project:${input.projectId}:goal-resolution`,
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  })
  recordClassicGoalResolutionAttempt(input, result)
  if (result.decision.action === "clarify") {
    return {
      status: "clarification",
      question: result.decision.clarificationQuestion ?? "Which goal should I continue?",
      memoryCandidates: retrieved.memoryCandidates,
      capabilityCandidates: retrieved.capabilityCandidates,
      retrieval: retrieved.status,
    }
  }
  const selectedCandidate = result.decision.primaryGoalId
    ? result.candidates.candidates.find((candidate) => candidate.goal.id === result.decision.primaryGoalId)
    : undefined
  const route = result.decision.action === "create"
    ? { action: "create" as const, candidates: [], title: result.decision.title ?? "New focus" }
    : selectedCandidate
      ? { action: "use" as const, candidates: [selectedCandidate.candidate], title: null }
      : { action: "create" as const, candidates: [], title: input.userMessage.trim() || "New focus" }
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
  const goal = input.flowStore.applyClassicGoalResolution({
    projectId: input.projectId,
    conversationId: input.conversationId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    userMessageId: input.userMessageId,
    userMessage: input.userMessage,
    context: appliedContext,
    route,
  })
  const refinedMemory = await refineTurnMemoryCandidates({
    userMessage: input.userMessage,
    ...(initialContext.currentGoalId ? { previousGoalId: initialContext.currentGoalId } : {}),
    boundGoal: goal,
    memoryCandidates: retrieved.memoryCandidates,
    status: retrieved.status,
    retrieveMemory: (query) => input.sharedStore.retrieveMemoryCandidates(input.projectId, query, true),
  })
  return {
    status: "resolved",
    goal,
    memoryCandidates: refinedMemory.memoryCandidates,
    capabilityCandidates: retrieved.capabilityCandidates,
    retrieval: refinedMemory.status,
  }
}

const recordClassicGoalResolutionAttempt = (input: RouteClassicGoalInput, result: SocratesGoalResolutionResult): void => {
  const attempt = result.modelAttempt
  if (!attempt) return
  const modelCallId = input.sharedStore.createModelCall({
    conversationId: input.conversationId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    runtimeConfigId: input.runtimeConfigId,
    providerId: attempt.providerId,
    modelId: attempt.modelId,
    request: { role: "main", phase: "goal_resolution", candidateCount: result.candidates.candidates.length },
  })
  if (attempt.status === "completed") {
    input.sharedStore.completeModelCall({
      modelCallId,
      response: { source: result.source, decision: result.decision.action, durationMs: attempt.durationMs },
      ...(attempt.usage ? { usage: storedUsage(attempt.usage) } : {}),
    })
    return
  }
  const errorId = input.sharedStore.recordError({
    conversationId: input.conversationId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    source: "goal_resolution",
    code: `goal_resolution_${attempt.errorCode ?? "failed"}`,
    message: attempt.errorMessage ?? "Socrates could not safely resolve the goal and used its conservative fallback.",
    details: { durationMs: attempt.durationMs },
    recoverable: true,
  })
  input.sharedStore.failModelCall(modelCallId, errorId)
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
