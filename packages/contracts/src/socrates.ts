import { z } from "zod"
import { MAX_INLINE_MESSAGE_CHARS, MAX_MESSAGE_ATTACHMENTS } from "./attachments"
import { apiErrorSchema } from "./api"
import { idSchema, timestampSchema } from "./entities"
import { providerAuthModeSchema, providerIdSchema, thinkingEffortSchema } from "./models"
import { socratesLiveActivitySchema, socratesLiveActivityUpdatedPayloadSchema } from "./socratesPresentation"

/**
 * Canonical global Socrates transport and persistence projections.
 *
 * A connection is only a transport/recovery session. Goals and root tasks are
 * durable product entities; there is deliberately no project, conversation, or
 * compatibility-container scope in this contract.
 */

export const SOCRATES_SCHEMA_VERSION = 3 as const

export const SOCRATES_OPENROUTER_STT_MODEL_IDS = [
  "nvidia/parakeet-tdt-0.6b-v3",
  "microsoft/mai-transcribe-1.5",
  "mistralai/voxtral-mini-transcribe",
] as const

export const SOCRATES_LOCAL_WHISPER_MODEL_IDS = ["base.en", "small.en"] as const
export const SOCRATES_LOCAL_KOKORO_MODEL_ID = "kokoro-82m" as const

export const socratesSchemaVersionSchema = z.literal(SOCRATES_SCHEMA_VERSION)

export const socratesStateSchema = z
  .object({
    id: idSchema,
    foregroundGoalId: idSchema.optional(),
    activeTaskId: idSchema.optional(),
    revision: z.number().int().nonnegative(),
    lastEventSequence: z.number().int().nonnegative(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()

export const socratesGoalStatusSchema = z.enum(["foreground", "parked", "blocked", "completed", "discarded", "archived"])
export const socratesGoalOriginSchema = z.enum(["router", "user", "recovery", "system"])
export const socratesGoalKindSchema = z.enum(["general", "work"])

export const socratesGoalSchema = z
  .object({
    id: idSchema,
    ordinal: z.number().int().positive(),
    title: z.string().min(1).max(200),
    summary: z.string().max(20_000).optional(),
    kind: socratesGoalKindSchema,
    status: socratesGoalStatusSchema,
    origin: socratesGoalOriginSchema,
    priority: z.number().int().min(0).max(100),
    pinned: z.boolean(),
    lastActiveAt: timestampSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    completedAt: timestampSchema.optional(),
    archivedAt: timestampSchema.optional(),
  })
  .strict()

export const socratesGoalTransitionReasonSchema = z.enum([
  "created",
  "router_decision",
  "user_intent",
  "focus_switch",
  "blocked",
  "resumed",
  "completed",
  "discarded",
  "archived",
  "reopened",
  "auto_archived",
  "recovery",
])

export const socratesGoalTransitionSchema = z
  .object({
    id: idSchema,
    goalId: idSchema,
    turnId: idSchema.optional(),
    routingRunId: idSchema.optional(),
    fromStatus: socratesGoalStatusSchema.nullable(),
    toStatus: socratesGoalStatusSchema,
    reason: socratesGoalTransitionReasonSchema,
    note: z.string().max(2_000).optional(),
    sequence: z.number().int().positive(),
    createdAt: timestampSchema,
  })
  .strict()

export const socratesGoalRoutingDecisionSchema = z.enum([
  "continue_foreground",
  "resume_parked",
  "create_goal",
  "clarify",
])
export const socratesGoalRoutingStatusSchema = z.enum(["running", "awaiting_clarification", "completed", "failed", "fallback"])

export const socratesGoalRouterOutputSchema = z
  .object({
    action: z.enum(["use", "create", "clarify"]),
    candidates: z.array(z.number().int().min(1).max(25)).max(5),
    title: z.string().min(1).max(200).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const candidates = [...new Set(value.candidates)]
    if (candidates.length !== value.candidates.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["candidates"], message: "Candidate numbers must be unique." })
    }
    if (value.action === "use" && (candidates.length !== 1 || value.title !== null)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["candidates"], message: "Use requires one candidate and a null title." })
    }
    if (value.action === "create" && (candidates.length !== 0 || !value.title?.trim())) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["title"], message: "Create requires a short title and no candidates." })
    }
    if (value.action === "clarify" && (candidates.length < 2 || value.title !== null)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["candidates"], message: "Clarify requires two to five candidates and a null title." })
    }
  })
export type SocratesGoalRouterOutput = z.infer<typeof socratesGoalRouterOutputSchema>

export const socratesGoalRoutingRunSchema = z
  .object({
    id: idSchema,
    turnId: idSchema,
    messageId: idSchema,
    foregroundGoalId: idSchema.optional(),
    candidateGoalIds: z.array(idSchema).max(32),
    selectedGoalId: idSchema.optional(),
    decision: socratesGoalRoutingDecisionSchema.optional(),
    confidence: z.number().min(0).max(1).optional(),
    rationale: z.string().max(4_000).optional(),
    clarificationQuestion: z.string().min(1).max(1_000).optional(),
    clarificationCandidateGoalIds: z.array(idSchema).max(5),
    clarificationAnswerMessageId: idSchema.optional(),
    providerId: providerIdSchema.optional(),
    modelId: z.string().min(1).optional(),
    status: socratesGoalRoutingStatusSchema,
    fallbackReason: z.string().max(2_000).optional(),
    startedAt: timestampSchema,
    completedAt: timestampSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.status === "completed" || value.status === "fallback") && !value.decision) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decision"],
        message: "A completed or fallback routing run requires a decision.",
      })
    }
    if (value.status === "awaiting_clarification" && (value.decision !== "clarify" || !value.clarificationQuestion || value.clarificationCandidateGoalIds.length < 2)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clarificationQuestion"],
        message: "A clarification routing run requires a question and at least two plausible focus candidates.",
      })
    }
    if (value.decision && value.decision !== "clarify" && !value.selectedGoalId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selectedGoalId"],
        message: "A non-clarification routing decision requires a selected goal.",
      })
    }
  })

export const socratesGoalCapsuleStatusSchema = z.enum(["active", "superseded", "final"])

export const socratesGoalCapsuleSchema = z
  .object({
    id: idSchema,
    goalId: idSchema,
    version: z.number().int().positive(),
    status: socratesGoalCapsuleStatusSchema,
    summary: z.string().min(1).max(30_000),
    decisions: z.array(z.string().min(1).max(4_000)).max(100),
    openQuestions: z.array(z.string().min(1).max(4_000)).max(100),
    nextActions: z.array(z.string().min(1).max(4_000)).max(100),
    evidenceHandles: z.array(z.string().min(1).max(512)).max(500),
    sourceThroughSequence: z.number().int().nonnegative(),
    tokenEstimate: z.number().int().nonnegative(),
    createdByTurnId: idSchema.optional(),
    createdAt: timestampSchema,
  })
  .strict()

export const socratesGoalMessageRelationSchema = z.enum(["primary", "context", "reference"])

export const socratesGoalMessageLinkSchema = z
  .object({
    id: idSchema,
    goalId: idSchema,
    messageId: idSchema,
    turnId: idSchema.optional(),
    relation: socratesGoalMessageRelationSchema,
    createdAt: timestampSchema,
  })
  .strict()

export const socratesTurnStatusSchema = z.enum([
  "queued",
  "routing",
  "awaiting_clarification",
  "running",
  "waiting",
  "suspended",
  "completed",
  "failed",
  "cancelled",
])

