import type {
  CandidateRetrievalStatus,
  GoalCandidate,
  GoalCandidateRetrieval,
  MemoryCandidate,
  MemoryCandidateRetrieval,
} from "@socrates/contracts"
import {
  buildGoalAwareMemoryQuery,
  rankExactMemoryCandidates,
  type ActiveGoalCard,
  type MemoryGoalQueryContext,
} from "@socrates/core"

const INITIAL_MEMORY_FAILURE = "Memory retrieval failed; no retrieved memory was attached."

export type TurnCandidateRetrievalResult = Readonly<{
  goalCandidates: readonly GoalCandidate[]
  memoryCandidates: readonly MemoryCandidate[]
  status: CandidateRetrievalStatus
}>

export type TurnMemoryRefinementResult = Readonly<{
  memoryCandidates: readonly MemoryCandidate[]
  status: CandidateRetrievalStatus
  refinement: "not_needed" | "completed" | "failed"
}>

export const memoryGoalContextFromSnapshot = (input: {
  goalId?: string
  goals: readonly { id: string; title: string; summary?: string | undefined }[]
  capsules: readonly {
    goalId: string
    summary: string
    decisions: readonly string[]
    openQuestions: readonly string[]
    nextActions: readonly string[]
  }[]
}): MemoryGoalQueryContext | undefined => {
  if (!input.goalId) return undefined
  const goal = input.goals.find((candidate) => candidate.id === input.goalId)
  if (!goal) return undefined
  const capsule = input.capsules.find((candidate) => candidate.goalId === input.goalId)
  return {
    goalId: goal.id,
    title: goal.title,
    objective: goal.summary ?? goal.title,
    note: capsule?.summary ?? goal.summary ?? goal.title,
    ...(capsule?.decisions.length ? { decisions: capsule.decisions } : {}),
    ...(capsule?.openQuestions.length ? { openDecisions: capsule.openQuestions } : {}),
    ...(capsule?.nextActions.length ? { nextActions: capsule.nextActions } : {}),
  }
}

export const memoryCandidateQueryForTurn = (input: {
  userMessage: string
  goal?: MemoryGoalQueryContext
  phase: "broad" | "bound"
}) => ({
  query: buildGoalAwareMemoryQuery(input),
  mode: "combined" as const,
  scope: "all" as const,
  limit: 8 as const,
})

export const retrieveTurnCandidates = async (input: {
  retrieveGoals: () => Promise<GoalCandidateRetrieval>
  retrieveMemory: () => Promise<MemoryCandidateRetrieval>
}): Promise<TurnCandidateRetrievalResult> => {
  const goalPromise = Promise.resolve().then(input.retrieveGoals)
  const memoryPromise = Promise.resolve().then(input.retrieveMemory)
  const [goalResult, memoryResult] = await Promise.allSettled([
    goalPromise,
    memoryPromise,
  ])
  const warnings: string[] = []
  if (goalResult.status === "rejected") {
    warnings.push("Older goal retrieval failed; the current goal was retained independently.")
  }
  if (memoryResult.status === "rejected") {
    warnings.push(INITIAL_MEMORY_FAILURE)
  }
  return {
    goalCandidates: goalResult.status === "fulfilled" ? goalResult.value.results : [],
    memoryCandidates: memoryResult.status === "fulfilled" ? memoryResult.value.results : [],
    status: {
      goalCandidates: goalResult.status === "fulfilled" ? "completed" : "failed",
      memoryCandidates: memoryResult.status === "fulfilled" ? "completed" : "failed",
      warnings,
    },
  }
}

export const refineTurnMemoryCandidates = async (input: {
  userMessage: string
  previousGoalId?: string
  boundGoal: ActiveGoalCard
  memoryCandidates: readonly MemoryCandidate[]
  status: CandidateRetrievalStatus
  retrieveMemory: (query: ReturnType<typeof memoryCandidateQueryForTurn>) => Promise<MemoryCandidateRetrieval>
}): Promise<TurnMemoryRefinementResult> => {
  const goalChanged = Boolean(input.previousGoalId && input.previousGoalId !== input.boundGoal.goalId)
  const hasEligibleMemory = rankExactMemoryCandidates({
    candidates: input.memoryCandidates,
    userMessage: input.userMessage,
    goal: input.boundGoal,
    limit: 1,
  }).length > 0
  if (!goalChanged && hasEligibleMemory) {
    return { memoryCandidates: input.memoryCandidates, status: input.status, refinement: "not_needed" }
  }

  try {
    const refined = await input.retrieveMemory(memoryCandidateQueryForTurn({
      userMessage: input.userMessage,
      goal: input.boundGoal,
      phase: "bound",
    }))
    const memoryCandidates = rankExactMemoryCandidates({
      candidates: [...refined.results, ...input.memoryCandidates],
      userMessage: input.userMessage,
      goal: input.boundGoal,
      limit: 8,
    })
    const recoveredInitialFailure = input.status.memoryCandidates === "failed"
    return {
      memoryCandidates,
      status: {
        ...input.status,
        memoryCandidates: "completed",
        warnings: recoveredInitialFailure
          ? replaceMemoryWarning(input.status.warnings, "Initial memory retrieval failed; goal-aware retrieval recovered after goal binding.")
          : input.status.warnings,
      },
      refinement: "completed",
    }
  } catch {
    const warning = input.status.memoryCandidates === "failed"
      ? "Memory retrieval failed before and after goal binding; no retrieved memory was attached."
      : "Goal-aware memory refinement failed; the initial exact candidates were retained."
    return {
      memoryCandidates: input.memoryCandidates,
      status: {
        ...input.status,
        warnings: replaceMemoryWarning(input.status.warnings, warning),
      },
      refinement: "failed",
    }
  }
}

const replaceMemoryWarning = (warnings: readonly string[], replacement: string): string[] => [
  ...warnings.filter((warning) => warning !== INITIAL_MEMORY_FAILURE && !warning.startsWith("Goal-aware memory") && !warning.startsWith("Memory retrieval failed before")),
  replacement,
].slice(-2)
