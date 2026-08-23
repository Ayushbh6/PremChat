import { resolveSocratesGoal as resolveGoalDecision, type SocratesAgent, type SocratesGoalResolutionResult } from "@socrates/core"
import type {
  CandidateRetrievalStatus,
  CapabilityCandidate,
  MemoryCandidate,
  SocratesGoalRoutingRun,
  SocratesMessage,
  SocratesRuntimeConfig,
  SocratesTurn,
} from "@socrates/contracts"
import type { ModelUsage } from "@socrates/providers"
import type { SocratesStore } from "../services/store"
import type { GlobalSocratesStore } from "../services/socrates/socratesStore"
import {
  memoryCandidateQueryForTurn,
  memoryGoalContextFromSnapshot,
  refineTurnMemoryCandidates,
  retrieveTurnCandidates,
} from "../services/turn/turnCandidateRetrieval"

type ResolveSocratesGoalInput = {
  projectId: string
  turnId: string
  messageId: string
  messageContent: string
  preferredGoalId?: string
  workspacePath: string
  store: GlobalSocratesStore
  sharedStore: SocratesStore
  agent: SocratesAgent
  runtimeConfig: SocratesRuntimeConfig
  clarificationAnswer?: string
  abortSignal?: AbortSignal
  recordUsage: (modelCallId: string, usage: ModelUsage) => void
}

type CandidateContext = {
  memoryCandidates: readonly MemoryCandidate[]
  capabilityCandidates: readonly CapabilityCandidate[]
  retrieval: CandidateRetrievalStatus
}

export type ResolvedSocratesGoal =
  | ({ status: "clarification"; routingRun: SocratesGoalRoutingRun; message: SocratesMessage; turn: SocratesTurn } & CandidateContext)
  | ({ status: "resolved"; goalId: string; applied: ReturnType<GlobalSocratesStore["applyRouting"]>; result: SocratesGoalResolutionResult } & CandidateContext)