export const socratesTurnSchema = z
  .object({
    id: idSchema,
    goalId: idSchema.optional(),
    ordinal: z.number().int().positive(),
    userMessageId: idSchema.optional(),
    assistantMessageId: idSchema.optional(),
    status: socratesTurnStatusSchema,
    waitingReason: z.string().max(1_000).optional(),
    errorId: idSchema.optional(),
    startedAt: timestampSchema,
    updatedAt: timestampSchema,
    completedAt: timestampSchema.optional(),
    failedAt: timestampSchema.optional(),
    cancelledAt: timestampSchema.optional(),
  })
  .strict()

export const socratesRuntimeConfigSchema = z
  .object({
    providerId: providerIdSchema,
    authMode: providerAuthModeSchema.optional(),
    modelId: z.string().min(1),
    thinkingEnabled: z.boolean(),
    thinkingEffort: thinkingEffortSchema.optional(),
    approvalMode: z.enum(["manual", "approve_all", "read_only_auto"]),
    sandboxMode: z.enum(["read_only", "workspace_write", "danger_full_access"]).describe("Legacy runtime compatibility only; main Socrates filesystem scope comes from the immutable turn authorization snapshot."),
    contextWindowTokens: z.number().int().positive().optional(),
  })
  .strict()

export const socratesMessageRoleSchema = z.enum(["user", "assistant", "system", "tool", "developer"])
export const socratesMessageStatusSchema = z.enum(["streaming", "completed", "failed", "cancelled"])
export const socratesMessageKindSchema = z.enum(["standard", "routing_clarification", "bridge_import"])
export const socratesMessageAttachmentKindSchema = z.enum(["image", "text", "skill_zip", "audio"])
export const socratesMessageAttachmentStatusSchema = z.enum(["draft", "attached", "deleted"])

export const socratesMessageAttachmentSchema = z
  .object({
    id: idSchema,
    goalId: idSchema.optional(),
    turnId: idSchema.optional(),
    messageId: idSchema.optional(),
    artifactId: idSchema,
    kind: socratesMessageAttachmentKindSchema,
    fileName: z.string().min(1).max(512),
    mimeType: z.string().min(1).max(255),
    sizeBytes: z.number().int().nonnegative(),
    uri: z.string().min(1),
    url: z.string().min(1).optional(),
    status: socratesMessageAttachmentStatusSchema,
    createdAt: timestampSchema,
  })
  .strict()

export const socratesMessageSchema = z
  .object({
    id: idSchema,
    goalId: idSchema.optional(),
    turnId: idSchema.optional(),
    ordinal: z.number().int().positive(),
    role: socratesMessageRoleSchema,
    kind: socratesMessageKindSchema,
    content: z.string(),
    reasoning: z.string().optional(),
    status: socratesMessageStatusSchema,
    parentMessageId: idSchema.optional(),
    attachments: z.array(socratesMessageAttachmentSchema).max(MAX_MESSAGE_ATTACHMENTS).optional(),
    createdAt: timestampSchema,
    completedAt: timestampSchema.optional(),
  })
  .strict()

export const socratesEvidenceKindSchema = z.enum([
  "user_attachment",
  "tool_output",
  "terminal_output",
  "file",
  "pdf_page",
  "retrieval_chunk",
  "web_resource",
  "model_output",
  "system",
])

export const socratesEvidenceItemSchema = z
  .object({
    id: idSchema,
    handle: z.string().min(1).max(512),
    goalId: idSchema.optional(),
    turnId: idSchema.optional(),
    sourceKind: socratesEvidenceKindSchema,
    sourceId: idSchema.optional(),
    sourceUri: z.string().min(1).optional(),
    title: z.string().min(1).max(1_000),
    mimeType: z.string().min(1).max(255).optional(),
    content: z.string().optional(),
    contentHash: z.string().min(1).max(256),
    sizeBytes: z.number().int().nonnegative().optional(),
    tokenEstimate: z.number().int().nonnegative().optional(),
    locator: z.unknown().optional(),
    createdAt: timestampSchema,
  })
  .strict()

export const socratesRuntimeEventSchema = z
  .object({
    id: idSchema,
    goalId: idSchema.optional(),
    turnId: idSchema.optional(),
    sequence: z.number().int().positive(),
    type: z.string().regex(/^socrates\./),
    source: z.string().min(1).max(100),
    payload: z.unknown(),
    createdAt: timestampSchema,
  })
  .strict()

// Router values remain parseable only for historical v2_model_calls rows.
export const socratesModelCallRoleSchema = z.enum([
  "main_agent",
  "frontier_agent",
  "memory_router",
  "goal_router",
  "context_distiller",
  "context_compactor",
])
export const socratesRuntimeStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled"])

export const socratesModelCallSchema = z
  .object({
    id: idSchema,
    goalId: idSchema.optional(),
    turnId: idSchema.optional(),
    role: socratesModelCallRoleSchema,
    providerId: providerIdSchema,
    modelId: z.string().min(1),
    status: socratesRuntimeStatusSchema,
    errorId: idSchema.optional(),
    startedAt: timestampSchema,
    completedAt: timestampSchema.optional(),
  })
  .strict()

export const socratesUsageEventSchema = z
  .object({
    id: idSchema,
    goalId: idSchema.optional(),
    turnId: idSchema.optional(),
    modelCallId: idSchema,
    providerId: providerIdSchema,
    modelId: z.string().min(1),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative().optional(),
    createdAt: timestampSchema,
  })
  .strict()

export const socratesToolCallStatusSchema = z.enum([
  "pending",
  "awaiting_approval",
  "running",
  "completed",
  "failed",
  "cancelled",
])

export const socratesToolCallSchema = z
  .object({
    id: idSchema,
    goalId: idSchema.optional(),
    turnId: idSchema,
    modelCallId: idSchema.optional(),
    toolName: z.string().min(1).max(200),
    status: socratesToolCallStatusSchema,
    arguments: z.unknown(),
    result: z.unknown().optional(),
    requiresApproval: z.boolean(),
    approvalId: idSchema.optional(),
    errorId: idSchema.optional(),
    startedAt: timestampSchema.optional(),
    completedAt: timestampSchema.optional(),
  })
  .strict()

export const socratesApprovalStatusSchema = z.enum(["pending", "approved", "rejected", "expired", "cancelled"])

export const socratesApprovalSchema = z
  .object({
    id: idSchema,
    goalId: idSchema.optional(),
    turnId: idSchema,
    toolCallId: idSchema.optional(),
    status: socratesApprovalStatusSchema,
    actionKind: z.string().min(1).max(200),
    action: z.unknown(),
    decision: z.enum(["approved", "rejected"]).optional(),
    reason: z.string().max(2_000).optional(),
    requestedAt: timestampSchema,
    decidedAt: timestampSchema.optional(),
  })
  .strict()

export const socratesTerminalStatusSchema = z.enum([
  "starting",
  "running",
  "awaiting_input",
  "detached",
  "exited",
  "stopped",
  "stale",
  "missing",
])

export const socratesTerminalSchema = z
  .object({
    id: idSchema,
    goalId: idSchema.optional(),
    turnId: idSchema.optional(),
    name: z.string().min(1).max(96),
    command: z.string().min(1),
    cwd: z.string().min(1),
    status: socratesTerminalStatusSchema,
    awaitingInput: z.boolean(),
    stateVersion: z.number().int().nonnegative(),
    exitCode: z.number().int().optional(),
    startedAt: timestampSchema,
    updatedAt: timestampSchema,
    completedAt: timestampSchema.optional(),
  })
  .strict()

