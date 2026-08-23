import type { GoalFinalization } from "@socrates/contracts"
import { createId, nowIso, SocratesError } from "@socrates/shared"
import { eq } from "drizzle-orm"
import type { DatabaseHandle } from "../../db/client"
import { globalSocratesState, socratesGoals, socratesGoalTransitions } from "../../db/schema"

export const persistGoalFinalization = (
  handle: DatabaseHandle,
  input: {
    goalId: string
    turnId: string
    finalization: GoalFinalization
  },
): void => {
  const state = handle.db.select().from(globalSocratesState).where(eq(globalSocratesState.id, "global")).limit(1).get()
  if (!state) throw new SocratesError("socrates_state_missing", "Global Socrates state is unavailable.", { recoverable: true })
  const goal = handle.db.select().from(socratesGoals).where(eq(socratesGoals.id, input.goalId)).limit(1).get()
  if (!goal) return

  const now = nowIso()
  const requestedStatus = input.finalization.state === "active" ? "foreground" : input.finalization.state
  const nextStatus = requestedStatus
  handle.sqlite.transaction(() => {
    if (goal.status !== nextStatus) {
      handle.db.update(socratesGoals).set({
        status: nextStatus,
        summary: input.finalization.note,
        lastActiveAt: now,
        completedAt: nextStatus === "completed" ? now : null,
        updatedAt: now,
      }).where(eq(socratesGoals.id, goal.id)).run()
      const sequenceRow = handle.sqlite.prepare("SELECT MAX(sequence) AS value FROM v2_goal_transitions").get() as { value: number | null }
      handle.db.insert(socratesGoalTransitions).values({
        id: createId("v2gtr"),
        goalId: input.goalId,
        turnId: input.turnId,
        fromStatus: goal.status,
        toStatus: nextStatus,
        reason: finalizationReason(input.finalization),
        note: input.finalization.note,
        createdAt: now,
        sequence: sequenceRow.value === null ? 1 : sequenceRow.value + 1,
      }).run()
      return
    }
    handle.db.update(socratesGoals).set({
      summary: input.finalization.note,
      lastActiveAt: now,
      updatedAt: now,
    }).where(eq(socratesGoals.id, goal.id)).run()
    // Lifecycle and view selection are deliberately independent. Terminal
    // states stay selected until explicit routing or user focus changes them.
  })()
}

const finalizationReason = (finalization: GoalFinalization): "completed" | "blocked" | "discarded" | "router_decision" =>
  finalization.state === "completed"
    ? "completed"
    : finalization.state === "blocked"
      ? "blocked"
      : finalization.state === "discarded"
        ? "discarded"
        : "router_decision"
