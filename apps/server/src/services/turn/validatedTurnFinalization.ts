import type { DatabaseHandle } from "../../db/client"

export type ValidatedTurnFinalizationSteps<TAnswer> = {
  persistAnswerAndTask: () => TAnswer
  persistBoundGoalAndCapsule?: (answer: TAnswer) => void
  persistUsageAndAudit?: (answer: TAnswer) => void
}

/**
 * The single commit boundary for a validated Socrates result. View adapters
 * supply only their storage projections; ordering and atomicity live here.
 */
export const commitValidatedTurnFinalization = <TAnswer>(
  handle: DatabaseHandle,
  steps: ValidatedTurnFinalizationSteps<TAnswer>,
): TAnswer => {
  const commit = handle.sqlite.transaction(() => {
    const answer = steps.persistAnswerAndTask()
    steps.persistBoundGoalAndCapsule?.(answer)
    steps.persistUsageAndAudit?.(answer)
    return answer
  })
  return commit()
}