export const socratesErrorSchema = z
  .object({
    id: idSchema,
    goalId: idSchema.optional(),
    turnId: idSchema.optional(),
    source: z.string().min(1).max(200),
    code: z.string().min(1).max(200),
    message: z.string().min(1),
    recoverable: z.boolean(),
    details: z.unknown().optional(),
    createdAt: timestampSchema,
  })
  .strict()

export const socratesArtifactSchema = z
  .object({
    id: idSchema,
    goalId: idSchema.optional(),
    turnId: idSchema.optional(),
    kind: z.string().min(1).max(200),
    path: z.string().min(1).optional(),
    uri: z.string().min(1).optional(),
    contentHash: z.string().min(1).max(256).optional(),
    mimeType: z.string().min(1).max(255).optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    createdAt: timestampSchema,
  })
  .strict()

export const socratesAgentTaskStatusSchema = z.enum(["running", "waiting", "ready", "completed", "failed", "cancelled"])
export const socratesTaskSourceRuntimeSchema = z.literal("socrates")

export const socratesAgentTaskSchema = z
  .object({
    id: idSchema,
    sourceRuntime: socratesTaskSourceRuntimeSchema.optional(),
    canonicalTaskId: idSchema.optional(),
    goalId: idSchema.optional(),
    rootTurnId: idSchema,
    currentTurnId: idSchema,
    status: socratesAgentTaskStatusSchema,
    runtimeConfig: socratesRuntimeConfigSchema,
    waitingOnTerminalIds: z.array(idSchema).max(8),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    completedAt: timestampSchema.optional(),
  })
  .strict()

export const socratesFeedbackRatingSchema = z.enum(["thumbs_up", "thumbs_down"])

export const socratesFeedbackSchema = z
  .object({
    id: idSchema,
    goalId: idSchema.optional(),
    turnId: idSchema.optional(),
    messageId: idSchema,
    modelCallId: idSchema.optional(),
    rating: socratesFeedbackRatingSchema,
    reasonCode: z.string().min(1).max(200).optional(),
    note: z.string().max(4_000).optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()

export const socratesMcpSecretSourceSchema = z.enum(["user_input", "workspace_env"])
export const socratesCredentialInputStatusSchema = z.enum(["pending", "submitted", "cancelled", "expired"])

export const socratesCredentialInputRequestSchema = z
  .object({
    id: idSchema,
    goalId: idSchema.optional(),
    turnId: idSchema,
    toolCallId: idSchema,
    providerToolCallId: z.string().min(1).optional(),
    serverId: z.string().min(1).max(64),
    serverLabel: z.string().min(1).max(120).optional(),
    envKey: z.string().min(1).max(128).regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    source: socratesMcpSecretSourceSchema,
    status: socratesCredentialInputStatusSchema,
    requestedAt: timestampSchema,
    resolvedAt: timestampSchema.optional(),
  })
  .strict()

export const socratesLocalWhisperModelSchema = z.enum(SOCRATES_LOCAL_WHISPER_MODEL_IDS)
export const socratesOpenRouterSttModelSchema = z.enum(SOCRATES_OPENROUTER_STT_MODEL_IDS)
export const socratesLocalKokoroModelSchema = z.literal(SOCRATES_LOCAL_KOKORO_MODEL_ID)
export const socratesSpeechJobStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled"])

const socratesSpeechJobBaseShape = {
  id: idSchema,
  goalId: idSchema.optional(),
  turnId: idSchema.optional(),
  messageId: idSchema.optional(),
  status: socratesSpeechJobStatusSchema,
  language: z.string().min(1).max(64).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  errorId: idSchema.optional(),
  createdAt: timestampSchema,
  startedAt: timestampSchema.optional(),
  completedAt: timestampSchema.optional(),
}

export const socratesLocalWhisperSpeechJobSchema = z
  .object({
    ...socratesSpeechJobBaseShape,
    kind: z.literal("transcription"),
    engine: z.literal("local_whisper"),
    modelId: socratesLocalWhisperModelSchema,
    inputArtifactId: idSchema,
    transcriptText: z.string().optional(),
  })
  .strict()

export const socratesOpenRouterSpeechJobSchema = z
  .object({
    ...socratesSpeechJobBaseShape,
    kind: z.literal("transcription"),
    engine: z.literal("openrouter"),
    modelId: socratesOpenRouterSttModelSchema,
    inputArtifactId: idSchema,
    transcriptText: z.string().optional(),
  })
  .strict()

export const socratesLocalKokoroSpeechJobSchema = z
  .object({
    ...socratesSpeechJobBaseShape,
    kind: z.literal("synthesis"),
    engine: z.literal("local_kokoro"),
    modelId: socratesLocalKokoroModelSchema,
    inputText: z.string().min(1).max(100_000),
    voiceId: z.string().min(1).max(128),
    speed: z.number().min(0.5).max(2),
    outputArtifactId: idSchema.optional(),
  })
  .strict()

export const socratesSpeechJobSchema = z.discriminatedUnion("engine", [
  socratesLocalWhisperSpeechJobSchema,
  socratesOpenRouterSpeechJobSchema,
  socratesLocalKokoroSpeechJobSchema,
])

export const SOCRATES_SNAPSHOT_MESSAGE_LIMIT = 100
export const SOCRATES_MESSAGE_PAGE_MAX = 200
export const SOCRATES_GOAL_PAGE_SIZE = 25
export const SOCRATES_GOAL_EXCHANGE_PAGE_SIZE = 25
export const SOCRATES_GOAL_EXCHANGE_PAGE_MAX = 100
export const SOCRATES_GOAL_EXCHANGE_WORK_ITEM_MAX = 50
export const SOCRATES_GLOBAL_HISTORY_SEARCH_MAX = 50

export const socratesMessageWindowSchema = z
  .object({
    hasEarlier: z.boolean(),
    beforeOrdinal: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.hasEarlier && value.beforeOrdinal === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["beforeOrdinal"],
        message: "A message cursor is required when earlier messages are available.",
      })
    }
    if (!value.hasEarlier && value.beforeOrdinal !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["beforeOrdinal"],
        message: "A message cursor must be omitted when the message window is complete.",
      })
    }
  })

export const socratesGoalWindowSchema = z
  .object({
    totalGoals: z.number().int().nonnegative(),
    hasEarlier: z.boolean(),
    beforeOrdinal: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.hasEarlier && value.beforeOrdinal === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["beforeOrdinal"],
        message: "A goal cursor is required when earlier goals are available.",
      })
    }
    if (!value.hasEarlier && value.beforeOrdinal !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["beforeOrdinal"],
        message: "A goal cursor must be omitted when the goal window is complete.",
      })
    }
  })

export const socratesGlobalGoalWindowSchema = z
  .object({
    totalGoals: z.number().int().nonnegative(),
    hasEarlier: z.boolean(),
    beforeCursor: z.string().min(1).max(1_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.hasEarlier && value.beforeCursor === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["beforeCursor"],
        message: "A global goal cursor is required when earlier goals are available.",
      })
    }
    if (!value.hasEarlier && value.beforeCursor !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["beforeCursor"],
        message: "A global goal cursor must be omitted when the global goal window is complete.",
      })
    }
  })

export const socratesGoalExchangeWindowSchema = z
  .object({
    totalExchanges: z.number().int().nonnegative(),
    hasEarlier: z.boolean(),
    beforeOrdinal: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.hasEarlier && value.beforeOrdinal === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["beforeOrdinal"],
        message: "An exchange cursor is required when earlier goal exchanges are available.",
      })
    }
    if (!value.hasEarlier && value.beforeOrdinal !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["beforeOrdinal"],
        message: "An exchange cursor must be omitted when the goal exchange window is complete.",
      })
    }
  })

