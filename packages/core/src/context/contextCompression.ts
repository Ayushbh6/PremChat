import {
  MAX_COMPACTION_SUMMARY_CHARS,
  chatCompactionSchema,
  compactionSourceRefSchema,
  memoryCompactionSchema,
  type ChatCompaction,
  type CompactionSourceRef,
  type MemoryCompaction,
} from "@socrates/contracts"
import { estimateTextTokens, type ModelMessage, type ModelMessagePart, type ModelProvider, type ModelUsage, type TokenCountResult } from "@socrates/providers"
import type { ModelToolDefinition, ProviderAuthMode, ProviderId, RuntimeConfig, ThinkingEffort } from "@socrates/contracts"
import { createId, SocratesError } from "@socrates/shared"
import { CompressorAgent } from "../agent/CompressorAgent"
import {
  SOCRATES_COMPRESSOR_SYSTEM_PROMPT,
  buildSocratesCompressorUserContent,
  renderChatCompactionMarkdown,
  type CompressorTurnInput,
} from "../prompts/socratesCompressorPrompt"
import {
  MEMORY_AGENT_COMPRESSOR_SYSTEM_PROMPT,
  buildMemoryAgentCompressorUserContent,
  renderMemoryCompactionMarkdown,
} from "../prompts/memoryAgentCompressorPrompt"

export type ContextCompressionMode = "chat" | "memory"

export const CONTEXT_MODEL_DISPATCH_CEILING_TOKENS = 170_000

export const DEFAULT_CONTEXT_COMPRESSION_THRESHOLDS = {
  triggerTokens: CONTEXT_MODEL_DISPATCH_CEILING_TOKENS,
  excellentTargetTokens: 80_000,
  preferredTargetTokens: 100_000,
  postCompactionTargetTokens: 120_000,
  minimumReductionTokens: 20_000,
  recentTailTargetTokens: 70_000,
} as const

export type ContextCompressionThresholds = {
  triggerTokens: number
  excellentTargetTokens: number
  preferredTargetTokens: number
  postCompactionTargetTokens: number
  minimumReductionTokens: number
  recentTailTargetTokens: number
}

export const DEFAULT_COMPRESSOR_MODEL = {
  providerId: "openrouter" as ProviderId,
  modelId: "deepseek/deepseek-v4-flash",
} as const

export const DEFAULT_COMPRESSOR_FALLBACK_MODEL = {
  providerId: "openrouter" as ProviderId,
  modelId: "xiaomi/mimo-v2.5-pro",
} as const

export const DEFAULT_COMPRESSOR_SECOND_FALLBACK_MODEL = {
  providerId: "openrouter" as ProviderId,
  modelId: "z-ai/glm-5.2",
} as const

export type ContextCompressionReason = "precompute" | "threshold" | "emergency" | "manual"

export type ContextCompactionSummary = {
  snapshotId: string
  previousSnapshotId?: string
  summary: ChatCompaction | MemoryCompaction
  renderedSummary: string
  sourceHandles: Array<Record<string, unknown>>
  outputTokensEstimate: number
}

export type ContextCompactionStartedEvent = {
  type: "context.compaction.started"
  snapshotId: string
  reason: ContextCompressionReason
  contextUsedTokensEstimate: number
  targetTokens: number
}

export type ContextCompactionCompletedEvent = {
  type: "context.compaction.completed"
  snapshotId: string
  inputTokensEstimate: number
  outputTokensEstimate: number
  contextUsedTokensEstimate: number
  sizeClass: "excellent" | "preferred" | "acceptable"
}

export type ContextCompactionFailedEvent = {
  type: "context.compaction.failed"
  snapshotId?: string
  error: SocratesError
}

export type ContextCompactionLifecycleEvent =
  | ContextCompactionStartedEvent
  | ContextCompactionCompletedEvent
  | ContextCompactionFailedEvent

export type StartCompactionSnapshotInput = {
  snapshotId: string
  reason: ContextCompressionReason
  contextTokensEstimate: number
  targetTokens: number
  compressorProviderId: ProviderId
  compressorModelId: string
  sourceMessageIds: string[]
  sourceTurnIds: string[]
  previousSnapshotId?: string
}

export type CompleteCompactionSnapshotInput = {
  snapshotId: string
  summary: ChatCompaction | MemoryCompaction
  renderedSummary: string
  sourceHandles: Array<Record<string, unknown>>
  inputTokensEstimate: number
  outputTokensEstimate: number
  contextTokensAfter: number
  usage?: ModelUsage
  compressorProviderId?: ProviderId
  compressorModelId?: string
}

export type FailCompactionSnapshotInput = {
  snapshotId: string
  code: string
  message: string
  details?: unknown
}

export type ContextCompressionRuntime = {
  enabled: boolean
  mode?: ContextCompressionMode
  projectId?: string
  conversationId?: string
  sessionId?: string
  turnId?: string
  workspacePath?: string
  thresholds?: Partial<ContextCompressionThresholds>
  compressorProviderId?: ProviderId
  compressorAuthMode?: ProviderAuthMode
  compressorModelId?: string
  compressorThinkingEnabled?: boolean
  compressorThinkingEffort?: ThinkingEffort
  compressorFallbackProviderId?: ProviderId
  compressorFallbackAuthMode?: ProviderAuthMode
  compressorFallbackModelId?: string
  compressorFallbacks?: Array<{
    providerId: ProviderId
    authMode?: ProviderAuthMode
    modelId: string
    thinkingEnabled?: boolean
    thinkingEffort?: ThinkingEffort
  }>
  getLatestSnapshot?: () => Promise<ContextCompactionSummary | undefined> | ContextCompactionSummary | undefined
  startSnapshot?: (input: StartCompactionSnapshotInput) => Promise<void> | void
  completeSnapshot?: (input: CompleteCompactionSnapshotInput) => Promise<void> | void
  failSnapshot?: (input: FailCompactionSnapshotInput) => Promise<void> | void
}

