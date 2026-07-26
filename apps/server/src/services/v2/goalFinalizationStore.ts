import type { GoalFinalization } from "@socrates/contracts"
import { createId, nowIso, SocratesError } from "@socrates/shared"
import { and, eq } from "drizzle-orm"
import type { DatabaseHandle } from "../../db/client"
import { v2Flows, v2Goals, v2GoalTransitions } from "../../db/schema"

export const persistGoalFinalization = (
  handle: DatabaseHandle,
  input: {
    projectId: string
    flowId: string
    goalId: string
    turnId: string
    finalization: GoalFinalization
  },
): void => {
  const flow = handle.db.select().from(v2Flows).where(and(
    eq(v2Flows.id, input.flowId),
    eq(v2Flows.projectId, input.projectId),
  )).limit(1).get()
  if (!flow || flow.status === "archived") {
    throw new SocratesError("v2_flow_not_found", "Seamless Flow not found.", { recoverable: true })
  }
  const goal = handle.db.select().from(v2Goals).where(and(
    eq(v2Goals.id, input.goalId),
    eq(v2Goals.flowId, input.flowId),
  )).limit(1).get()
  if (!goal) return

  const now = nowIso()
  const requestedStatus = input.finalization.state === "active" ? "foreground" : input.finalization.state
  const nextStatus = goal.kind === "general" ? "foreground" : requestedStatus
  handle.sqlite.transaction(() => {
    if (goal.status !== nextStatus) {
      handle.db.update(v2Goals).set({
        status: nextStatus,
        summary: input.finalization.note,
        lastActiveAt: now,
        completedAt: nextStatus === "completed" ? now : null,
        updatedAt: now,
      }).where(eq(v2Goals.id, goal.id)).run()
      const sequenceRow = handle.sqlite.prepare(
        "SELECT MAX(sequence) AS value FROM v2_goal_transitions WHERE flow_id = ?",
      ).get(input.flowId) as { value: number | null }
      handle.db.insert(v2GoalTransitions).values({
        id: createId("v2gtr"),
        flowId: input.flowId,
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
    handle.db.update(v2Goals).set({
      summary: input.finalization.note,
      lastActiveAt: now,
      updatedAt: now,
    }).where(eq(v2Goals.id, goal.id)).run()
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