export const socratesGoalExchangeSourceRuntimeSchema = socratesTaskSourceRuntimeSchema

export const socratesGoalExchangeFailureSchema = z
  .object({
    source: z.string().min(1).max(200),
    code: z.string().min(1).max(200),
    message: z.string().min(1),
    recoverable: z.boolean(),
    occurredAt: timestampSchema,
  })
  .strict()

export const socratesGoalExchangeToolDisclosureSchema = z
  .object({
    id: idSchema,
    turnId: idSchema,
    toolName: z.string().min(1).max(200),
    status: socratesToolCallStatusSchema,
    requiresApproval: z.boolean(),
    startedAt: timestampSchema.optional(),
    completedAt: timestampSchema.optional(),
  })
  .strict()

export const socratesGoalExchangeEvidenceDisclosureSchema = z
  .object({
    id: idSchema,
    turnId: idSchema.optional(),
    sourceKind: socratesEvidenceKindSchema,
    title: z.string().min(1).max(1_000),
    sourceUri: z.string().min(1).optional(),
    mimeType: z.string().min(1).max(255).optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    createdAt: timestampSchema,
  })
  .strict()

export const socratesGoalExchangeWorkDisclosureSchema = z
  .object({
    toolCalls: z.array(socratesGoalExchangeToolDisclosureSchema).max(SOCRATES_GOAL_EXCHANGE_WORK_ITEM_MAX),
    evidence: z.array(socratesGoalExchangeEvidenceDisclosureSchema).max(SOCRATES_GOAL_EXCHANGE_WORK_ITEM_MAX),
    totalToolCalls: z.number().int().nonnegative(),
    totalEvidenceItems: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  })
  .strict()

export const socratesGoalExchangeSchema = z
  .object({
    taskId: idSchema,
    runtimeTaskId: idSchema.optional(),
    goalId: idSchema,
    sourceRuntime: socratesGoalExchangeSourceRuntimeSchema,
    ordinal: z.number().int().positive(),
    rootTurnId: idSchema,
    currentTurnId: idSchema,
    turnIds: z.array(idSchema).min(1),
    status: socratesAgentTaskStatusSchema,
    userMessage: socratesMessageSchema,
    assistantMessage: socratesMessageSchema.optional(),
    failure: socratesGoalExchangeFailureSchema.optional(),
    work: socratesGoalExchangeWorkDisclosureSchema.optional(),
    startedAt: timestampSchema,
    updatedAt: timestampSchema,
    completedAt: timestampSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.turnIds).size !== value.turnIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["turnIds"],
        message: "The exchange lineage must not repeat a physical turn.",
      })
    }
    if (!value.turnIds.includes(value.rootTurnId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["turnIds"],
        message: "The exchange lineage must include its root turn.",
      })
    }
    if (!value.turnIds.includes(value.currentTurnId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["turnIds"],
        message: "The exchange lineage must include its current turn.",
      })
    }
    if (value.turnIds[0] !== value.rootTurnId || value.turnIds.at(-1) !== value.currentTurnId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["turnIds"],
        message: "The exchange lineage must run in order from its root turn through its current turn.",
      })
    }
    if (value.userMessage.role !== "user" || value.userMessage.goalId !== value.goalId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["userMessage"],
        message: "A goal exchange requires its exact goal-scoped user message.",
      })
    }
    if (value.userMessage.turnId !== value.rootTurnId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["userMessage", "turnId"],
        message: "The exact exchange request must belong to the root turn.",
      })
    }
    if (value.assistantMessage && (value.assistantMessage.role !== "assistant" || value.assistantMessage.goalId !== value.goalId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assistantMessage"],
        message: "A goal exchange answer must be the exact goal-scoped assistant message.",
      })
    }
    if (value.assistantMessage && (!value.assistantMessage.turnId || !value.turnIds.includes(value.assistantMessage.turnId))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assistantMessage", "turnId"],
        message: "The exact exchange answer must belong to its physical task lineage.",
      })
    }
    if (value.status === "completed" && value.assistantMessage?.turnId !== value.currentTurnId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assistantMessage", "turnId"],
        message: "A completed exchange answer must belong to the current completed turn.",
      })
    }
    if (value.failure && value.status !== "failed") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failure"],
        message: "Only a failed exchange may project its canonical failure.",
      })
    }
  })

export const socratesSnapshotSchema = z
  .object({
    state: socratesStateSchema,
    foregroundGoal: socratesGoalSchema.optional(),
    goals: z.array(socratesGoalSchema),
    goalWindow: socratesGoalWindowSchema.optional(),
    globalGoalWindow: socratesGlobalGoalWindowSchema.optional(),
    latestCapsules: z.array(socratesGoalCapsuleSchema),
    messages: z.array(socratesMessageSchema),
    messageWindow: socratesMessageWindowSchema,
    activeTurn: socratesTurnSchema.optional(),
    activeTask: socratesAgentTaskSchema.optional(),
    latestTask: socratesAgentTaskSchema.optional(),
    liveActivity: socratesLiveActivitySchema.optional(),
    canonicalToolCalls: z.array(socratesToolCallSchema),
    activeTerminals: z.array(socratesTerminalSchema),
    pendingApprovals: z.array(socratesApprovalSchema),
    pendingCredentialRequests: z.array(socratesCredentialInputRequestSchema),
    pendingClarification: socratesGoalRoutingRunSchema.optional(),
    lastEventSequence: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.activeTask && !["running", "waiting", "ready"].includes(value.activeTask.status)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activeTask", "status"],
        message: "The active task must have an active lifecycle status.",
      })
    }
    if (value.activeTask && value.state.activeTaskId !== value.activeTask.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["state", "activeTaskId"],
        message: "The durable active task pointer must match the projected active task.",
      })
    }
  })

export const socratesBootstrapRequestSchema = z.object({}).strict()
export const socratesBootstrapResponseSchema = z.object({ snapshot: socratesSnapshotSchema }).strict()
export const socratesStateResponseSchema = socratesBootstrapResponseSchema

export const socratesListMessagesRequestSchema = z
  .object({
    beforeOrdinal: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(SOCRATES_MESSAGE_PAGE_MAX).default(SOCRATES_SNAPSHOT_MESSAGE_LIMIT),
  })
  .strict()

export const socratesListMessagesResponseSchema = z
  .object({
    messages: z.array(socratesMessageSchema).max(SOCRATES_MESSAGE_PAGE_MAX),
    messageWindow: socratesMessageWindowSchema,
  })
  .strict()

export const socratesListGoalExchangesRequestSchema = z
  .object({
    beforeOrdinal: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(SOCRATES_GOAL_EXCHANGE_PAGE_MAX).default(SOCRATES_GOAL_EXCHANGE_PAGE_SIZE),
  })
  .strict()

export const socratesListGoalExchangesResponseSchema = z
  .object({
    exchanges: z.array(socratesGoalExchangeSchema).max(SOCRATES_GOAL_EXCHANGE_PAGE_MAX),
    exchangeWindow: socratesGoalExchangeWindowSchema,
  })
  .strict()

export const socratesListGlobalGoalsRequestSchema = z
  .object({
    beforeCursor: z.string().min(1).max(1_000).optional(),
    limit: z.coerce.number().int().min(1).max(SOCRATES_GOAL_PAGE_SIZE).default(SOCRATES_GOAL_PAGE_SIZE),
  })
  .strict()

