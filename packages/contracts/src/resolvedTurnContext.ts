import { z } from "zod"

export const resolvedTurnHistoryItemSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8_000),
}).strict()

export const resolvedTurnTransitionSchema = z.object({
  previousGoalTitle: z.string().min(1).max(500),
  relationship: z.string().min(1).max(500),
  verifiedOutcome: z.string().min(1).max(4_000),
}).strict()

export const resolvedTurnMemoryItemSchema = z.object({
  surface: z.string().min(1).max(100),
  reference: z.string().min(1).max(500),
  content: z.string().min(1).max(4_000),
}).strict()

export const resolvedTurnContextSeedSchema = z.object({
  project: z.object({
    name: z.string().min(1).max(500),
    description: z.string().max(2_000).optional(),
  }).strict(),
  goal: z.object({
    title: z.string().min(1).max(500),
    objective: z.string().min(1).max(2_000),
    state: z.string().min(1).max(100),
    progress: z.string().min(1).max(4_000),
  }).strict(),
  task: z.object({
    ordinal: z.number().int().positive(),
    request: z.string().min(1).max(20_000),
  }).strict(),
  transition: resolvedTurnTransitionSchema.optional(),
  history: z.array(resolvedTurnHistoryItemSchema).max(10),
}).strict()

export const resolvedTurnContextSchema = resolvedTurnContextSeedSchema.extend({
  memory: z.array(resolvedTurnMemoryItemSchema).max(8),
}).strict()

export type ResolvedTurnHistoryItem = z.infer<typeof resolvedTurnHistoryItemSchema>
export type ResolvedTurnTransition = z.infer<typeof resolvedTurnTransitionSchema>
export type ResolvedTurnMemoryItem = z.infer<typeof resolvedTurnMemoryItemSchema>
export type ResolvedTurnContextSeed = z.infer<typeof resolvedTurnContextSeedSchema>
export type ResolvedTurnContext = z.infer<typeof resolvedTurnContextSchema>
