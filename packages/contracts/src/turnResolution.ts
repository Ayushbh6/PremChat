import { z } from "zod"

export const socratesGoalResolutionOutputSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("current") }).strict(),
  z.object({ decision: z.literal("older"), candidate: z.number().int().min(1).max(5) }).strict(),
  z.object({ decision: z.literal("new"), title: z.string().trim().min(1).max(200) }).strict(),
  z.object({ decision: z.literal("clarify"), question: z.string().trim().min(1).max(500) }).strict(),
])

export type SocratesGoalResolutionOutput = z.infer<typeof socratesGoalResolutionOutputSchema>

// This is deliberately separate from the normalized result schema above. Models
// receive one flat object instead of an anyOf branch, which avoids first-branch
// bias in provider-native structured generation. The runtime normalizes it after
// validating the decision-specific field.
export const socratesGoalResolutionModelOutputSchema = z.object({
  decision: z.enum(["current", "older", "new", "clarify"]),
  candidate: z.number().int().min(1).max(5).nullable(),
  title: z.string().trim().min(1).max(200).nullable(),
  question: z.string().trim().min(1).max(500).nullable(),
}).strict()

export type SocratesGoalResolutionModelOutput = z.infer<typeof socratesGoalResolutionModelOutputSchema>

export const goalCandidateSchema = z.object({
  resultNumber: z.number().int().positive(),
  goalId: z.string().min(1),
  title: z.string().min(1),
  content: z.string().min(1),
  occurredAt: z.string().min(1),
}).strict()

export const goalCandidateRetrievalSchema = z.object({
  results: z.array(goalCandidateSchema).max(12),
  totalMatches: z.number().int().nonnegative(),
}).strict()

export type GoalCandidate = z.infer<typeof goalCandidateSchema>
export type GoalCandidateRetrieval = z.infer<typeof goalCandidateRetrievalSchema>