export const socratesListGlobalGoalsResponseSchema = z
  .object({
    goals: z.array(socratesGoalSchema).max(SOCRATES_GOAL_PAGE_SIZE),
    goalWindow: socratesGlobalGoalWindowSchema,
  })
  .strict()

export const socratesSearchGlobalHistoryRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(1_000),
    limit: z.coerce.number().int().min(1).max(SOCRATES_GLOBAL_HISTORY_SEARCH_MAX).default(25),
  })
  .strict()

export const socratesSearchGlobalHistoryResponseSchema = z
  .object({
    goals: z.array(socratesGoalSchema).max(SOCRATES_GLOBAL_HISTORY_SEARCH_MAX),
    exchanges: z.array(socratesGoalExchangeSchema).max(SOCRATES_GLOBAL_HISTORY_SEARCH_MAX),
    hasMore: z.boolean(),
  })
  .strict()

export const socratesListTimelineRequestSchema = z
  .object({
    afterSequence: z.coerce.number().int().nonnegative().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict()

export const socratesTimelineItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), sequence: z.number().int().positive(), message: socratesMessageSchema }).strict(),
  z.object({ kind: z.literal("goal_transition"), sequence: z.number().int().positive(), transition: socratesGoalTransitionSchema }).strict(),
  z.object({ kind: z.literal("runtime_event"), sequence: z.number().int().positive(), event: socratesRuntimeEventSchema }).strict(),
])

export const socratesListTimelineResponseSchema = z
  .object({
    items: z.array(socratesTimelineItemSchema),
    nextSequence: z.number().int().nonnegative().optional(),
  })
  .strict()

export const socratesListGoalsRequestSchema = z
  .object({
    beforeOrdinal: z.number().int().positive().optional(),
    limit: z.number().int().min(1).max(SOCRATES_GOAL_PAGE_SIZE).default(SOCRATES_GOAL_PAGE_SIZE),
  })
  .strict()

export const socratesListGoalsResponseSchema = z
  .object({
    goals: z.array(socratesGoalSchema).max(SOCRATES_GOAL_PAGE_SIZE),
    goalWindow: socratesGoalWindowSchema,
  })
  .strict()
export const socratesGetGoalResponseSchema = z
  .object({
    goal: socratesGoalSchema,
    latestCapsule: socratesGoalCapsuleSchema.optional(),
    transitions: z.array(socratesGoalTransitionSchema),
    messages: z.array(socratesMessageSchema),
  })
  .strict()

const socratesCreateSpeechJobBaseShape = {
  goalId: idSchema.optional(),
  turnId: idSchema.optional(),
  messageId: idSchema.optional(),
  language: z.string().min(1).max(64).optional(),
}

export const socratesCreateSpeechJobRequestSchema = z.discriminatedUnion("engine", [
  z
    .object({
      ...socratesCreateSpeechJobBaseShape,
      kind: z.literal("transcription"),
      engine: z.literal("local_whisper"),
      modelId: socratesLocalWhisperModelSchema,
      inputArtifactId: idSchema,
    })
    .strict(),
  z
    .object({
      ...socratesCreateSpeechJobBaseShape,
      kind: z.literal("transcription"),
      engine: z.literal("openrouter"),
      modelId: socratesOpenRouterSttModelSchema,
      inputArtifactId: idSchema,
    })
    .strict(),
  z
    .object({
      ...socratesCreateSpeechJobBaseShape,
      kind: z.literal("synthesis"),
      engine: z.literal("local_kokoro"),
      modelId: socratesLocalKokoroModelSchema,
      inputText: z.string().min(1).max(100_000),
      voiceId: z.string().min(1).max(128),
      speed: z.number().min(0.5).max(2).default(1),
    })
    .strict(),
])

export const socratesCreateSpeechJobResponseSchema = z.object({ job: socratesSpeechJobSchema }).strict()

export const socratesActorTypeSchema = z.enum(["user", "main_agent", "worker", "tool", "system"])
export const socratesActorSchema = z
  .object({
    type: socratesActorTypeSchema,
    id: idSchema.optional(),
    label: z.string().min(1).max(200).optional(),
  })
  .strict()

const socratesSocketEnvelopeBaseShape = {
  id: idSchema,
  schemaVersion: socratesSchemaVersionSchema,
  timestamp: timestampSchema,
  goalId: idSchema.optional(),
  turnId: idSchema.optional(),
  actor: socratesActorSchema.optional(),
}

export const socratesSocketEnvelopeSchema = <TType extends string, TPayload extends z.ZodTypeAny>(
  type: TType,
  payloadSchema: TPayload,
) =>
  z
    .object({
      ...socratesSocketEnvelopeBaseShape,
      type: z.literal(type),
      payload: payloadSchema,
    })
    .strict()

export const socratesSubscribePayloadSchema = z
  .object({ afterSequence: z.number().int().nonnegative().optional(), replayActiveTurn: z.boolean().optional() })
  .strict()
export const socratesUnsubscribePayloadSchema = z.object({}).strict()

export const socratesMessageSendPayloadSchema = z
  .object({
    clientMessageId: idSchema,
    content: z.string().max(MAX_INLINE_MESSAGE_CHARS),
    attachmentIds: z.array(idSchema).max(MAX_MESSAGE_ATTACHMENTS).optional(),
    foregroundGoalIdAtCompose: idSchema.optional(),
    runtimeConfig: socratesRuntimeConfigSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.content.trim() && (value.attachmentIds ?? []).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: "Content is required unless at least one attachment is present.",
      })
    }
  })

export const socratesRoutingClarificationRespondPayloadSchema = z
  .object({
    routingRunId: idSchema,
    answerMessageId: idSchema,
    answer: z.string().trim().min(1).max(MAX_INLINE_MESSAGE_CHARS),
  })
  .strict()

export const socratesGoalActionSchema = z.enum(["switch", "pause", "finish", "reopen", "archive", "pin", "unpin"])
export const socratesGoalUpdatePayloadSchema = z
  .object({
    goalId: idSchema,
    action: socratesGoalActionSchema,
    note: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict()

export const socratesDeleteGoalResponseSchema = z
  .object({
    deletedGoalId: idSchema,
    fallbackGoalId: idSchema.optional(),
  })
  .strict()

export const socratesDeleteTurnResponseSchema = z
  .object({
    deletedTurnId: idSchema,
  })
  .strict()

export const socratesDeleteGoalExchangeResponseSchema = z
  .object({
    deletedTaskId: idSchema,
    deletedGoalId: idSchema,
  })
  .strict()

export const socratesTurnCancelPayloadSchema = z
  .object({ turnId: idSchema, reason: z.string().max(1_000).optional() })
  .strict()
export const socratesApprovalDecidePayloadSchema = z
  .object({ approvalId: idSchema, decision: z.enum(["approved", "rejected"]), reason: z.string().max(2_000).optional() })
  .strict()
export const socratesFeedbackSubmitPayloadSchema = z
  .object({
    messageId: idSchema,
    turnId: idSchema.optional(),
    modelCallId: idSchema.optional(),
    rating: socratesFeedbackRatingSchema,
    reasonCode: z.string().min(1).max(200).optional(),
    note: z.string().max(4_000).optional(),
  })
  .strict()
export const socratesCredentialInputSubmitPayloadSchema = z
  .object({
    credentialRequestId: idSchema,
    turnId: idSchema,
    decision: z.enum(["submitted", "cancelled"]),
    value: z.string().min(1).max(20_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === "submitted" && value.value === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "A credential value is required when submitting.",
      })
    }
    if (value.decision === "cancelled" && value.value !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Cancelled credential input must not include a value.",
      })
    }
  })
