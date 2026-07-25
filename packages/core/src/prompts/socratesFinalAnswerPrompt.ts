import type { ActiveGoalCard } from "../agent/MemoryRouterAgent"

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
