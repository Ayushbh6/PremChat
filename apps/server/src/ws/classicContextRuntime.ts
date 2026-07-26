import type { ContextCompactionLifecycleEvent, ContextCompressionRuntime } from "@socrates/core"
import { apiError } from "../http"
import type { SocratesStore } from "../services/store"
import { appendAndEmit, makeEvent, type EventSink } from "./eventSender"

export const sendClassicContextCompactionEvent = (
  emitEvent: EventSink,
  store: SocratesStore,
  agentEvent: ContextCompactionLifecycleEvent,
  context: { projectId: string; conversationId: string; sessionId: string; turnId: string },
): void => {
  if (agentEvent.type === "context.compaction.started") {
    appendAndEmit(emitEvent, store, makeEvent("context.compaction.started", {
      snapshotId: agentEvent.snapshotId,
      reason: agentEvent.reason,
      contextUsedTokensEstimate: agentEvent.contextUsedTokensEstimate,
      targetTokens: agentEvent.targetTokens,
    }, { ...context, actor: { type: "system" } }), "core")
    return
  }
  if (agentEvent.type === "context.compaction.completed") {
    appendAndEmit(emitEvent, store, makeEvent("context.compaction.completed", {
      snapshotId: agentEvent.snapshotId,
      inputTokensEstimate: agentEvent.inputTokensEstimate,
      outputTokensEstimate: agentEvent.outputTokensEstimate,
      contextUsedTokensEstimate: agentEvent.contextUsedTokensEstimate,
      sizeClass: agentEvent.sizeClass,
    }, { ...context, actor: { type: "system" } }), "core")
    return
  }
  appendAndEmit(emitEvent, store, makeEvent("context.compaction.failed", {
    ...(agentEvent.snapshotId ? { snapshotId: agentEvent.snapshotId } : {}),
    error: apiError(agentEvent.error.code, agentEvent.error.message, { details: agentEvent.error.details }),
  }, { ...context, actor: { type: "system" } }), "core")
}

export const sendClassicContextUsageSnapshot = (
  emitEvent: EventSink,
  store: SocratesStore,
  input: {
    projectId: string
    conversationId: string
    sessionId: string
    turnId: string
    modelCallId: string
    providerId: string
    modelId: string
    contextWindowTokens: number
    contextUsedTokens: number
    metadata?: Record<string, unknown>
  },
): void => {
  const contextLeftTokens = Math.max(input.contextWindowTokens - input.contextUsedTokens, 0)
  const contextUsedPercent = input.contextWindowTokens > 0
    ? Math.min(100, Math.round((input.contextUsedTokens / input.contextWindowTokens) * 1000) / 10)
    : 0
  store.recordContextUsageSnapshot({
    conversationId: input.conversationId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    modelCallId: input.modelCallId,
    providerId: input.providerId,
    modelId: input.modelId,
    contextWindowTokens: input.contextWindowTokens,
    contextUsedTokens: input.contextUsedTokens,
    metadata: input.metadata ?? { source: "model_context_estimate" },
  })
  appendAndEmit(emitEvent, store, makeEvent("context.usage.snapshot", {
    providerId: input.providerId,
    modelId: input.modelId,
    contextWindowTokens: input.contextWindowTokens,
    contextUsedTokens: input.contextUsedTokens,
    contextLeftTokens,
    contextUsedPercent,
  }, {
    projectId: input.projectId,
    conversationId: input.conversationId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    actor: { type: "main_agent" },
  }), "core")
}

export const createClassicContextCompressionRuntime = (
  store: SocratesStore,
  projectId: string,
  conversationId: string,
  sessionId: string,
  turnId: string,
): ContextCompressionRuntime => {
  const compressor = store.getWorkerModelSetting("socrates_context_compactor")
  const fallback = process.env.SOCRATES_CONTEXT_COMPRESSION_FALLBACK_ENABLED === "false"
    ? undefined
    : contextCompressorFallback(store, compressor)
  return {
    enabled: process.env.SOCRATES_CONTEXT_COMPRESSION_ENABLED !== "false",
    projectId,
    conversationId,
    sessionId,
    turnId,
    workspacePath: store.getPrimaryWorkspacePath(projectId),
    compressorProviderId: compressor.providerId,
    compressorAuthMode: compressor.authMode ?? "api_key",
    compressorModelId: compressor.modelId,
    compressorThinkingEnabled: compressor.thinkingEnabled,
    ...(compressor.thinkingEffort ? { compressorThinkingEffort: compressor.thinkingEffort } : {}),
    ...(fallback ? { compressorFallbacks: [fallback] } : {}),
    getLatestSnapshot: () => store.getLatestContextCompactionSnapshot(conversationId),
    startSnapshot: (input) => store.startContextCompactionSnapshot({ ...input, projectId, conversationId, sessionId, turnId }),
    completeSnapshot: (input) => store.completeContextCompactionSnapshot(input),
    failSnapshot: (input) => {
      store.failContextCompactionSnapshot(input)
    },
  }
}

const contextCompressorFallback = (
  store: SocratesStore,
  primary: ReturnType<SocratesStore["getWorkerModelSetting"]>,
): NonNullable<ContextCompressionRuntime["compressorFallbacks"]>[number] | undefined => {
  const available = store.listAvailableModels()
  const fallback = available.defaultModel
    ? available.models.find((model) =>
        model.providerId === available.defaultModel?.providerId &&
        model.authMode === available.defaultModel?.authMode &&
        model.modelId === available.defaultModel?.modelId)
    : undefined
  if (!fallback || (
    fallback.providerId === primary.providerId &&
    fallback.authMode === (primary.authMode ?? "api_key") &&
    fallback.modelId === primary.modelId
  )) return undefined
  const thinking = fallback.thinkingOptions.find((option) => option.id === fallback.defaultThinkingOptionId) ?? fallback.thinkingOptions[0]
  return {
    providerId: fallback.providerId,
    authMode: fallback.authMode,
    modelId: fallback.modelId,
    thinkingEnabled: thinking?.enabled ?? false,
    ...(thinking?.effort ? { thinkingEffort: thinking.effort } : {}),
  }
}
