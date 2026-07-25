import { z } from "zod"
import { goalFinalizationSchema } from "./memoryRouting"

export const socratesFinalAnswerSchema = z
  .object({
    finalAnswer: z.string().min(1).max(120_000),
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
    const hasInternalControlEnvelope = /^<(?:socrates_|runtime_|memory_router|v2_focus_runtime)/.test(prefix)
    if (hasToolEnvelope || hasInternalControlEnvelope) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["finalAnswer"],
        message: "Final answer contains an internal or malformed tool-call envelope.",
      })
    }
  })
export type SocratesFinalAnswer = z.infer<typeof socratesFinalAnswerSchema>

export const soulConfirmationAgentOutputSchema = z
  .object({
    decision: z.enum(["yes", "no"]),
    reason: z.string().min(1).max(500),
  })
  .strict()
export type SoulConfirmationAgentOutput = z.infer<typeof soulConfirmationAgentOutputSchema>