export type PrepareContextInput = {
  provider: ModelProvider
  providerId: ProviderId
  modelId: string
  runtimeConfig: RuntimeConfig
  system: string
  messages: ModelMessage[]
  tools?: ModelToolDefinition[]
  structuredOutputSchema?: unknown
  compression?: ContextCompressionRuntime
  onCompactionStarted?: (event: ContextCompactionStartedEvent) => Promise<void> | void
}

export type PreparedContext = {
  system: string
  messages: ModelMessage[]
  estimatedTokens: number
  tokenCount: TokenCountResult
  compactionEvents: ContextCompactionLifecycleEvent[]
}

const withLatestSnapshotApplied = async (input: PrepareContextInput): Promise<PrepareContextInput> => {
  if (!input.compression?.enabled || !input.compression.getLatestSnapshot) return input
  const mode = input.compression.mode ?? "chat"
  const latest = validLatestSnapshot(await input.compression.getLatestSnapshot(), mode)
  if (!latest) return input
  const compactedMessageIds = new Set(latest.sourceHandles.flatMap(sourceRefMessageIds))
  const compactedLegacyTurnIds = new Set(latest.sourceHandles.filter(isLegacyWholeTurnSource).map((handle) => handle.turnId).filter(isString))
  const rawMessages = input.messages.filter((message) => !isInternalCompactionMessage(message))
  const retainedMessages = rawMessages.filter((message) =>
    (!message.id || !compactedMessageIds.has(message.id)) &&
    (!message.turnId || !compactedLegacyTurnIds.has(message.turnId)),
  )
  return {
    ...input,
    messages: [compactionContextMessage(latest.renderedSummary, mode), ...retainedMessages],
    compression: { ...input.compression, getLatestSnapshot: () => latest },
  }
}

export const prepareContextForModelCall = async (input: PrepareContextInput): Promise<PreparedContext> => {
  const thresholds = { ...DEFAULT_CONTEXT_COMPRESSION_THRESHOLDS, ...input.compression?.thresholds }
  const triggerTokens = effectiveCompactionTrigger(thresholds)
  const effectiveInput = await withLatestSnapshotApplied(input)
  const initialTokenCount = await countPreparedContext(effectiveInput, thresholds)
  const initialTokens = initialTokenCount.inputTokens

  if (!input.compression?.enabled) {
    if (initialTokens >= triggerTokens) {
      throw contextHardLimitError(initialTokens, thresholds)
    }
    return {
      system: effectiveInput.system,
      messages: effectiveInput.messages,
      estimatedTokens: initialTokens,
      tokenCount: initialTokenCount,
      compactionEvents: [],
    }
  }

  if (initialTokens < triggerTokens) {
    return {
      system: effectiveInput.system,
      messages: effectiveInput.messages,
      estimatedTokens: initialTokens,
      tokenCount: initialTokenCount,
      compactionEvents: [],
    }
  }

  let startedEmitted = false
  const result = await runContextCompaction(effectiveInput, thresholds, initialTokens, "threshold", async (event) => {
    if (!input.onCompactionStarted) {
      return
    }
    startedEmitted = true
    await input.onCompactionStarted(event)
  })
  if (!result.ok) {
    throw contextHardLimitError(initialTokens, thresholds, result.failed.error)
  }

  const finalTokenCount = await countPreparedContext({ ...effectiveInput, messages: result.messages }, thresholds)
  const finalTokens = finalTokenCount.inputTokens
  const reduction = initialTokens - finalTokens
  const minimumReduction = Math.min(thresholds.minimumReductionTokens, Math.max(1, Math.floor(initialTokens * 0.1)))
  const targetTokens = Math.min(thresholds.postCompactionTargetTokens, triggerTokens)
  if (finalTokens > targetTokens || reduction < minimumReduction) {
    const error = new SocratesError("context_compaction_target_not_met", "Compacted context did not reach the required size target.", {
      details: { initialTokens, finalTokens, targetTokens, reduction, minimumReduction },
      recoverable: true,
    })
    await input.compression.failSnapshot?.({
      snapshotId: result.snapshotId,
      code: error.code,
      message: error.message,
      details: error.details,
    })
    throw error
  }

  await input.compression.completeSnapshot?.({
    snapshotId: result.snapshotId,
    summary: result.summary,
    renderedSummary: result.renderedSummary,
    sourceHandles: result.sourceHandles,
    inputTokensEstimate: initialTokens,
    outputTokensEstimate: result.outputTokensEstimate,
    contextTokensAfter: finalTokens,
    ...(result.usage ? { usage: result.usage } : {}),
    compressorProviderId: result.compressorProviderId,
    compressorModelId: result.compressorModelId,
  })

  return {
    system: input.system,
    messages: result.messages,
    estimatedTokens: finalTokens,
    tokenCount: finalTokenCount,
    compactionEvents: [
      ...(startedEmitted ? [] : [result.started]),
      {
        type: "context.compaction.completed",
        snapshotId: result.snapshotId,
        inputTokensEstimate: initialTokens,
        outputTokensEstimate: result.outputTokensEstimate,
        contextUsedTokensEstimate: finalTokens,
        sizeClass: compactionSizeClass(finalTokens, thresholds),
      },
    ],
  }
}