export const resolveSocratesGoal = async (input: ResolveSocratesGoalInput): Promise<ResolvedSocratesGoal> => {
  const snapshot = input.store.getSnapshot()
  const selectedGoalId = input.preferredGoalId && snapshot.goals.some((goal) => goal.id === input.preferredGoalId)
    ? input.preferredGoalId
    : snapshot.state.foregroundGoalId
  const previousGoalId = input.store.previousRoutingGoalId(selectedGoalId)
  const snapshotGoals = snapshot.goals
  const initialMemoryGoal = memoryGoalContextFromSnapshot({
    ...(selectedGoalId ? { goalId: selectedGoalId } : {}),
    goals: snapshotGoals,
    capsules: snapshot.latestCapsules,
  })
  const currentGoalProjectId = selectedGoalId
    ? input.store.getGoalHomeProjectId(selectedGoalId)
    : input.projectId
  const globalProjectIds = input.store.listRuntimeProjectIds(input.projectId)
  const retrieved = await retrieveTurnCandidates({
    retrieveGoals: () => input.sharedStore.retrieveGlobalGoalCandidates(globalProjectIds, input.messageContent, 3),
    retrieveMemory: () => input.sharedStore.retrieveMemoryCandidates(currentGoalProjectId, memoryCandidateQueryForTurn({
      userMessage: input.messageContent,
      ...(initialMemoryGoal ? { goal: initialMemoryGoal } : {}),
      phase: "broad",
    }), true),
    retrieveCapabilities: () => input.sharedStore.retrieveCapabilityCandidates(input.projectId, input.messageContent, 5),
  })
  const retrievedGoalIds = retrieved.goalCandidates.map((candidate) => candidate.goalId)
  const resolutionGoals = input.store.listGoalsForResolution([
    ...(selectedGoalId ? [selectedGoalId] : []),
    ...(previousGoalId ? [previousGoalId] : []),
    ...retrievedGoalIds,
  ])
  const routing = await resolveGoalDecision({
    agent: input.agent,
    projectId: input.projectId,
    conversationId: "global-socrates",
    sessionId: input.turnId,
    turnId: input.turnId,
    workspacePath: input.workspacePath,
    runtimeConfig: input.runtimeConfig,
    userMessage: input.messageContent,
    goals: resolutionGoals,
    ...(selectedGoalId ? { selectedGoalId } : {}),
    ...(previousGoalId ? { previousGoalId } : {}),
    capsules: input.store.listCapsulesForResolution(resolutionGoals.map((goal) => goal.id)),
    ...(selectedGoalId ? { selectedGoalTurns: input.store.listGoalRoutingTurns(selectedGoalId, 1) } : {}),
    candidateGoalIds: retrievedGoalIds,
    ...(input.clarificationAnswer ? { clarificationAnswer: input.clarificationAnswer } : {}),
    cacheKey: "socrates:goal-resolution",
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  })
  recordGoalResolutionAttempt(input, routing)
  if (routing.decision.action === "clarify" && !input.clarificationAnswer) {
    const clarification = input.store.requestRoutingClarification({
      projectId: input.projectId,
      turnId: input.turnId,
      messageId: input.messageId,
      result: routing,
      providerId: input.runtimeConfig.providerId,
      modelId: input.runtimeConfig.modelId,
    })
    return { status: "clarification", ...clarification, memoryCandidates: retrieved.memoryCandidates, capabilityCandidates: retrieved.capabilityCandidates, retrieval: retrieved.status }
  }
  const effective = routing.decision.action === "clarify"
    ? routing.candidates.foreground
      ? { ...routing, decision: { action: "continue" as const, primaryGoalId: routing.candidates.foreground.goal.id } }
      : routing
    : routing
  if (effective.decision.action === "clarify") {
    const clarification = input.store.requestRoutingClarification({
      projectId: input.projectId,
      turnId: input.turnId,
      messageId: input.messageId,
      result: effective,
      providerId: input.runtimeConfig.providerId,
      modelId: input.runtimeConfig.modelId,
    })
    return { status: "clarification", ...clarification, memoryCandidates: retrieved.memoryCandidates, capabilityCandidates: retrieved.capabilityCandidates, retrieval: retrieved.status }
  }
  const applied = input.store.applyRouting({
    projectId: input.projectId,
    turnId: input.turnId,
    messageId: input.messageId,
    messageContent: input.messageContent,
    result: effective,
    providerId: input.runtimeConfig.providerId,
    modelId: input.runtimeConfig.modelId,
  })
  const boundGoal = input.store.getActiveGoalCard({
    goalId: applied.goal.id,
    sourceTurnId: input.turnId,
    taskRequest: input.messageContent,
  })
  const boundGoalProjectId = input.store.getGoalHomeProjectId(applied.goal.id)
  const refinedMemory = await refineTurnMemoryCandidates({
    userMessage: input.messageContent,
    ...(selectedGoalId ? { previousGoalId: selectedGoalId } : {}),
    boundGoal,
    memoryCandidates: retrieved.memoryCandidates,
    status: retrieved.status,
    retrieveMemory: (query) => input.sharedStore.retrieveMemoryCandidates(boundGoalProjectId, query, true),
  })
  return {
    status: "resolved",
    goalId: applied.goal.id,
    applied,
    result: effective,
    memoryCandidates: refinedMemory.memoryCandidates,
    capabilityCandidates: retrieved.capabilityCandidates,
    retrieval: refinedMemory.status,
  }
}

const recordGoalResolutionAttempt = (input: ResolveSocratesGoalInput, routing: SocratesGoalResolutionResult): void => {
  const attempt = routing.modelAttempt
  if (!attempt) return
  const modelCallId = input.store.createModelCall({
    projectId: input.projectId,
    turnId: input.turnId,
    role: "main_agent",
    providerId: attempt.providerId,
    modelId: attempt.modelId,
    request: { phase: "goal_resolution", candidateCount: routing.candidates.candidates.length },
  })
  const error = attempt.status === "failed"
    ? input.store.recordError({
        projectId: input.projectId,
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