export const socratesTerminalStopPayloadSchema = z
  .object({ terminalId: idSchema, reason: z.string().max(1_000).optional() })
  .strict()
export const socratesTerminalInputPayloadSchema = z
  .object({
    terminalId: idSchema,
    data: z.string().optional(),
    text: z.string().optional(),
    key: z.enum(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Escape", "Ctrl-C"]).optional(),
    submit: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.data === undefined && value.text === undefined && value.key === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data"],
        message: "Terminal input requires data, text, or key.",
      })
    }
  })
export const socratesTerminalResizePayloadSchema = z
  .object({ terminalId: idSchema, cols: z.number().int().min(2).max(500), rows: z.number().int().min(2).max(500) })
  .strict()
export const socratesTerminalRenamePayloadSchema = z
  .object({ terminalId: idSchema, name: z.string().min(1).max(96) })
  .strict()

export const socratesSubscribeCommandSchema = socratesSocketEnvelopeSchema("socrates.subscribe", socratesSubscribePayloadSchema)
export const socratesUnsubscribeCommandSchema = socratesSocketEnvelopeSchema("socrates.unsubscribe", socratesUnsubscribePayloadSchema)
export const socratesMessageSendCommandSchema = socratesSocketEnvelopeSchema("socrates.message.send", socratesMessageSendPayloadSchema)
export const socratesRoutingClarificationRespondCommandSchema = socratesSocketEnvelopeSchema(
  "socrates.routing.clarification.respond",
  socratesRoutingClarificationRespondPayloadSchema,
)
export const socratesGoalUpdateCommandSchema = socratesSocketEnvelopeSchema("socrates.goal.update", socratesGoalUpdatePayloadSchema)
export const socratesTurnCancelCommandSchema = socratesSocketEnvelopeSchema("socrates.turn.cancel", socratesTurnCancelPayloadSchema)
export const socratesApprovalDecideCommandSchema = socratesSocketEnvelopeSchema("socrates.approval.decide", socratesApprovalDecidePayloadSchema)
export const socratesFeedbackSubmitCommandSchema = socratesSocketEnvelopeSchema("socrates.feedback.submit", socratesFeedbackSubmitPayloadSchema)
export const socratesCredentialInputSubmitCommandSchema = socratesSocketEnvelopeSchema(
  "socrates.credential.input.submit",
  socratesCredentialInputSubmitPayloadSchema,
)
export const socratesTerminalStopCommandSchema = socratesSocketEnvelopeSchema("socrates.terminal.stop", socratesTerminalStopPayloadSchema)
export const socratesTerminalInputCommandSchema = socratesSocketEnvelopeSchema("socrates.terminal.input", socratesTerminalInputPayloadSchema)
export const socratesTerminalResizeCommandSchema = socratesSocketEnvelopeSchema("socrates.terminal.resize", socratesTerminalResizePayloadSchema)
export const socratesTerminalRenameCommandSchema = socratesSocketEnvelopeSchema("socrates.terminal.rename", socratesTerminalRenamePayloadSchema)

export const socratesClientCommandSchema = z.discriminatedUnion("type", [
  socratesSubscribeCommandSchema,
  socratesUnsubscribeCommandSchema,
  socratesMessageSendCommandSchema,
  socratesRoutingClarificationRespondCommandSchema,
  socratesGoalUpdateCommandSchema,
  socratesTurnCancelCommandSchema,
  socratesApprovalDecideCommandSchema,
  socratesFeedbackSubmitCommandSchema,
  socratesCredentialInputSubmitCommandSchema,
  socratesTerminalStopCommandSchema,
  socratesTerminalInputCommandSchema,
  socratesTerminalResizeCommandSchema,
  socratesTerminalRenameCommandSchema,
])

export const socratesConnectionReadyPayloadSchema = z
  .object({ connectionId: idSchema, serverTime: timestampSchema })
  .strict()
export const socratesSnapshotPayloadSchema = z.object({ snapshot: socratesSnapshotSchema }).strict()
export const socratesTurnStartedPayloadSchema = z
  .object({ turn: socratesTurnSchema, userMessage: socratesMessageSchema })
  .strict()
export const socratesTurnUpdatedPayloadSchema = z.object({ turn: socratesTurnSchema }).strict()
export const socratesMessageDeltaPayloadSchema = z
  .object({ messageId: idSchema, channel: z.enum(["answer", "reasoning"]), text: z.string(), modelCallId: idSchema.optional() })
  .strict()
export const socratesMessageCompletedPayloadSchema = z.object({ message: socratesMessageSchema }).strict()
export const socratesGoalRoutedPayloadSchema = z
  .object({ routingRun: socratesGoalRoutingRunSchema, goal: socratesGoalSchema.optional(), transition: socratesGoalTransitionSchema.optional() })
  .strict()
export const socratesRoutingClarificationRequestedPayloadSchema = z
  .object({ routingRun: socratesGoalRoutingRunSchema, message: socratesMessageSchema })
  .strict()
export const socratesRoutingClarificationResolvedPayloadSchema = z
  .object({ routingRun: socratesGoalRoutingRunSchema, answerMessage: socratesMessageSchema })
  .strict()
export const socratesGoalTransitionedPayloadSchema = z
  .object({ goal: socratesGoalSchema, transition: socratesGoalTransitionSchema })
  .strict()
export const socratesGoalCapsuleUpdatedPayloadSchema = z.object({ capsule: socratesGoalCapsuleSchema }).strict()
export const socratesToolCallUpdatedPayloadSchema = z.object({ toolCall: socratesToolCallSchema }).strict()
export const socratesApprovalUpdatedPayloadSchema = z.object({ approval: socratesApprovalSchema }).strict()
export const socratesFeedbackUpdatedPayloadSchema = z.object({ feedback: socratesFeedbackSchema }).strict()
export const socratesCredentialInputRequestedPayloadSchema = z
  .object({ request: socratesCredentialInputRequestSchema })
  .strict()
export const socratesCredentialInputResolvedPayloadSchema = z
  .object({ request: socratesCredentialInputRequestSchema })
  .strict()
export const socratesTerminalUpdatedPayloadSchema = z.object({ terminal: socratesTerminalSchema }).strict()
export const socratesTerminalOutputPayloadSchema = z
  .object({
    terminalId: idSchema,
    sequence: z.number().int().nonnegative(),
    stream: z.enum(["stdout", "stderr", "log", "result", "input", "pty"]),
    text: z.string(),
    redacted: z.boolean(),
  })
  .strict()
export const socratesArtifactCreatedPayloadSchema = z.object({ artifact: socratesArtifactSchema }).strict()
export const socratesSpeechJobUpdatedPayloadSchema = z.object({ job: socratesSpeechJobSchema }).strict()
export const socratesErrorCreatedPayloadSchema = z.object({ error: socratesErrorSchema }).strict()
export const socratesAgentHandoverPayloadSchema = z
  .object({
    toolCallId: idSchema,
    stepIndex: z.number().int().nonnegative(),
    fromProviderId: providerIdSchema,
    fromModelId: z.string().min(1),
    toProviderId: providerIdSchema,
    toModelId: z.string().min(1),
    focus: z.string().min(1).max(160).optional(),
  })
  .strict()
export const socratesContextCompactionStartedPayloadSchema = z
  .object({
    snapshotId: idSchema,
    reason: z.enum(["precompute", "threshold", "emergency", "manual"]),
    contextUsedTokensEstimate: z.number().int().nonnegative(),
    targetTokens: z.number().int().positive(),
  })
  .strict()