export const precomputeContextSnapshot = async (input: PrepareContextInput): Promise<ContextCompactionLifecycleEvent[]> => {
  const thresholds = { ...DEFAULT_CONTEXT_COMPRESSION_THRESHOLDS, ...input.compression?.thresholds }
  const triggerTokens = effectiveCompactionTrigger(thresholds)
  const effectiveInput = await withLatestSnapshotApplied(input)
  const initialTokens = (await countPreparedContext(effectiveInput, thresholds)).inputTokens
  if (!input.compression?.enabled || initialTokens < triggerTokens) {
    return []
  }

  const result = await runContextCompaction(effectiveInput, thresholds, initialTokens, "precompute")
  if (!result.ok) {
    return [result.failed]
  }

  const projectedTokenCount = await countPreparedContext({ ...effectiveInput, messages: result.messages }, thresholds)
  const projectedTokens = projectedTokenCount.inputTokens
  const projectedReduction = initialTokens - projectedTokens
  const minimumReduction = Math.min(thresholds.minimumReductionTokens, Math.max(1, Math.floor(initialTokens * 0.1)))
  const targetTokens = Math.min(thresholds.postCompactionTargetTokens, triggerTokens)
  if (projectedTokens > targetTokens || projectedReduction < minimumReduction) {
    const error = new SocratesError("context_compaction_target_not_met", "Precomputed compaction did not reach the required size target.", {
      details: { initialTokens, projectedTokens, targetTokens, projectedReduction, minimumReduction },
      recoverable: true,
    })
    await input.compression.failSnapshot?.({
      snapshotId: result.snapshotId,
      code: error.code,
      message: error.message,
      details: error.details,
    })
    throw error
  }

  await input.compression.completeSnapshot?.({
    snapshotId: result.snapshotId,
    summary: result.summary,
    renderedSummary: result.renderedSummary,
    sourceHandles: result.sourceHandles,
    inputTokensEstimate: initialTokens,
    outputTokensEstimate: result.outputTokensEstimate,
    contextTokensAfter: projectedTokens,
    ...(result.usage ? { usage: result.usage } : {}),
    compressorProviderId: result.compressorProviderId,
    compressorModelId: result.compressorModelId,
  })

  return [
    result.started,
    {
      type: "context.compaction.completed",
      snapshotId: result.snapshotId,
      inputTokensEstimate: initialTokens,
      outputTokensEstimate: result.outputTokensEstimate,
      contextUsedTokensEstimate: projectedTokens,
      sizeClass: compactionSizeClass(projectedTokens, thresholds),
    },
  ]
}

type ContextCompactionResult =
  | {
      ok: true
      snapshotId: string
      started: ContextCompactionStartedEvent
      messages: ModelMessage[]
      summary: ChatCompaction | MemoryCompaction
      renderedSummary: string
      sourceHandles: Array<Record<string, unknown>>
      outputTokensEstimate: number
      usage?: ModelUsage
      compressorProviderId: ProviderId
      compressorModelId: string
    }
  | {
      ok: false
      failed: ContextCompactionFailedEvent
    }

type CompactionSelection = {
  headTurns: CompressorTurnInput[]
  tailTurns: CompressorTurnInput[]
  activeTurns: CompressorTurnInput[]
}

const legacyCompressorFallbacks = (
  compression: ContextCompressionRuntime,
  providerId: ProviderId,
  authMode: ProviderAuthMode,
  modelId: string,
): NonNullable<ContextCompressionRuntime["compressorFallbacks"]> => {
  if (!compression.compressorFallbackProviderId && !compression.compressorFallbackModelId) {
    return []
  }
  return [{ providerId, authMode, modelId }]
}

