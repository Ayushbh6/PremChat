import { z } from "zod"
import { idSchema } from "./entities"

export const v2LiveActivityPhaseSchema = z.enum([
  "routing",
  "thinking",
  "tool",
  "preparing_answer",
  "awaiting_input",
])

export const v2LiveActivitySchema = z
  .object({
    turnId: idSchema,
    phase: v2LiveActivityPhaseSchema,
    label: z.string().trim().min(1).max(120),
  })
  .strict()

export const v2LiveActivityUpdatedPayloadSchema = z
  .object({ activity: v2LiveActivitySchema })
  .strict()

export type V2LiveActivityPhase = z.infer<typeof v2LiveActivityPhaseSchema>
export type V2LiveActivity = z.infer<typeof v2LiveActivitySchema>
