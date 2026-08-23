import type { SocratesAgent } from "@socrates/core"
import type { RuntimeConfig } from "@socrates/contracts"
import { SocratesError } from "@socrates/shared"
import { CanonicalSocratesStore, type CanonicalTask } from "../services/canonical/canonicalSocratesStore"

/**
 * The canonical no-tool semantic decision. It reads only global goal capsules
 * from the new store, invokes the same main Socrates, then performs exactly one
 * goal binding or creates a typed clarification interaction.
 */
export const resolveCanonicalGoal = async (input: {
  store: CanonicalSocratesStore
  agent: Pick<SocratesAgent, "resolveGoal">
  task: CanonicalTask
  userMessage: string
  runtimeConfig: RuntimeConfig
  workspacePath: string
  abortSignal?: AbortSignal
}): Promise<{ kind: "bound"; task: CanonicalTask; goalId: string } | { kind: "clarification"; interactionId: string }> => {
  const snapshot = input.store.getSnapshot()
  const candidates = input.store.goalResolutionCandidates()
  const current = snapshot.foregroundGoal
    ? candidates.find((candidate) => candidate.id === snapshot.foregroundGoal!.id)
    : undefined
  const older = candidates.filter((candidate) => candidate.id !== current?.id).slice(0, 3)
  const result = await input.agent.resolveGoal({
    projectId: "global",
    conversationId: "global-socrates",
    sessionId: input.task.id,
    turnId: input.task.id,
    workspacePath: input.workspacePath,
    providerId: input.runtimeConfig.providerId,
    modelId: input.runtimeConfig.modelId,
    runtimeConfig: input.runtimeConfig,
    userMessage: input.userMessage,
    ...(current ? { current: toCandidate(current, 0) } : {}),
    older: older.map((candidate, index) => toCandidate(candidate, index + 1)),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  })
  input.store.recordModelCall({
    taskId: input.task.id,
    role: "main_goal_decision",
    providerId: result.attempt.providerId,
    modelId: result.attempt.modelId,
    status: result.attempt.status,
    request: { phase: "goal_resolution", currentGoalId: current?.id ?? null, olderGoalIds: older.map((candidate) => candidate.id) },
    response: { source: result.source, decision: result.decision.decision },
    ...(result.attempt.usages.length ? { usage: result.attempt.usages } : {}),
    ...(result.attempt.error ? { error: result.attempt.error } : {}),
    startedAt: result.attempt.startedAt,
    completedAt: result.attempt.completedAt,
  })

  if (result.decision.decision === "new") {
    const bound = input.store.bindTaskToGoal({ taskId: input.task.id, decision: "new", title: result.decision.title, objective: input.userMessage })
    return { kind: "bound", ...bound }
  }
  if (result.decision.decision === "current" && current) {
    const bound = input.store.bindTaskToGoal({ taskId: input.task.id, decision: "current", goalId: current.id })
    return { kind: "bound", ...bound }
  }
  if (result.decision.decision === "older") {
    const selected = older[result.decision.candidate - 1]
    if (!selected) throw new SocratesError("goal_candidate_unavailable", "The goal decision selected an unavailable older goal.", { recoverable: true })
    const bound = input.store.bindTaskToGoal({ taskId: input.task.id, decision: "existing", goalId: selected.id })
    return { kind: "bound", ...bound }
  }
  // A first request must have a goal even if a provider fails to produce its
  // structured decision. There is no ambiguous older goal in that state.
  if (!current && older.length === 0) {
    const title = input.userMessage.replace(/\s+/g, " ").trim().slice(0, 120) || "First goal"
    const bound = input.store.bindTaskToGoal({ taskId: input.task.id, decision: "new", title, objective: input.userMessage })
    return { kind: "bound", ...bound }
  }
  const interactionId = input.store.requestClarification(
    input.task.id,
    result.decision.decision === "clarify" ? result.decision.question : "Which existing goal should this continue?",
    { candidateGoalIds: candidates.map((candidate) => candidate.id), source: result.source },
  )
  return { kind: "clarification", interactionId }
}

const toCandidate = (goal: { status: string; title: string; objective: string; progress: string }, candidate: number) => ({
  candidate,
  status: goal.status,
  title: goal.title,
  objective: goal.objective,
  progress: goal.progress,
})