const runContextCompaction = async (
  input: PrepareContextInput,
  thresholds: ContextCompressionThresholds,
  initialTokens: number,
  reason: ContextCompressionReason,
  onStarted?: (event: ContextCompactionStartedEvent) => Promise<void> | void,
): Promise<ContextCompactionResult> => {
  const compression = input.compression as ContextCompressionRuntime
  const snapshotId = createId("ctxcmp")
  const compressorProviderId = compression.compressorProviderId ?? DEFAULT_COMPRESSOR_MODEL.providerId
  const compressorAuthMode = compression.compressorAuthMode ?? "api_key"
  const compressorModelId = compression.compressorModelId ?? DEFAULT_COMPRESSOR_MODEL.modelId
  const compressorThinkingEnabled = compression.compressorThinkingEnabled ?? false
  const compressorThinkingEffort = compression.compressorThinkingEffort
  const compressorFallbackProviderId = compression.compressorFallbackProviderId ?? DEFAULT_COMPRESSOR_FALLBACK_MODEL.providerId
  const compressorFallbackAuthMode = compression.compressorFallbackAuthMode ?? "api_key"
  const compressorFallbackModelId = compression.compressorFallbackModelId ?? DEFAULT_COMPRESSOR_FALLBACK_MODEL.modelId
  const mode = compression.mode ?? "chat"
  const latestSnapshot = validLatestSnapshot(await compression.getLatestSnapshot?.(), mode)
  const previouslyCompactedMessageIds = new Set(latestSnapshot?.sourceHandles.flatMap(sourceRefMessageIds) ?? [])
  const previouslyCompactedLegacyTurnIds = new Set(
    latestSnapshot?.sourceHandles.filter(isLegacyWholeTurnSource).map((handle) => handle.turnId).filter(isString) ?? [],
  )
  const selection = selectCompactionWindow(
    input.messages,
    thresholds,
    mode,
    previouslyCompactedMessageIds,
    previouslyCompactedLegacyTurnIds,
    estimateCompactionFixedTokens(input),
  )
  const sourceMessageIds = unique(selection.headTurns.flatMap((turn) => turn.messages.map((message) => message.id).filter(isString)))
  const sourceTurnIds = unique(selection.headTurns.map((turn) => turn.turnId).filter(isString))
  const started: ContextCompactionStartedEvent = {
    type: "context.compaction.started",
    snapshotId,
    reason,
    contextUsedTokensEstimate: initialTokens,
    targetTokens: preferredCompactionTarget(thresholds),
  }

  await compression.startSnapshot?.({
    snapshotId,
    reason,
    contextTokensEstimate: initialTokens,
    targetTokens: preferredCompactionTarget(thresholds),
    compressorProviderId,
    compressorModelId,
    sourceMessageIds,
    sourceTurnIds,
    ...(latestSnapshot?.snapshotId ? { previousSnapshotId: latestSnapshot.snapshotId } : {}),
  })
  await onStarted?.(started)

  try {
    if (selection.headTurns.length === 0 && !latestSnapshot?.renderedSummary) {
      throw new SocratesError("context_compaction_no_safe_head", "Context is over the trigger but has no completed head turns to compact safely.", {
        recoverable: true,
      })
    }

    const userContent = compressorUserContent(mode, selection, latestSnapshot)
    const compressorInputTokens = estimateTextTokens(userContent, { providerId: compressorProviderId, modelId: compressorModelId }).inputTokens
    if (compressorInputTokens > CONTEXT_MODEL_DISPATCH_CEILING_TOKENS) {
      throw new SocratesError("compressor_input_hard_limit_exceeded", "Compressor input exceeds the Socrates hard input limit.", {
        details: { compressorInputTokens, hardLimitTokens: CONTEXT_MODEL_DISPATCH_CEILING_TOKENS },
        recoverable: true,
      })
    }
    const compressor = new CompressorAgent()
    const compressorResult = await compressor.run({
      provider: input.provider,
      mode,
      primary: {
        providerId: compressorProviderId,
        authMode: compressorAuthMode,
        modelId: compressorModelId,
        thinkingEnabled: compressorThinkingEnabled,
        ...(compressorThinkingEffort ? { thinkingEffort: compressorThinkingEffort } : {}),
      },
      fallbacks: compression.compressorFallbacks ?? legacyCompressorFallbacks(compression, compressorFallbackProviderId, compressorFallbackAuthMode, compressorFallbackModelId),
      system: compressorSystemPrompt(mode),
      userContent,
      projectId: compression.projectId ?? "context_compaction",
      conversationId: compression.conversationId ?? "context_compaction",
      sessionId: compression.sessionId ?? compression.conversationId ?? snapshotId,
      turnId: compression.turnId ?? snapshotId,
      workspacePath: compression.workspacePath ?? ".",
      allowedTurnNumbers: allowedAnchorTurnNumbers(selection.headTurns, latestSnapshot?.renderedSummary),
    })
    if (compressorResult.mode !== mode) {
      throw new SocratesError("context_compaction_wrong_mode", "Compressor returned the wrong output mode.", { recoverable: true })
    }

    const summary = carryAnchorsDeterministically(latestSnapshot?.summary, compressorResult.output)
    const renderedSummary = renderCompactionMarkdown(summary)
    return {
      ok: true,
      snapshotId,
      summary,
      renderedSummary,
      sourceHandles: buildSourceHandles(
        selection.headTurns,
        summary,
        compression.projectId,
        compression.conversationId,
        latestSnapshot?.sourceHandles,
      ),
      outputTokensEstimate: estimateTextTokens(renderedSummary, {
        providerId: compressorResult.providerId,
        modelId: compressorResult.modelId,
      }).inputTokens,
      messages: packMessagesWithCompaction(selection, renderedSummary, mode),
      started,
      compressorProviderId: compressorResult.providerId,
      compressorModelId: compressorResult.modelId,
      ...(compressorResult.usage ? { usage: compressorResult.usage } : {}),
    }
  } catch (error) {
    const normalized =
      error instanceof SocratesError
        ? error
        : new SocratesError("context_compaction_failed", error instanceof Error ? error.message : String(error), {
            recoverable: true,
          })
    await compression.failSnapshot?.({
      snapshotId,
      code: normalized.code,
      message: normalized.message,
      details: normalized.details,
    })
    return {
      ok: false,
      failed: { type: "context.compaction.failed", snapshotId, error: normalized },
    }
  }
}

export const estimateModelContextTokens = async (
  provider: ModelProvider,
  input: Omit<PrepareContextInput, "provider" | "compression">,
  thresholds: Pick<ContextCompressionThresholds, "triggerTokens"> = DEFAULT_CONTEXT_COMPRESSION_THRESHOLDS,
): Promise<TokenCountResult> =>
  provider.countTokens({
    providerId: input.providerId,
    modelId: input.modelId,
    system: input.system,
    messages: input.messages,
    runtimeConfig: input.runtimeConfig,
    ...(input.tools ? { tools: input.tools } : {}),
    ...(input.structuredOutputSchema === undefined ? {} : { structuredOutputSchema: input.structuredOutputSchema }),
    countTokens: { exactThresholds: [thresholds.triggerTokens] },
  })

