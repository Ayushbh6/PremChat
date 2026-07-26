import type { ActiveGoalCard } from "../agent/MemoryRouterAgent"

export const buildSocratesReconciliationCheckpoint = (input: {
  activeGoal?: ActiveGoalCard
  proposedAnswer?: string
}): string => [
  "<socrates_reconciliation_checkpoint>",
  "This is the mandatory hard pre-final checkpoint for the current task. Do not answer the user in this response.",
  "You are the same Socrates that performed the work. Review the verified work and tool results already present in this task, including automatic wait/resume continuations. Decide whether durable .socrates reconciliation is required.",
  "When durable project state, architectural decisions, constraints, blockers, workflows, handoff facts, or documented behavior changed, read the exact project_docs or repo_docs section, apply the smallest canonical replacement, then re-read that same section and verify the stale claim is gone and the replacement is present. Never append a competing authority path.",
  "When nothing durable changed, make no docs mutation. Ordinary workspace-only restrictions do not suppress bounded .socrates reconciliation, but a genuine semantic instruction not to remember/save/store the content is authoritative and must produce no reconciliation from that content.",
  "Backend-owned project_notes runtime_context and state_ledger are never mutation targets. Use only the normal main Socrates tools; there is no reconciliation router or planner.",
  "After all required reconciliation is complete and verified, return no user-facing answer yet. The runtime will request the strict no-tool final object next.",
  ...(input.activeGoal
    ? [`Bound goal: ${input.activeGoal.title}`, `Current goal state: ${input.activeGoal.state}`, `Current goal note: ${input.activeGoal.note}`]
    : ["No canonical goal is attached to this compatibility task."]),
  ...(input.proposedAnswer?.trim()
    ? ["Provisional answer to reassess after reconciliation:", input.proposedAnswer.trim().slice(0, 20_000)]
    : []),
  "</socrates_reconciliation_checkpoint>",
].join("\n")

export const buildSocratesFinalAnswerCheckpoint = (input: {
  activeGoal?: ActiveGoalCard
  proposedAnswer?: string
}): string => [
  "<socrates_final_answer_checkpoint>",
  "All tool work and required .socrates reconciliation are finished. Return the strict final-answer object now and do not call tools.",
  "Write finalAnswer as the complete user-facing answer. Re-evaluate the user's actual request against the verified work; do not repeat internal control text, tool syntax, or a provisional draft merely because it appeared earlier.",
  "Set goalFinalization from this validated answer. Use completed only when the requested coherent outcome is actually achieved by the answer; active when useful work remains; blocked only for a real external dependency; discarded only when the user abandoned or replaced the goal.",
  "Keep goalFinalization.note to one or two short human-facing lines. The note is ledger context, not part of finalAnswer.",
  ...(input.activeGoal
    ? [
        `Active goal: ${input.activeGoal.title}`,
        `Prior goal state: ${input.activeGoal.state}`,
        `Prior goal note: ${input.activeGoal.note}`,
      ]
    : ["No canonical goal is attached to this compatibility turn. Return active with a concise note; the runtime will ignore that ledger value."]),
  ...(input.proposedAnswer?.trim()
    ? ["Provisional answer evidence to reassess:", input.proposedAnswer.trim().slice(0, 20_000)]
    : []),
  "</socrates_final_answer_checkpoint>",
].join("\n")