export const socratesContextCompactionCompletedPayloadSchema = z
  .object({
    snapshotId: idSchema,
    inputTokensEstimate: z.number().int().nonnegative(),
    outputTokensEstimate: z.number().int().nonnegative(),
    contextUsedTokensEstimate: z.number().int().nonnegative(),
    sizeClass: z.enum(["excellent", "preferred", "acceptable"]),
  })
  .strict()
export const socratesContextCompactionFailedPayloadSchema = z
  .object({ snapshotId: idSchema.optional(), error: apiErrorSchema })
  .strict()

export const socratesConnectionReadyEventSchema = socratesSocketEnvelopeSchema("socrates.connection.ready", socratesConnectionReadyPayloadSchema)
export const socratesSnapshotEventSchema = socratesSocketEnvelopeSchema("socrates.state.snapshot", socratesSnapshotPayloadSchema)
export const socratesTurnStartedEventSchema = socratesSocketEnvelopeSchema("socrates.turn.started", socratesTurnStartedPayloadSchema)
export const socratesTurnUpdatedEventSchema = socratesSocketEnvelopeSchema("socrates.turn.updated", socratesTurnUpdatedPayloadSchema)
export const socratesLiveActivityUpdatedEventSchema = socratesSocketEnvelopeSchema("socrates.activity.updated", socratesLiveActivityUpdatedPayloadSchema)
export const socratesMessageDeltaEventSchema = socratesSocketEnvelopeSchema("socrates.message.delta", socratesMessageDeltaPayloadSchema)
export const socratesMessageCompletedEventSchema = socratesSocketEnvelopeSchema("socrates.message.completed", socratesMessageCompletedPayloadSchema)
export const socratesGoalRoutedEventSchema = socratesSocketEnvelopeSchema("socrates.goal.routed", socratesGoalRoutedPayloadSchema)
export const socratesRoutingClarificationRequestedEventSchema = socratesSocketEnvelopeSchema(
  "socrates.routing.clarification.requested",
  socratesRoutingClarificationRequestedPayloadSchema,
)
export const socratesRoutingClarificationResolvedEventSchema = socratesSocketEnvelopeSchema(
  "socrates.routing.clarification.resolved",
  socratesRoutingClarificationResolvedPayloadSchema,
)
export const socratesGoalTransitionedEventSchema = socratesSocketEnvelopeSchema("socrates.goal.transitioned", socratesGoalTransitionedPayloadSchema)
export const socratesGoalCapsuleUpdatedEventSchema = socratesSocketEnvelopeSchema("socrates.goal.capsule.updated", socratesGoalCapsuleUpdatedPayloadSchema)
export const socratesToolCallUpdatedEventSchema = socratesSocketEnvelopeSchema("socrates.tool.call.updated", socratesToolCallUpdatedPayloadSchema)
export const socratesApprovalUpdatedEventSchema = socratesSocketEnvelopeSchema("socrates.approval.updated", socratesApprovalUpdatedPayloadSchema)
export const socratesFeedbackUpdatedEventSchema = socratesSocketEnvelopeSchema("socrates.feedback.updated", socratesFeedbackUpdatedPayloadSchema)
export const socratesCredentialInputRequestedEventSchema = socratesSocketEnvelopeSchema(
  "socrates.credential.input.requested",
  socratesCredentialInputRequestedPayloadSchema,
)
export const socratesCredentialInputResolvedEventSchema = socratesSocketEnvelopeSchema(
  "socrates.credential.input.resolved",
  socratesCredentialInputResolvedPayloadSchema,
)
export const socratesTerminalUpdatedEventSchema = socratesSocketEnvelopeSchema("socrates.terminal.updated", socratesTerminalUpdatedPayloadSchema)
export const socratesTerminalOutputEventSchema = socratesSocketEnvelopeSchema("socrates.terminal.output", socratesTerminalOutputPayloadSchema)
export const socratesArtifactCreatedEventSchema = socratesSocketEnvelopeSchema("socrates.artifact.created", socratesArtifactCreatedPayloadSchema)
export const socratesSpeechJobUpdatedEventSchema = socratesSocketEnvelopeSchema("socrates.speech.job.updated", socratesSpeechJobUpdatedPayloadSchema)
export const socratesErrorCreatedEventSchema = socratesSocketEnvelopeSchema("socrates.error.created", socratesErrorCreatedPayloadSchema)
export const socratesAgentHandoverEventSchema = socratesSocketEnvelopeSchema("socrates.agent.handover", socratesAgentHandoverPayloadSchema)
export const socratesContextCompactionStartedEventSchema = socratesSocketEnvelopeSchema(
  "socrates.context.compaction.started",
  socratesContextCompactionStartedPayloadSchema,
)
export const socratesContextCompactionCompletedEventSchema = socratesSocketEnvelopeSchema(
  "socrates.context.compaction.completed",
  socratesContextCompactionCompletedPayloadSchema,
)
export const socratesContextCompactionFailedEventSchema = socratesSocketEnvelopeSchema(
  "socrates.context.compaction.failed",
  socratesContextCompactionFailedPayloadSchema,
)

export const socratesServerEventSchema = z.discriminatedUnion("type", [
  socratesConnectionReadyEventSchema,
  socratesSnapshotEventSchema,
  socratesTurnStartedEventSchema,
  socratesTurnUpdatedEventSchema,
  socratesLiveActivityUpdatedEventSchema,
  socratesMessageDeltaEventSchema,
  socratesMessageCompletedEventSchema,
  socratesGoalRoutedEventSchema,
  socratesRoutingClarificationRequestedEventSchema,
  socratesRoutingClarificationResolvedEventSchema,
  socratesGoalTransitionedEventSchema,
  socratesGoalCapsuleUpdatedEventSchema,
  socratesToolCallUpdatedEventSchema,
  socratesApprovalUpdatedEventSchema,
  socratesFeedbackUpdatedEventSchema,
  socratesCredentialInputRequestedEventSchema,
  socratesCredentialInputResolvedEventSchema,
  socratesTerminalUpdatedEventSchema,
  socratesTerminalOutputEventSchema,
  socratesArtifactCreatedEventSchema,
  socratesSpeechJobUpdatedEventSchema,
  socratesErrorCreatedEventSchema,
  socratesAgentHandoverEventSchema,
  socratesContextCompactionStartedEventSchema,
  socratesContextCompactionCompletedEventSchema,
  socratesContextCompactionFailedEventSchema,
])

export const socratesSocketMessageSchema = z.union([socratesClientCommandSchema, socratesServerEventSchema])