export const estimateTokens = (value: string): number => estimateTextTokens(value).inputTokens

const countPreparedContext = (
  input: PrepareContextInput,
  thresholds: Pick<ContextCompressionThresholds, "triggerTokens">,
): Promise<TokenCountResult> =>
  estimateModelContextTokens(
    input.provider,
    {
      providerId: input.providerId,
      modelId: input.modelId,
      runtimeConfig: input.runtimeConfig,
      system: input.system,
      messages: input.messages,
      ...(input.tools ? { tools: input.tools } : {}),
      ...(input.structuredOutputSchema === undefined ? {} : { structuredOutputSchema: input.structuredOutputSchema }),
    },
    thresholds,
  )

const compressorSystemPrompt = (mode: ContextCompressionMode): string =>
  mode === "memory" ? MEMORY_AGENT_COMPRESSOR_SYSTEM_PROMPT : SOCRATES_COMPRESSOR_SYSTEM_PROMPT

const compressorUserContent = (
  mode: ContextCompressionMode,
  selection: CompactionSelection,
  latestSnapshot: ContextCompactionSummary | undefined,
): string => {
  if (mode === "memory") {
    return buildMemoryAgentCompressorUserContent({
      ...(latestSnapshot?.renderedSummary ? { previousSummary: latestSnapshot.renderedSummary } : {}),
      manifestHead: buildMemoryAgentManifestHead(selection.headTurns),
    })
  }
  return buildSocratesCompressorUserContent({
    headTurns: selection.headTurns,
    ...(latestSnapshot?.renderedSummary ? { previousSummary: latestSnapshot.renderedSummary } : {}),
  })
}

const renderCompactionMarkdown = (summary: ChatCompaction | MemoryCompaction): string =>
  "manifestScope" in summary ? renderMemoryCompactionMarkdown(summary) : renderChatCompactionMarkdown(summary)

const selectCompactionWindow = (
  messages: ModelMessage[],
  thresholds: ContextCompressionThresholds,
  mode: ContextCompressionMode = "chat",
  previouslyCompactedMessageIds: ReadonlySet<string> = new Set(),
  previouslyCompactedLegacyTurnIds: ReadonlySet<string> = new Set(),
  fixedTokens = 0,
): CompactionSelection => {
  const rawMessages = messages
    .filter((message) => !isInternalCompactionMessage(message))
    .filter((message) => (!message.id || !previouslyCompactedMessageIds.has(message.id)))
  const turns = groupMessagesByTurn(rawMessages)
    .filter((turn) => !turn.turnId || !previouslyCompactedLegacyTurnIds.has(turn.turnId))
  const activeTurn = turns.at(-1)
  const completedTurns = turns.slice(0, -1)
  const activeSplit = activeTurn && mode === "chat"
    ? splitActiveTurn(activeTurn, thresholds, fixedTokens)
    : { compacted: [] as CompressorTurnInput[], raw: activeTurn ? [activeTurn] : [] }
  const activeTurns = activeSplit.raw
  const tailTurns: CompressorTurnInput[] = []
  let tailTokens = 0
  const activeTokens = activeTurns.reduce((total, turn) => total + estimateTurnTokens(turn), 0)
  const safeTailBudget = Math.max(0, thresholds.postCompactionTargetTokens - fixedTokens - activeTokens)
  const recentTailBudget = Math.min(thresholds.recentTailTargetTokens, safeTailBudget)

  for (let index = completedTurns.length - 1; index >= 0; index -= 1) {
    const turn = completedTurns[index]!
    const turnTokens = estimateTurnTokens(turn)
    if (tailTokens + turnTokens > recentTailBudget) {
      break
    }
    tailTurns.unshift(turn)
    tailTokens += turnTokens
  }

  const selection = {
    headTurns: [
      ...completedTurns.slice(0, completedTurns.length - tailTurns.length),
      ...activeSplit.compacted,
    ],
    tailTurns,
    activeTurns,
  }
  if (mode === "memory" && selection.headTurns.length === 0 && (selection.tailTurns.length > 0 || selection.activeTurns.length > 0)) {
    return {
      headTurns: [...selection.tailTurns, ...selection.activeTurns],
      tailTurns: [],
      activeTurns: [],
    }
  }
  return selection
}

const groupMessagesByTurn = (messages: ModelMessage[]): CompressorTurnInput[] => {
  const turns: CompressorTurnInput[] = []
  let currentKey: string | undefined
  let fallbackOrdinal = 0
  for (const message of messages) {
    const key = message.turnId ?? `message:${message.id ?? turns.length}`
    if (!currentKey || key !== currentKey) {
      currentKey = key
      fallbackOrdinal += 1
      turns.push({
        turnNo: validOrdinal(message.turnOrdinal) ?? fallbackOrdinal,
        ...(message.turnId ? { turnId: message.turnId } : {}),
        ...(validOrdinal(message.taskOrdinal) ? { taskOrdinal: message.taskOrdinal } : {}),
        sourceKind: "completed_turn",
        messages: [],
      })
    }
    turns[turns.length - 1]!.messages.push(message)
  }
  return turns
}

type ActiveToolBatch = {
  messages: ModelMessage[]
  firstIndex: number
  lastIndex: number
}

