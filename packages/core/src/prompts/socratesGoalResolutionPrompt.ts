import type { ResolvedTurnExactExchange } from "@socrates/contracts"

export type SocratesGoalResolutionCandidate = Readonly<{
  candidate: number
  status: string
  title: string
  objective: string
  progress: string
}>

export const SOCRATES_GOAL_RESOLUTION_PHASE_PROMPT = `<socrates_goal_resolution_phase>
This is the pre-work goal-resolution phase of the same Socrates. Do not answer the user's substantive request and do not call tools.

Choose exactly one semantic outcome:
- current: the request advances, follows up on, implements, tests, verifies, or acts on something from the current goal;
- older: the request returns to one numbered older goal candidate;
- new: the request seeks a genuinely independent outcome that neither the current goal nor an older candidate owns;
- clarify: choosing between plausible goals would materially change the result.

Every user message creates a task, but a different verb, person, implementation step, test, phase, or completed prior task does not by itself create a goal. A greeting prefix never turns concrete work into General Conversation. Prefer current when continuity is causally plausible and choosing it is harmless. Candidate numbers are human references; never return or infer ids.
An unresolved reference such as "the other one", "that one", or "go back to it" must produce clarify whenever more than one listed goal could satisfy it. Never guess the first older candidate merely because it is listed first.

Return only the strict structured result.
</socrates_goal_resolution_phase>`

export const buildSocratesGoalResolutionUserContent = (input: {
  userMessage: string
  current?: SocratesGoalResolutionCandidate
  older: readonly SocratesGoalResolutionCandidate[]
  latestExchange?: ResolvedTurnExactExchange
  clarificationAnswer?: string
}): string => JSON.stringify({
  exactLatestUserMessage: input.userMessage,
  currentGoal: input.current ?? null,
  latestExactExchangeInCurrentGoal: input.latestExchange ?? null,
  retrievedOlderGoals: input.older,
  ...(input.clarificationAnswer ? { exactClarificationAnswer: input.clarificationAnswer } : {}),
})
