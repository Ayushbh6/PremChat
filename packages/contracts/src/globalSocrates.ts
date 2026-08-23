import { z } from "zod"
import { MAX_INLINE_MESSAGE_CHARS } from "./attachments"
import { idSchema, timestampSchema } from "./entities"
import { runtimeConfigSchema } from "./websocket"

/**
 * Fresh-state global Socrates transport. These schemas deliberately model only
 * goals, tasks, exact exchanges, resources, knowledge, interactions, and the
 * one global pointer. There are no project, conversation, session, or Flow
 * coordinates in this public contract.
 */
export const globalSocratesTaskStatusSchema = z.enum([
  "routing",
  "running",
  "awaiting_input",
  "completed",
  "failed",
  "cancelled",
  "recovering",
])
export const globalSocratesGoalStatusSchema = z.enum(["active", "completed", "pinned", "archived"])
export const globalSocratesAccessModeSchema = z.enum(["read_only", "selected", "full"])
export const globalSocratesInteractionKindSchema = z.enum([
  "approval",
  "credential",
  "clarification",
  "frontier_approval",
  "proposal_acceptance",
])
export const globalSocratesInteractionStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "submitted",
  "cancelled",
  "expired",
])

export const globalSocratesTaskSchema = z.object({
  id: idSchema,
  ordinal: z.number().int().positive(),
  goalId: idSchema.optional(),
  status: globalSocratesTaskStatusSchema,
  requestMessageId: idSchema,
  finalMessageId: idSchema.optional(),
  accessSnapshotId: idSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict()

export const globalSocratesGoalSchema = z.object({
  id: idSchema,
  ordinal: z.number().int().positive(),
  title: z.string().min(1).max(200),
  status: globalSocratesGoalStatusSchema,
  latestCapsuleVersion: z.number().int().positive(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  completedAt: timestampSchema.optional(),
  archivedAt: timestampSchema.optional(),
}).strict()

export const globalSocratesInteractionSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  kind: globalSocratesInteractionKindSchema,
  status: globalSocratesInteractionStatusSchema,
  fingerprint: z.string().min(1).optional(),
  prompt: z.string().min(1).max(10_000),
  publicPayload: z.record(z.unknown()),
  requestedAt: timestampSchema,
}).strict()

export const globalSocratesExactMessageSchema = z.object({
  id: idSchema,
  content: z.string(),
  createdAt: timestampSchema,
  completedAt: timestampSchema.optional(),
}).strict()

export const globalSocratesExchangeSchema = z.object({
  task: globalSocratesTaskSchema,
  userMessage: globalSocratesExactMessageSchema.optional(),
  assistantMessage: globalSocratesExactMessageSchema.optional(),
  interactions: z.array(globalSocratesInteractionSchema),
}).strict()

export const globalSocratesResourceSchema = z.object({
  id: idSchema,
  label: z.string().min(1).max(200),
  kind: z.literal("filesystem_root"),
  availability: z.enum(["available", "missing", "ambiguous", "unavailable"]),
  updatedAt: timestampSchema,
  canonicalPath: z.string().min(1).optional(),
}).strict()

export const globalSocratesKnowledgeSchema = z.object({
  entryId: idSchema,
  kind: z.enum(["identity", "profile", "rule", "memory", "repo_fact"]),
  stableKey: z.string().min(1).max(500),
  versionId: idSchema,
  version: z.number().int().positive(),
  status: z.enum(["pending", "accepted", "superseded", "deleted"]),
  content: z.unknown(),
  provenance: z.record(z.unknown()),
  createdAt: timestampSchema,
}).strict()

export const globalSocratesEventSchema = z.object({
  id: idSchema,
  taskId: idSchema.optional(),
  goalId: idSchema.optional(),
  sequence: z.number().int().positive(),
  type: z.string().min(1).max(200),
  source: z.string().min(1).max(120),
  payload: z.unknown(),
  createdAt: timestampSchema,
}).strict()

export const globalSocratesSnapshotSchema = z.object({
  state: z.object({
    foregroundGoalId: idSchema.optional(),
    activeRootTaskId: idSchema.optional(),
    revision: z.number().int().positive(),
    recoverySequence: z.number().int().nonnegative(),
    updatedAt: timestampSchema,
  }).strict(),
  foregroundGoal: globalSocratesGoalSchema.optional(),
  activeTask: globalSocratesTaskSchema.optional(),
  goals: z.array(globalSocratesGoalSchema),
  pendingInteractions: z.array(globalSocratesInteractionSchema),
  latestEventSequence: z.number().int().nonnegative(),
}).strict()

export const globalSocratesAccessSnapshotSchema = z.object({
  mode: globalSocratesAccessModeSchema,
  revision: z.number().int().positive(),
  roots: z.array(z.object({ id: idSchema, label: z.string().min(1), path: z.string().min(1) }).strict()),
  workingDirectory: z.string().min(1).optional(),
}).strict()

export const globalSocratesGoalPageRequestSchema = z.object({
  beforeOrdinal: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict()
export const globalSocratesGoalPageSchema = z.object({
  goals: z.array(globalSocratesGoalSchema),
  nextBeforeOrdinal: z.number().int().positive().optional(),
}).strict()
export const globalSocratesExchangePageRequestSchema = globalSocratesGoalPageRequestSchema
export const globalSocratesExchangePageSchema = z.object({
  exchanges: z.array(globalSocratesExchangeSchema),
  nextBeforeOrdinal: z.number().int().positive().optional(),
}).strict()

export const globalSocratesBootstrapResponseSchema = z.object({ snapshot: globalSocratesSnapshotSchema }).strict()
export const globalSocratesEventsPageRequestSchema = z.object({
  afterSequence: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(2_000).default(200),
}).strict()
export const globalSocratesEventsPageSchema = z.object({
  events: z.array(globalSocratesEventSchema),
  nextSequence: z.number().int().nonnegative(),
}).strict()

export const globalSocratesInteractionResolveRequestSchema = z.object({
  decision: z.enum(["approved", "rejected", "submitted"]),
  publicResolution: z.record(z.unknown()).optional(),
  /** Ephemeral credential handoff only. The server must never persist this. */
  secret: z.string().min(1).max(16_384).optional(),
}).strict().superRefine((value, context) => {
  if (value.secret !== undefined && value.decision !== "submitted") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["secret"], message: "A secret may only accompany submitted credential input." })
  }
})

