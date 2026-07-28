import { z } from "zod"

export const resolvedTurnExactExchangeSchema = z.object({
  user: z.string().min(1),
  assistant: z.string().min(1),
}).strict()

export const resolvedTurnTransitionSchema = z.object({
  previousGoalTitle: z.string().min(1).max(500),
  relationship: z.string().min(1).max(500),
  verifiedOutcome: z.string().min(1),
}).strict()

export const resolvedTurnMemoryItemSchema = z.object({
  surface: z.string().min(1).max(100),
  reference: z.string().min(1).max(500),
  scope: z.enum(["global", "project"]),
  content: z.string().min(1),
}).strict()

export const candidateRetrievalStatusSchema = z.object({
  goalCandidates: z.enum(["completed", "failed"]),
  memoryCandidates: z.enum(["completed", "failed"]),
  capabilityCandidates: z.enum(["completed", "failed"]),
  warnings: z.array(z.string().min(1)).max(3).default([]),
}).strict()

export const resolvedTurnCapabilityItemSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["skill", "mcp"]),
  name: z.string().min(1),
  description: z.string().min(1),
  scope: z.enum(["builtin", "global", "path"]),
  uri: z.string().startsWith("socrates://"),
}).strict()

export const resolvedTurnContextSeedSchema = z.object({
  goal: z.object({
    title: z.string().min(1).max(500),
    objective: z.string().min(1),
    state: z.string().min(1).max(100),
    progress: z.string().min(1),
    openDecisions: z.array(z.string().min(1)).max(5).default([]),
    blockers: z.array(z.string().min(1)).max(5).default([]),
  }).strict(),
  task: z.object({
    ordinal: z.number().int().positive(),
    request: z.string().min(1),
  }).strict(),
  latestExchange: resolvedTurnExactExchangeSchema.optional(),
  transition: resolvedTurnTransitionSchema.optional(),
  retrieval: candidateRetrievalStatusSchema,
}).strict()

export const resolvedTurnContextSchema = resolvedTurnContextSeedSchema.extend({
  memory: z.array(resolvedTurnMemoryItemSchema).max(8),
  capabilities: z.array(resolvedTurnCapabilityItemSchema).max(8),
}).strict()

export type ResolvedTurnExactExchange = z.infer<typeof resolvedTurnExactExchangeSchema>
export type ResolvedTurnTransition = z.infer<typeof resolvedTurnTransitionSchema>
export type ResolvedTurnMemoryItem = z.infer<typeof resolvedTurnMemoryItemSchema>
export type ResolvedTurnCapabilityItem = z.infer<typeof resolvedTurnCapabilityItemSchema>
export type CandidateRetrievalStatus = z.infer<typeof candidateRetrievalStatusSchema>
export type ResolvedTurnContextSeed = z.infer<typeof resolvedTurnContextSeedSchema>
export type ResolvedTurnContext = z.infer<typeof resolvedTurnContextSchema>
