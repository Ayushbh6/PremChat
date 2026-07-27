import type {
  CandidateRetrievalStatus,
  GoalCandidate,
  GoalCandidateRetrieval,
  MemoryCandidate,
  MemoryCandidateRetrieval,
} from "@socrates/contracts"

export type TurnCandidateRetrievalResult = Readonly<{
  goalCandidates: readonly GoalCandidate[]
  memoryCandidates: readonly MemoryCandidate[]
  status: CandidateRetrievalStatus
}>

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
    warnings.push("Memory retrieval failed; no retrieved memory was attached.")
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