export const socratesResourceAvailabilitySchema = z.enum(["available", "missing", "ambiguous", "unavailable"])
export const socratesResourceLocationSchema = z.object({
  id: idSchema,
  resourceId: idSchema,
  canonicalPath: z.string().min(1),
  availability: socratesResourceAvailabilitySchema,
  filesystemFingerprint: z.string().min(1).optional(),
  gitFingerprint: z.string().min(1).optional(),
  firstSeenAt: timestampSchema,
  lastVerifiedAt: timestampSchema,
  supersededAt: timestampSchema.optional(),
}).strict()
export const socratesResourceSchema = z.object({
  id: idSchema,
  label: z.string().min(1).max(200),
  kind: z.enum(["filesystem_root"]),
  availability: socratesResourceAvailabilitySchema,
  currentLocation: socratesResourceLocationSchema.optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict()
export const socratesResourceBindingSchema = z.object({
  id: idSchema,
  ownerType: z.enum(["goal", "task"]),
  ownerId: idSchema,
  resourceId: idSchema,
  locationId: idSchema,
  status: z.enum(["active", "released"]),
  confirmedBy: z.enum(["explicit_path", "user_confirmation", "relink_confirmation"]),
  createdAt: timestampSchema,
  releasedAt: timestampSchema.optional(),
}).strict()

export const socratesKnowledgeScopeSchema = z.enum(["global", "resource"])
export const socratesKnowledgeKindSchema = z.enum(["identity", "profile", "rule", "memory", "repo_fact"])
export const socratesKnowledgeStatusSchema = z.enum(["pending", "accepted", "superseded", "deleted"])
export const socratesKnowledgeVersionSchema = z.object({
  id: idSchema,
  entryId: idSchema,
  version: z.number().int().positive(),
  status: socratesKnowledgeStatusSchema,
  content: z.string().min(1).max(100_000),
  provenance: z.record(z.unknown()),
  evidenceRefs: z.array(z.string().min(1)).max(100),
  acceptedBy: z.enum(["explicit_user", "validated_fact", "memory_agent", "direct_edit"]).optional(),
  createdAt: timestampSchema,
}).strict()
export const socratesKnowledgeEntrySchema = z.object({
  id: idSchema,
  scope: socratesKnowledgeScopeSchema,
  resourceId: idSchema.optional(),
  kind: socratesKnowledgeKindSchema,
  label: z.string().min(1).max(200),
  currentVersion: socratesKnowledgeVersionSchema.optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict().superRefine((value, context) => {
  if ((value.scope === "resource") !== Boolean(value.resourceId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["resourceId"], message: "Resource knowledge requires exactly one resource." })
  }
})

export const socratesInteractionKindSchema = z.enum([
  "approval",
  "credential",
  "clarification",
  "frontier_approval",
  "proposal_acceptance",
])
export const socratesInteractionRequestSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  kind: socratesInteractionKindSchema,
  status: z.enum(["pending", "approved", "rejected", "submitted", "cancelled", "expired"]),
  fingerprint: z.string().min(1).optional(),
  prompt: z.string().min(1).max(10_000),
  publicPayload: z.record(z.unknown()),
  requestedAt: timestampSchema,
  resolvedAt: timestampSchema.optional(),
}).strict()

export const socratesBackupSchema = z.object({
  id: idSchema,
  createdAt: timestampSchema,
  archivePath: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  sourceSchemaVersion: z.string().min(1),
  integrity: z.enum(["verified", "failed"]),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
export const socratesBackupInventorySchema = z.object({ backups: z.array(socratesBackupSchema) }).strict()

export type SocratesState = z.infer<typeof socratesStateSchema>
export type SocratesGoal = z.infer<typeof socratesGoalSchema>
export type SocratesGoalTransition = z.infer<typeof socratesGoalTransitionSchema>
export type SocratesGoalRoutingRun = z.infer<typeof socratesGoalRoutingRunSchema>
export type SocratesGoalCapsule = z.infer<typeof socratesGoalCapsuleSchema>
export type SocratesGoalMessageLink = z.infer<typeof socratesGoalMessageLinkSchema>
export type SocratesTurn = z.infer<typeof socratesTurnSchema>
export type SocratesRuntimeConfig = z.infer<typeof socratesRuntimeConfigSchema>
export type SocratesMessage = z.infer<typeof socratesMessageSchema>
export type SocratesMessageAttachment = z.infer<typeof socratesMessageAttachmentSchema>
export type SocratesEvidenceItem = z.infer<typeof socratesEvidenceItemSchema>
export type SocratesRuntimeEvent = z.infer<typeof socratesRuntimeEventSchema>
export type SocratesModelCall = z.infer<typeof socratesModelCallSchema>
export type SocratesUsageEvent = z.infer<typeof socratesUsageEventSchema>
export type SocratesToolCall = z.infer<typeof socratesToolCallSchema>
export type SocratesApproval = z.infer<typeof socratesApprovalSchema>
export type SocratesTerminal = z.infer<typeof socratesTerminalSchema>
export type SocratesErrorRecord = z.infer<typeof socratesErrorSchema>
export type SocratesArtifact = z.infer<typeof socratesArtifactSchema>
export type SocratesAgentTask = z.infer<typeof socratesAgentTaskSchema>
export type SocratesFeedback = z.infer<typeof socratesFeedbackSchema>
export type SocratesCredentialInputRequest = z.infer<typeof socratesCredentialInputRequestSchema>
export type SocratesSpeechJob = z.infer<typeof socratesSpeechJobSchema>
export type SocratesMessageWindow = z.infer<typeof socratesMessageWindowSchema>
export type SocratesGoalWindow = z.infer<typeof socratesGoalWindowSchema>
export type SocratesGlobalGoalWindow = z.infer<typeof socratesGlobalGoalWindowSchema>
export type SocratesGoalExchangeWindow = z.infer<typeof socratesGoalExchangeWindowSchema>
export type SocratesGoalExchangeFailure = z.infer<typeof socratesGoalExchangeFailureSchema>
export type SocratesGoalExchangeToolDisclosure = z.infer<typeof socratesGoalExchangeToolDisclosureSchema>
export type SocratesGoalExchangeEvidenceDisclosure = z.infer<typeof socratesGoalExchangeEvidenceDisclosureSchema>
export type SocratesGoalExchangeWorkDisclosure = z.infer<typeof socratesGoalExchangeWorkDisclosureSchema>
export type SocratesGoalExchange = z.infer<typeof socratesGoalExchangeSchema>
export type SocratesListGoalExchangesRequest = z.infer<typeof socratesListGoalExchangesRequestSchema>
export type SocratesListGoalExchangesResponse = z.infer<typeof socratesListGoalExchangesResponseSchema>
export type SocratesListGlobalGoalsRequest = z.infer<typeof socratesListGlobalGoalsRequestSchema>
export type SocratesListGlobalGoalsResponse = z.infer<typeof socratesListGlobalGoalsResponseSchema>
export type SocratesSearchGlobalHistoryRequest = z.infer<typeof socratesSearchGlobalHistoryRequestSchema>
export type SocratesSearchGlobalHistoryResponse = z.infer<typeof socratesSearchGlobalHistoryResponseSchema>
export type SocratesSnapshot = z.infer<typeof socratesSnapshotSchema>
export type SocratesCreateSpeechJobRequest = z.infer<typeof socratesCreateSpeechJobRequestSchema>
export type SocratesDeleteGoalResponse = z.infer<typeof socratesDeleteGoalResponseSchema>
export type SocratesDeleteTurnResponse = z.infer<typeof socratesDeleteTurnResponseSchema>
export type SocratesDeleteGoalExchangeResponse = z.infer<typeof socratesDeleteGoalExchangeResponseSchema>
export type SocratesClientCommand = z.infer<typeof socratesClientCommandSchema>
export type SocratesServerEvent = z.infer<typeof socratesServerEventSchema>
export type SocratesSocketMessage = z.infer<typeof socratesSocketMessageSchema>
export type SocratesResource = z.infer<typeof socratesResourceSchema>
export type SocratesResourceLocation = z.infer<typeof socratesResourceLocationSchema>
export type SocratesResourceBinding = z.infer<typeof socratesResourceBindingSchema>
export type SocratesKnowledgeEntry = z.infer<typeof socratesKnowledgeEntrySchema>
export type SocratesKnowledgeVersion = z.infer<typeof socratesKnowledgeVersionSchema>
export type SocratesInteractionRequest = z.infer<typeof socratesInteractionRequestSchema>
export type SocratesBackup = z.infer<typeof socratesBackupSchema>
