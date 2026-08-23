import { z } from "zod"
import { idSchema } from "./entities"

// Human-safe, replace-in-place activity projected by the canonical Socrates runtime.

export const socratesLiveActivityPhaseSchema = z.enum([
  "routing",
  "thinking",
  "tool",
  "preparing_answer",
  "awaiting_input",
])

export const socratesLiveActivitySchema = z
  .object({
    turnId: idSchema,
    phase: socratesLiveActivityPhaseSchema,
    label: z.string().trim().min(1).max(120),
  })
  .strict()

export const socratesLiveActivityUpdatedPayloadSchema = z
  .object({ activity: socratesLiveActivitySchema })
  .strict()

export type SocratesLiveActivityPhase = z.infer<typeof socratesLiveActivityPhaseSchema>
export type SocratesLiveActivity = z.infer<typeof socratesLiveActivitySchema>