export const globalSocratesResourceBindRequestSchema = z.object({
  ownerKind: z.enum(["goal", "task"]),
  ownerId: idSchema,
  path: z.string().min(1),
  label: z.string().trim().min(1).max(200).optional(),
  confirmedBy: z.enum(["explicit_path", "user_confirmation"]),
}).strict()
export const globalSocratesResourceRelinkRequestSchema = z.object({ path: z.string().min(1) }).strict()

const commandEnvelope = <T extends string, S extends z.ZodTypeAny>(type: T, payload: S) => z.object({
  type: z.literal(type),
  payload,
}).strict()

export const globalSocratesSubscribeCommandSchema = commandEnvelope("socrates.global.subscribe", z.object({ afterSequence: z.number().int().nonnegative().optional() }).strict())
export const globalSocratesUnsubscribeCommandSchema = commandEnvelope("socrates.global.unsubscribe", z.object({}).strict())
export const globalSocratesTaskSendCommandSchema = commandEnvelope("socrates.global.task.send", z.object({
  content: z.string().max(MAX_INLINE_MESSAGE_CHARS),
  runtimeConfig: runtimeConfigSchema,
}).strict().superRefine((value, context) => {
  if (!value.content.trim()) context.addIssue({ code: z.ZodIssueCode.custom, path: ["content"], message: "A task message cannot be empty." })
}))
export const globalSocratesTaskCancelCommandSchema = commandEnvelope("socrates.global.task.cancel", z.object({ taskId: idSchema, reason: z.string().trim().min(1).max(2_000).optional() }).strict())
export const globalSocratesInteractionResolveCommandSchema = commandEnvelope("socrates.global.interaction.resolve", z.object({
  interactionId: idSchema,
  input: globalSocratesInteractionResolveRequestSchema,
}).strict())
export const globalSocratesReplayCommandSchema = commandEnvelope("socrates.global.replay", globalSocratesEventsPageRequestSchema)
export const globalSocratesClientCommandSchema = z.discriminatedUnion("type", [
  globalSocratesSubscribeCommandSchema,
  globalSocratesUnsubscribeCommandSchema,
  globalSocratesTaskSendCommandSchema,
  globalSocratesTaskCancelCommandSchema,
  globalSocratesInteractionResolveCommandSchema,
  globalSocratesReplayCommandSchema,
])

export const globalSocratesConnectionReadyEventSchema = commandEnvelope("socrates.global.connection.ready", z.object({ connectionId: idSchema, serverTime: timestampSchema }).strict())
export const globalSocratesSnapshotEventSchema = commandEnvelope("socrates.global.snapshot", globalSocratesBootstrapResponseSchema)
export const globalSocratesEventReplayEventSchema = commandEnvelope("socrates.global.event", globalSocratesEventSchema)
export const globalSocratesErrorEventSchema = commandEnvelope("socrates.global.error", z.object({ code: z.string().min(1), message: z.string().min(1), recoverable: z.boolean() }).strict())
export const globalSocratesServerEventSchema = z.discriminatedUnion("type", [
  globalSocratesConnectionReadyEventSchema,
  globalSocratesSnapshotEventSchema,
  globalSocratesEventReplayEventSchema,
  globalSocratesErrorEventSchema,
])

export type GlobalSocratesTask = z.infer<typeof globalSocratesTaskSchema>
export type GlobalSocratesGoal = z.infer<typeof globalSocratesGoalSchema>
export type GlobalSocratesInteraction = z.infer<typeof globalSocratesInteractionSchema>
export type GlobalSocratesExchange = z.infer<typeof globalSocratesExchangeSchema>
export type GlobalSocratesResource = z.infer<typeof globalSocratesResourceSchema>
export type GlobalSocratesKnowledge = z.infer<typeof globalSocratesKnowledgeSchema>
export type GlobalSocratesEvent = z.infer<typeof globalSocratesEventSchema>
export type GlobalSocratesSnapshot = z.infer<typeof globalSocratesSnapshotSchema>
export type GlobalSocratesAccessSnapshot = z.infer<typeof globalSocratesAccessSnapshotSchema>
export type GlobalSocratesClientCommand = z.infer<typeof globalSocratesClientCommandSchema>
export type GlobalSocratesServerEvent = z.infer<typeof globalSocratesServerEventSchema>