const splitActiveTurn = (
  turn: CompressorTurnInput,
  thresholds: ContextCompressionThresholds,
  fixedTokens: number,
): { compacted: CompressorTurnInput[]; raw: CompressorTurnInput[] } => {
  const batches = completedActiveToolBatches(turn.messages)
  if (batches.length < 2) return { compacted: [], raw: [turn] }

  const newest = batches.at(-1)!
  const protectedIndexes = new Set<number>()
  for (let index = 0; index < turn.messages.length; index += 1) {
    const inAnyBatch = batches.some((batch) => index >= batch.firstIndex && index <= batch.lastIndex)
    if (!inAnyBatch) protectedIndexes.add(index)
  }
  const protectedMessages = turn.messages.filter((_message, index) => protectedIndexes.has(index))
  const protectedTokens = estimateMessagesTokens(protectedMessages)
  const rawBatchBudget = Math.max(
    estimateMessagesTokens(newest.messages),
    Math.min(thresholds.recentTailTargetTokens, thresholds.postCompactionTargetTokens - fixedTokens - protectedTokens),
  )
  const rawBatches: ActiveToolBatch[] = []
  let rawBatchTokens = 0
  for (let index = batches.length - 1; index >= 0; index -= 1) {
    const batch = batches[index]!
    const batchTokens = estimateMessagesTokens(batch.messages)
    if (rawBatches.length > 0 && rawBatchTokens + batchTokens > rawBatchBudget) break
    rawBatches.unshift(batch)
    rawBatchTokens += batchTokens
  }
  const rawBatchStarts = new Set(rawBatches.map((batch) => batch.firstIndex))
  const compactedBatches = batches.filter((batch) => !rawBatchStarts.has(batch.firstIndex))
  if (compactedBatches.length === 0 || compactedBatches.some((batch) => batch.messages.some((message) => !message.id))) {
    return { compacted: [], raw: [turn] }
  }
  const compactedIndexes = new Set(compactedBatches.flatMap((batch) =>
    Array.from({ length: batch.lastIndex - batch.firstIndex + 1 }, (_unused, offset) => batch.firstIndex + offset),
  ))
  const rawMessages = turn.messages.filter((_message, index) => !compactedIndexes.has(index))
  return {
    compacted: compactedBatches.map((batch) => ({
      turnNo: turn.turnNo,
      ...(turn.turnId ? { turnId: turn.turnId } : {}),
      ...(turn.taskOrdinal ? { taskOrdinal: turn.taskOrdinal } : {}),
      sourceKind: "active_tool_batch",
      messages: batch.messages,
    })),
    raw: [{ ...turn, messages: rawMessages }],
  }
}

const completedActiveToolBatches = (messages: ModelMessage[]): ActiveToolBatch[] => {
  const batches: ActiveToolBatch[] = []
  for (let index = 0; index < messages.length - 1; index += 1) {
    const assistant = messages[index]
    const result = messages[index + 1]
    if (!assistant || !result || assistant.role !== "assistant" || result.role !== "tool") continue
    if (!Array.isArray(assistant.content) || !Array.isArray(result.content)) continue
    const calls = assistant.content.filter((part) => part.type === "tool-call")
    const results = result.content.filter((part) => part.type === "tool-result")
    if (calls.length === 0 || results.length !== calls.length) continue
    const resultIds = new Set(results.map((part) => part.toolCallId))
    if (calls.some((part) => !resultIds.has(part.toolCallId)) || results.some((part) => hasPendingStructuredState(part.output))) continue
    batches.push({ messages: [assistant, result], firstIndex: index, lastIndex: index + 1 })
    index += 1
  }
  return batches
}

const PENDING_STRUCTURED_STATUSES = new Set(["pending", "queued", "starting", "running", "waiting", "awaiting_input", "awaiting_approval", "streaming"])

const hasPendingStructuredState = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  if (typeof record.status === "string" && PENDING_STRUCTURED_STATUSES.has(record.status)) return true
  return [record.output, record.result, record.state].some((nested) => {
    if (!nested || typeof nested !== "object") return false
    const status = (nested as Record<string, unknown>).status
    return typeof status === "string" && PENDING_STRUCTURED_STATUSES.has(status)
  })
}

const estimateMessagesTokens = (messages: ModelMessage[]): number =>
  estimateTextTokens(JSON.stringify(messages.map(messageForTokenEstimate))).inputTokens

const validOrdinal = (value: number | undefined): number | undefined =>
  Number.isInteger(value) && (value ?? 0) > 0 ? value : undefined

const estimateTurnTokens = (turn: CompressorTurnInput): number => estimateTextTokens(JSON.stringify(turn.messages.map(messageForTokenEstimate))).inputTokens

const preferredCompactionTarget = (thresholds: ContextCompressionThresholds): number =>
  Math.min(thresholds.preferredTargetTokens, thresholds.postCompactionTargetTokens)

const effectiveCompactionTrigger = (thresholds: ContextCompressionThresholds): number =>
  Math.min(thresholds.triggerTokens, CONTEXT_MODEL_DISPATCH_CEILING_TOKENS)

const compactionSizeClass = (
  tokens: number,
  thresholds: ContextCompressionThresholds,
): ContextCompactionCompletedEvent["sizeClass"] => {
  const excellentTarget = Math.min(thresholds.excellentTargetTokens, preferredCompactionTarget(thresholds))
  if (tokens <= excellentTarget) return "excellent"
  if (tokens <= preferredCompactionTarget(thresholds)) return "preferred"
  return "acceptable"
}

