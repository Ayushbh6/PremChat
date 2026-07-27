import { resolveSocratesGoal, type SocratesAgent, type SocratesGoalResolutionResult } from "@socrates/core"
import type {
  CandidateRetrievalStatus,
  MemoryCandidate,
  V2GoalRoutingRun,
  V2Message,
  V2RuntimeConfig,
  V2Turn,
} from "@socrates/contracts"
import type { ModelUsage } from "@socrates/providers"
import type { SocratesStore } from "../services/store"
import type { V2FlowStore } from "../services/v2/flowStore"
import { retrieveTurnCandidates } from "../services/turn/turnCandidateRetrieval"

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
  agent: SocratesAgent
  runtimeConfig: V2RuntimeConfig
  clarificationAnswer?: string
  abortSignal?: AbortSignal
  recordUsage: (modelCallId: string, usage: ModelUsage) => void
}

type CandidateContext = {
  memoryCandidates: readonly MemoryCandidate[]
  retrieval: CandidateRetrievalStatus
}

export type ResolvedFlowGoal =
  | ({ status: "clarification"; routingRun: V2GoalRoutingRun; message: V2Message; turn: V2Turn } & CandidateContext)
  | ({ status: "resolved"; goalId: string; applied: ReturnType<V2FlowStore["applyRouting"]>; result: SocratesGoalResolutionResult } & CandidateContext)

export const resolveFlowGoal = async (input: ResolveFlowGoalInput): Promise<ResolvedFlowGoal> => {
  const snapshot = input.store.getSnapshot(input.projectId, input.flowId)
  const selectedGoalId = input.preferredGoalId && snapshot.goals.some((goal) => goal.id === input.preferredGoalId)
    ? input.preferredGoalId
    : snapshot.flow.foregroundGoalId
  const previousGoalId = input.store.previousRoutingGoalId(input.flowId, selectedGoalId)
  const retrieved = await retrieveTurnCandidates({
    retrieveGoals: () => input.sharedStore.retrieveGoalCandidates(input.projectId, input.messageContent, 12),
    retrieveMemory: () => input.sharedStore.retrieveMemoryCandidates(input.projectId, {
      query: input.messageContent,
      mode: "combined",
      scope: "all",
      limit: 8,
    }, true),
  })
  const retrievedGoalIds = retrieved.goalCandidates.map((candidate) => candidate.goalId)
  const resolutionGoals = input.store.listGoalsForResolution(input.flowId, [
    ...(selectedGoalId ? [selectedGoalId] : []),
    ...(previousGoalId ? [previousGoalId] : []),
    ...retrievedGoalIds,
  ])
  const routing = await resolveSocratesGoal({
    agent: input.agent,
    projectId: input.projectId,
    conversationId: input.flowId,
    sessionId: input.turnId,
    flowId: input.flowId,
    turnId: input.turnId,
    workspacePath: input.workspacePath,
    runtimeConfig: input.runtimeConfig,
    userMessage: input.messageContent,
    goals: resolutionGoals,
    ...(selectedGoalId ? { selectedGoalId } : {}),
    ...(previousGoalId ? { previousGoalId } : {}),
    capsules: input.store.listCapsulesForResolution(input.flowId, resolutionGoals.map((goal) => goal.id)),
    ...(selectedGoalId ? { selectedGoalTurns: input.store.listGoalRoutingTurns(input.flowId, selectedGoalId, 1) } : {}),
    candidateGoalIds: retrievedGoalIds,
    ...(input.clarificationAnswer ? { clarificationAnswer: input.clarificationAnswer } : {}),
    cacheKey: `project:${input.projectId}:goal-resolution`,
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  })
  recordGoalResolutionAttempt(input, routing)
  if (routing.decision.action === "clarify" && !input.clarificationAnswer) {
    const clarification = input.store.requestRoutingClarification({
      projectId: input.projectId,
      flowId: input.flowId,
      turnId: input.turnId,
      messageId: input.messageId,
      result: routing,
      providerId: input.runtimeConfig.providerId,
      modelId: input.runtimeConfig.modelId,
    })
    return { status: "clarification", ...clarification, memoryCandidates: retrieved.memoryCandidates, retrieval: retrieved.status }
  }
  const effective = routing.decision.action === "clarify"
    ? routing.candidates.foreground
      ? { ...routing, decision: { action: "continue" as const, primaryGoalId: routing.candidates.foreground.goal.id } }
      : routing
    : routing
  if (effective.decision.action === "clarify") {
    const clarification = input.store.requestRoutingClarification({
      projectId: input.projectId,
      flowId: input.flowId,
      turnId: input.turnId,
      messageId: input.messageId,
      result: effective,
      providerId: input.runtimeConfig.providerId,
      modelId: input.runtimeConfig.modelId,
    })
    return { status: "clarification", ...clarification, memoryCandidates: retrieved.memoryCandidates, retrieval: retrieved.status }
  }
  const applied = input.store.applyRouting({
    projectId: input.projectId,
    flowId: input.flowId,
    turnId: input.turnId,
    messageId: input.messageId,
    messageContent: input.messageContent,
    result: effective,
    providerId: input.runtimeConfig.providerId,
    modelId: input.runtimeConfig.modelId,
  })
  return {
    status: "resolved",
    goalId: applied.goal.id,
    applied,
    result: effective,
    memoryCandidates: retrieved.memoryCandidates,
    retrieval: retrieved.status,
  }
}

const recordGoalResolutionAttempt = (input: ResolveFlowGoalInput, routing: SocratesGoalResolutionResult): void => {
  const attempt = routing.modelAttempt
  if (!attempt) return
  const modelCallId = input.store.createModelCall({
    projectId: input.projectId,
    flowId: input.flowId,
    turnId: input.turnId,
    role: "main_agent",
    providerId: attempt.providerId,
    modelId: attempt.modelId,
    request: { phase: "goal_resolution", candidateCount: routing.candidates.candidates.length },
  })
  const error = attempt.status === "failed"
    ? input.store.recordError({
        projectId: input.projectId,
        flowId: input.flowId,
        turnId: input.turnId,
        source: "goal_resolution",
        code: `goal_resolution_${attempt.errorCode ?? "failed"}`,
        message: attempt.errorMessage ?? "Socrates could not safely resolve the goal and used its conservative fallback.",
        details: { durationMs: attempt.durationMs },
        recoverable: true,
      })
    : undefined
  input.store.completeModelCall({
    modelCallId,
    response: {
      source: routing.source,
      decision: routing.decision.action,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      durationMs: attempt.durationMs,
    },
    ...(error ? { errorId: error.id } : {}),
  })
  if (attempt.usage) input.recordUsage(modelCallId, attempt.usage)
}
