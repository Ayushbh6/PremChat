import { z } from "zod"

export const goalFinalizationSchema = z
  .object({
    state: z.enum(["active", "completed", "blocked", "discarded"]).describe(
      "Use completed only when the underlying goal outcome is actually achieved; finishing one task or acknowledging a goal normally leaves it active.",
    ),
    note: z.string().trim().min(1).max(600).describe("One or two complete human-facing sentences describing the durable goal state."),
  })
  .strict()
export type GoalFinalization = z.infer<typeof goalFinalizationSchema>

export const socratesFinalAnswerSchema = z
  .object({
    finalAnswer: z.string().trim().min(4).max(120_000).describe("The complete user-facing answer. Never return a fragment or unfinished sentence."),
    goalFinalization: goalFinalizationSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const answer = value.finalAnswer.trim()
    const normalized = answer.toLowerCase()
    const prefix = normalized.slice(0, 2_000)
    const hasToolEnvelope =
      (normalized.includes("<tool_calls") && normalized.includes("<invoke")) ||
      (normalized.includes("<|dsml|") && normalized.includes("tool_calls")) ||
      (normalized.startsWith("<dsml") && normalized.includes("tool_calls")) ||
      (prefix.startsWith("<") && prefix.includes("dsml") && /tool[_\s|]*calls/.test(prefix) && /invoke\s+name/.test(prefix))
    const hasInternalControlEnvelope = /^<(?:socrates_|runtime_)/.test(prefix)
    if (hasToolEnvelope || hasInternalControlEnvelope) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["finalAnswer"],
        message: "Final answer contains an internal or malformed tool-call envelope.",
      })
    }
  })
export type SocratesFinalAnswer = z.infer<typeof socratesFinalAnswerSchema>