const estimateCompactionFixedTokens = (input: PrepareContextInput): number =>
  estimateTextTokens([
    input.system,
    input.tools ? safeStringify(input.tools) : "",
    input.structuredOutputSchema === undefined ? "" : safeStringify(input.structuredOutputSchema),
  ].join("\n")).inputTokens +
  Math.ceil(MAX_COMPACTION_SUMMARY_CHARS / 4)

const messageForTokenEstimate = (message: ModelMessage): ModelMessage => {
  if (typeof message.content === "string") {
    return message
  }
  return {
    ...message,
    content: message.content.map((part) =>
      part.type === "image"
        ? {
            ...part,
            data: `[image bytes omitted for token estimate; encodedLength=${part.data.length}]`,
          }
        : part,
    ),
  }
}

const packMessagesWithCompaction = (
  selection: CompactionSelection,
  renderedSummary: string,
  mode: ContextCompressionMode,
): ModelMessage[] => [
  compactionContextMessage(renderedSummary, mode),
  ...[...selection.tailTurns, ...selection.activeTurns].flatMap((turn) => turn.messages),
  ...(mode === "memory" && selection.tailTurns.length === 0 && selection.activeTurns.length === 0
    ? [
        {
          role: "user" as const,
          content:
            "Continue the Global Memory Agent run from the compacted memory-agent context above. Use tools only if exact evidence is still needed; otherwise produce the memory-agent run report.",
        },
      ]
    : []),
]

const compactionContextMessage = (renderedSummary: string, mode: ContextCompressionMode): ModelMessage => ({
  role: "developer",
  content: [
    mode === "memory" ? "<socrates_internal_memory_context_compaction>" : "<socrates_internal_context_compaction>",
    mode === "memory"
      ? "This is model-visible internal context for the Global Memory Agent, not transcript-visible user content."
      : "This is model-visible internal context, not transcript-visible user content.",
    renderedSummary,
    mode === "memory" ? "</socrates_internal_memory_context_compaction>" : "</socrates_internal_context_compaction>",
  ].join("\n"),
})

const isInternalCompactionMessage = (message: ModelMessage): boolean =>
  message.role === "developer" &&
  typeof message.content === "string" &&
  (message.content.includes("<socrates_internal_context_compaction>") ||
    message.content.includes("<socrates_internal_memory_context_compaction>"))

const buildMemoryAgentManifestHead = (headTurns: CompressorTurnInput[]): string =>
  headTurns.length > 0 ? headTurns.map(renderMemoryAgentManifestTurn).join("\n\n") : "None."

const renderMemoryAgentManifestTurn = (turn: CompressorTurnInput): string =>
  [
    `## Turn ${turn.turnNo}`,
    turn.turnId ? `turnId: ${turn.turnId}` : undefined,
    ...turn.messages.map((message) => renderMemoryAgentManifestMessage(message)),
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n")

const renderMemoryAgentManifestMessage = (message: ModelMessage): string =>
  [
    `### ${message.role}${message.id ? ` messageId=${message.id}` : ""}`,
    typeof message.content === "string" ? message.content : message.content.map(renderMemoryAgentManifestPart).join("\n"),
  ].join("\n")

const renderMemoryAgentManifestPart = (part: ModelMessagePart): string => {
  if (part.type === "text" || part.type === "reasoning") {
    return part.text
  }
  if (part.type === "image") {
    return `[image: ${part.fileName ?? "unnamed"} ${part.mediaType}; bytes omitted]`
  }
  if (part.type === "tool-call") {
    return `[tool-call ${part.toolName} ${part.toolCallId}] input=${truncateWithNotice(safeStringify(part.input), 4_000, "tool input")}`
  }
  return `[tool-result ${part.toolName} ${part.toolCallId}] output=${truncateWithNotice(safeStringify(part.output), 12_000, "tool output")}`
}

const buildSourceHandles = (
  headTurns: CompressorTurnInput[],
  summary: ChatCompaction | MemoryCompaction,
  projectId?: string,
  conversationId?: string,
  previousSourceHandles: Array<Record<string, unknown>> = [],
): Array<Record<string, unknown>> => {
  const handles: Array<Record<string, unknown>> = headTurns.map((turn) => {
    const messageIds = turn.messages.map((message) => message.id).filter(isString)
    if (messageIds.length === 0) {
      return {
        turnNo: turn.turnNo,
        ...(turn.turnId ? { turnId: turn.turnId } : {}),
        ...(projectId ? { projectId } : {}),
        ...(conversationId ? { conversationId } : {}),
        retrieve: `trace_retrieve({ turnNo: ${turn.turnNo} })`,
      }
    }
    return compactionSourceRefSchema.parse({
      schemaVersion: 2,
      kind: turn.sourceKind ?? "completed_turn",
      turnOrdinal: turn.turnNo,
      ...(turn.taskOrdinal ? { taskOrdinal: turn.taskOrdinal } : {}),
      ...(turn.turnId ? { turnId: turn.turnId } : {}),
      messageIds,
      ...(projectId ? { projectId } : {}),
      ...(conversationId ? { conversationId } : {}),
      retrieve: `trace_retrieve({ turnNo: ${turn.turnNo} })`,
    })
  })
  const anchors: CompactionSourceRef[] = summary.anchors.map((anchor: string) => {
    const turnNo = Number(/^Turn (\d+):/.exec(anchor)?.[1])
    const currentTurn = headTurns.find((candidate) => candidate.turnNo === turnNo)
    const previousTurn = sourceTurnFromPrevious(previousSourceHandles, turnNo)
    return compactionSourceRefSchema.parse({
      schemaVersion: 2,
      kind: "anchor",
      anchor,
      turnOrdinal: turnNo,
      ...(currentTurn?.turnId || previousTurn?.turnId ? { turnId: currentTurn?.turnId ?? previousTurn?.turnId } : {}),
      ...(currentTurn?.taskOrdinal || previousTurn?.taskOrdinal ? { taskOrdinal: currentTurn?.taskOrdinal ?? previousTurn?.taskOrdinal } : {}),
      messageIds: currentTurn
        ? currentTurn.messages.map((message) => message.id).filter(isString)
        : previousTurn?.messageIds ?? [],
      ...(projectId ? { projectId } : {}),
      ...(conversationId ? { conversationId } : {}),
      retrieve: `trace_retrieve({ turnNo: ${turnNo} })`,
    })
  })
  return dedupeSourceHandles([...previousSourceHandles, ...handles, ...anchors])
}

const sourceTurnFromPrevious = (
  handles: Array<Record<string, unknown>>,
  turnNo: number,
): { turnId?: string; taskOrdinal?: number; messageIds: string[] } | undefined => {
  const handle = handles.find((candidate) => candidate.turnOrdinal === turnNo || candidate.turnNo === turnNo)
  if (!handle) return undefined
  return {
    ...(isString(handle.turnId) ? { turnId: handle.turnId } : {}),
    ...(validOrdinal(typeof handle.taskOrdinal === "number" ? handle.taskOrdinal : undefined) ? { taskOrdinal: handle.taskOrdinal as number } : {}),
    messageIds: sourceRefMessageIds(handle),
  }
}

const sourceRefMessageIds = (source: Record<string, unknown>): string[] =>
  Array.isArray(source.messageIds) ? source.messageIds.filter(isString) : []

const isLegacyWholeTurnSource = (source: Record<string, unknown>): boolean =>
  source.schemaVersion !== 2 && sourceRefMessageIds(source).length === 0

const carryAnchorsDeterministically = (
  previous: ChatCompaction | MemoryCompaction | undefined,
  current: ChatCompaction | MemoryCompaction,
): ChatCompaction | MemoryCompaction => {
  const record = current as (ChatCompaction | MemoryCompaction) & { anchors: string[] }
  return {
    ...record,
    anchors: unique([...(previous?.anchors ?? []), ...record.anchors]).slice(0, 80),
  }
}

const dedupeSourceHandles = (handles: Array<Record<string, unknown>>): Array<Record<string, unknown>> => {
  const seen = new Set<string>()
  return handles.filter((handle) => {
    const key = JSON.stringify(handle)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const allowedAnchorTurnNumbers = (headTurns: CompressorTurnInput[], previousSummary?: string): number[] => {
  const priorTurns = Array.from(previousSummary?.matchAll(/\bTurn (\d+):/g) ?? []).map((match) => Number(match[1]))
  return unique([...headTurns.map((turn) => turn.turnNo), ...priorTurns])
}

const contextHardLimitError = (
  inputTokens: number,
  thresholds: ContextCompressionThresholds,
  cause?: SocratesError,
): SocratesError =>
  new SocratesError("context_hard_limit_exceeded", "Socrates refused to send a main-model request at or above the 170k compaction boundary without a safe compacted context.", {
    details: { inputTokens, hardLimitTokens: effectiveCompactionTrigger(thresholds), ...(cause ? { compactionError: cause.code } : {}) },
    recoverable: true,
  })

const validLatestSnapshot = (snapshot: ContextCompactionSummary | undefined, mode: ContextCompressionMode): ContextCompactionSummary | undefined => {
  if (!snapshot) {
    return undefined
  }
  const parsed = (mode === "memory" ? memoryCompactionSchema : chatCompactionSchema).safeParse(snapshot.summary)
  if (!parsed.success) {
    return undefined
  }
  return { ...snapshot, summary: parsed.data }
}

const safeStringify = (value: unknown): string => {
  try {
    return typeof value === "string" ? value : JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const truncateWithNotice = (value: string, maxChars: number, label: string): string => {
  if (value.length <= maxChars) {
    return value
  }
  return `${value.slice(0, maxChars)}\n[Compacted: ${label} exceeded ${maxChars} chars; inspect exact source through trace_retrieve.]`
}

export const COMPRESSOR_SYSTEM_PROMPT = SOCRATES_COMPRESSOR_SYSTEM_PROMPT

export const buildCompressorUserMessageContent = (input: {
  latestSnapshot?: ContextCompactionSummary
  messages: ModelMessage[]
  thresholds?: Partial<ContextCompressionThresholds>
}): string => {
  const thresholds = { ...DEFAULT_CONTEXT_COMPRESSION_THRESHOLDS, ...input.thresholds }
  const summarizedMessageIds = new Set(input.latestSnapshot?.sourceHandles.flatMap(sourceRefMessageIds) ?? [])
  const legacyTurnIds = new Set(input.latestSnapshot?.sourceHandles.filter(isLegacyWholeTurnSource).map((handle) => handle.turnId).filter(isString) ?? [])
  const selection = selectCompactionWindow(input.messages, thresholds, "chat", summarizedMessageIds, legacyTurnIds)
  return buildSocratesCompressorUserContent({
    headTurns: selection.headTurns,
    ...(input.latestSnapshot?.renderedSummary ? { previousSummary: input.latestSnapshot.renderedSummary } : {}),
  })
}

const unique = <T>(items: T[]): T[] => Array.from(new Set(items))
const isString = (value: unknown): value is string => typeof value === "string" && value.length > 0
