import {
  frontierHandoverToolOutputSchema,
  normalizedToolCallSchema,
  socratesFinalAnswerSchema,
  socratesGoalResolutionModelOutputSchema,
  waitToolOutputSchema,
  type SocratesFinalAnswer,
  type DynamicToolCapabilityRegistration,
  type ModelToolDefinition,
  type NormalizedToolCall,
  type ProviderId,
  type RuntimeConfig,
  type SocratesGoalResolutionModelOutput,
  type SocratesGoalResolutionOutput,
  type ResolvedTurnContext,
  type ResolvedTurnContextSeed,
  type ResolvedTurnCapabilityItem,
  type ResolvedTurnMemoryItem,
  type ToolExecutionResult,
  type ToolName,
  type WaitToolOutput,
  type WorkerModelSettings,
} from "@socrates/contracts"
import { createId, normalizeError, nowIso, SocratesError } from "@socrates/shared"
import type { ModelEvent, ModelMessage, ModelMessagePart, ModelProvider, ModelUsage, TokenCountResult } from "@socrates/providers"
import {
  type ContextCompactionLifecycleEvent,
  type ContextCompressionRuntime,
} from "../context/contextCompression"
import { ToolOutputDispositionLedger } from "../context/toolOutputDisposition"
import {
  capabilityCatalog,
  type CapabilityCatalog,
  type CapabilitySet,
} from "../capabilities/CapabilityCatalog"
import { buildSocratesSystemPrompt, type SocratesPromptContext } from "../prompts/socratesPrompt"
import {
  buildSocratesGoalResolutionUserContent,
  SOCRATES_GOAL_RESOLUTION_PHASE_PROMPT,
  type SocratesGoalResolutionCandidate,
} from "../prompts/socratesGoalResolutionPrompt"
import type { ApprovalDecision, ApprovalRequest, CredentialInputDecision, CredentialInputRequest, ToolExecutors, ToolLifecycleEvent } from "../tools/types"
import type { ActiveGoalCard } from "./goalContext"
import { AgentRuntime } from "./AgentRuntime"
import type { AgentDefinition } from "./AgentDefinition"
import { ContextPipeline } from "./ContextPipeline"
import {
  socratesGoalResolutionPhaseManifest,
  socratesMainAgentDefinition,
  type DynamicSystemPromptContext,
} from "./agentDefinitions"
import { prepareTurnContext, renderResolvedTurnContext } from "./prepareTurnContext"
import { SocratesTurnLifecycle } from "./SocratesTurnLifecycle"
import { AsyncEventQueue } from "./AsyncEventQueue"
import {
  attachModelMetadata,
  frontierRuntimeConfig,
  insertDynamicPromptContext,
  insertStableCachePrelude,
  isSameModelSelection,
  nativeFollowUpMessagesForToolResult,
} from "./socratesMemorySupport"
import {
  interactiveTerminalAwaitingInput,
  isConfirmedToolErrorResult,
} from "./socratesToolGuards"
import {
  extractStreamingPreview,
  normalizedToolTargetKey,
  sanitizeToolExecutionResultForModel,
  stableToolInputKey,
} from "./socratesToolResultSupport"
import {
  ReconciliationWatermarkController,
  buildSocratesReconciliationNotice,
  type ReconciliationWatermarkState,
} from "./reconciliationWatermark"
import { appendNoticeToLastSuccessfulToolResult } from "../context/resultLocalNotices"
import { assertCompleteModelStep, parseSocratesFinalOutput } from "./socratesFinalOutput"

export type SocratesAgentTurnInput = {
  projectId?: string
  conversationId?: string
  sessionId?: string
  cacheKey?: string
  turnId?: string
  providerId: ProviderId
  modelId: string
  runtimeConfig: RuntimeConfig
  frontierModelSettings?: FrontierModelSettings
  messages: ModelMessage[]
  promptContext?: SocratesPromptContext
  workspacePath?: string
  toolExecutors?: ToolExecutors
  createModelCall?: (input: {
    providerId: ProviderId
    modelId: string
    runtimeConfig: RuntimeConfig
    messages: ModelMessage[]
    estimatedTokens: number
    tokenCount: TokenCountResult
    promptContext?: SocratesPromptContext
    tools: ModelToolDefinition[]
  }) => string
  requestApproval?: (request: ApprovalRequest) => Promise<ApprovalDecision>
  requestCredentialInput?: (request: CredentialInputRequest) => Promise<CredentialInputDecision>
  stableCachePreludeSnapshot?: StableCachePreludeSnapshot
  activeGoal?: ActiveGoalCard
  resolvedTurnContextSeed?: ResolvedTurnContextSeed
  resolvedTurnMemory?: readonly ResolvedTurnMemoryItem[]
  resolvedTurnCapabilities?: readonly ResolvedTurnCapabilityItem[]
  completionMode: "main_structured" | "worker_text"
  contextCompression?: ContextCompressionRuntime
  maxToolCallsPerTurn?: number
  maxConfirmedToolErrorsPerTurn?: number
  maxParallelToolCalls?: number
  runtimeCapabilities?: DynamicToolCapabilityRegistration[] | (() => DynamicToolCapabilityRegistration[])
  abortSignal?: AbortSignal
  fileFreshness?: import("../tools/types").FileFreshnessTracker
  reconciliationWatermark?: ReconciliationWatermarkState
  persistReconciliationWatermark?: (state: ReconciliationWatermarkState) => void | Promise<void>
  reconciliationClock?: () => number
  taskStartedAt?: string
}

export type StableCachePreludeSnapshot = {
  projectRules?: string
  globalRules?: string
  identitySections: Partial<Record<"core_identity" | "voice_and_presence" | "relationship_to_user", string>>
  cacheHit?: boolean
}

export type FrontierModelSettings = Pick<WorkerModelSettings, "providerId" | "authMode" | "modelId" | "thinkingEnabled" | "thinkingEffort">

export type SocratesAgentContextPrecomputeInput = {
  providerId: ProviderId
  modelId: string
  runtimeConfig: RuntimeConfig
  messages: ModelMessage[]
  promptContext?: SocratesPromptContext
  contextCompression: ContextCompressionRuntime
}

export type SocratesAgentEvent =
  | ModelEvent
  | ToolLifecycleEvent
  | ContextCompactionLifecycleEvent
  | { type: "agent.suspended"; wait: WaitToolOutput }
  | { type: "agent.final_result"; result: SocratesFinalAnswer }
  | {
      type: "agent.handover"
      toolCallId: string
      stepIndex: number
      fromProviderId: ProviderId
      fromModelId: string
      toProviderId: ProviderId
      toModelId: string
      focus?: string
    }

const normalizeGoalResolutionModelOutput = (
  value: SocratesGoalResolutionModelOutput,
): SocratesGoalResolutionOutput => {
  if (value.decision === "current") return { decision: "current" }
  if (value.decision === "older" && value.candidate !== null) {
    return { decision: "older", candidate: value.candidate }
  }
  if (value.decision === "new" && value.title !== null) {
    return { decision: "new", title: value.title }
  }
  if (value.decision === "clarify" && value.question !== null) {
    return { decision: "clarify", question: value.question }
  }
  throw new SocratesError("structured_agent_output_invalid", "Goal resolution omitted its decision-specific field.", {
    recoverable: true,
  })
}

export class SocratesAgent {
  private readonly contextPipeline = new ContextPipeline()
  private readonly runtime = new AgentRuntime(this.contextPipeline)
  private readonly turnLifecycle: SocratesTurnLifecycle
  private readonly baseCapabilities: CapabilitySet
  private readonly definition: AgentDefinition<DynamicSystemPromptContext, unknown>
  private readonly definitionPromptContext: DynamicSystemPromptContext

  constructor(
    private readonly provider: ModelProvider,
    private readonly catalog: CapabilityCatalog = capabilityCatalog,
    definition?: AgentDefinition<DynamicSystemPromptContext, unknown>,
    definitionPromptContext?: DynamicSystemPromptContext,
  ) {
    this.definition = definition ?? socratesMainAgentDefinition
    this.definitionPromptContext = definitionPromptContext ?? { system: buildSocratesSystemPrompt() }
    try {
      this.baseCapabilities = this.catalog.resolve(this.definition.roleManifest)
    } catch (error) {
      throw new SocratesError(
        "agent_role_manifest_mismatch",
        error instanceof Error ? error.message : String(error),
      )
    }
    this.turnLifecycle = new SocratesTurnLifecycle(this.baseCapabilities)
  }

  async precomputeContext(input: SocratesAgentContextPrecomputeInput): Promise<ContextCompactionLifecycleEvent[]> {
    const system = this.definition.prompt.buildSystem(this.definitionPromptContext)
    const messages = [...input.messages]
    insertDynamicPromptContext(messages, input.promptContext)
    return this.contextPipeline.precompute({
      provider: this.provider,
      providerId: input.providerId,
      modelId: input.modelId,
      runtimeConfig: input.runtimeConfig,
      system,
      messages,
      compression: input.contextCompression,
    })
  }

  async resolveGoal(input: {
    projectId: string
    conversationId: string
    sessionId: string
    turnId: string
    workspacePath: string
    providerId: ProviderId
    modelId: string
    runtimeConfig: RuntimeConfig
    userMessage: string
    current?: SocratesGoalResolutionCandidate
    older: readonly SocratesGoalResolutionCandidate[]
    latestExchange?: import("@socrates/contracts").ResolvedTurnExactExchange
    clarificationAnswer?: string
    cacheKey?: string
    abortSignal?: AbortSignal
  }): Promise<{
    decision: SocratesGoalResolutionOutput
    source: "model" | "fallback"
    attempt: {
      providerId: ProviderId
      modelId: string
      status: "completed" | "failed"
      startedAt: string
      completedAt: string
      durationMs: number
      usages: ModelUsage[]
      error?: { code: string; message: string; recoverable: boolean }
    }
  }> {
    const olderCandidates = new Set(input.older.map((candidate) => candidate.candidate))
    const schema = socratesGoalResolutionModelOutputSchema.superRefine((value, context) => {
      if (value.decision === "current" && input.current === undefined) {
        context.addIssue({ code: "custom", path: ["decision"], message: "Current requires an available current goal." })
      }
      if (value.decision === "older" && (value.candidate === null || !olderCandidates.has(value.candidate))) {
        context.addIssue({ code: "custom", path: ["candidate"], message: "Older must select a listed older candidate." })
      }
      if (value.decision === "new" && value.title === null) {
        context.addIssue({ code: "custom", path: ["title"], message: "New requires a title." })
      }
      if (value.decision === "clarify" && value.question === null) {
        context.addIssue({ code: "custom", path: ["question"], message: "Clarify requires a question." })
      }
    })
    const startedAt = nowIso()
    const startedAtMs = Date.now()
    try {
      const result = await this.runtime.run({
        provider: this.provider,
        providerId: input.providerId,
        modelId: input.modelId,
        runtimeConfig: { ...input.runtimeConfig, approvalMode: "read_only_auto", sandboxMode: "read_only" },
        system: `${this.definition.prompt.buildSystem(this.definitionPromptContext)}\n\n${SOCRATES_GOAL_RESOLUTION_PHASE_PROMPT}`,
        userContent: buildSocratesGoalResolutionUserContent(input),
        completion: { mode: "structured", schema, maxOutputRepairAttempts: 1 },
        capabilitySet: this.catalog.resolve(socratesGoalResolutionPhaseManifest),
        toolExecutors: {},
        maxToolCalls: 0,
        projectId: input.projectId,
        conversationId: input.conversationId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        workspacePath: input.workspacePath,
        ...(input.cacheKey ? { cacheKey: input.cacheKey } : {}),
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      })
      return {
        decision: normalizeGoalResolutionModelOutput(result.output),
        source: "model",
        attempt: {
          providerId: input.providerId,
          modelId: input.modelId,
          status: "completed",
          startedAt,
          completedAt: nowIso(),
          durationMs: Date.now() - startedAtMs,
          usages: result.usages,
        },
      }
    } catch (error) {
      const normalized = normalizeError(error)
      return {
        decision: input.current
          ? { decision: "current" }
          : { decision: "clarify", question: "I could not safely determine the right goal. What outcome should I treat this as?" },
        source: "fallback",
        attempt: {
          providerId: input.providerId,
          modelId: input.modelId,
          status: "failed",
          startedAt,
          completedAt: nowIso(),
          durationMs: Date.now() - startedAtMs,
          usages: [],
          error: { code: normalized.code, message: normalized.message, recoverable: normalized.recoverable },
        },
      }
    }
  }

  async *streamTurn(input: SocratesAgentTurnInput): AsyncIterable<SocratesAgentEvent> {
    const system = this.definition.prompt.buildSystem(this.definitionPromptContext)
    const messages: ModelMessage[] = [...input.messages]
    const toolOutputDispositions = new ToolOutputDispositionLedger()
    if (
      input.maxToolCallsPerTurn !== undefined
      && (!Number.isInteger(input.maxToolCallsPerTurn)
        || input.maxToolCallsPerTurn < 0
        || input.maxToolCallsPerTurn > this.definition.limits.maxToolCalls)
    ) {
      throw new SocratesError(
        "agent_tool_budget_invalid",
        `Agent ${this.definition.id} tool budget must be between 0 and ${this.definition.limits.maxToolCalls}.`,
      )
    }
    const maxToolCallsPerTurn = input.maxToolCallsPerTurn ?? this.definition.limits.maxToolCalls
    const maxConfirmedToolErrorsPerTurn = input.maxConfirmedToolErrorsPerTurn ?? 10
    const maxParallelToolCalls = input.maxParallelToolCalls ?? 5
    let usedToolCalls = 0
    let confirmedToolErrors = 0
    let forceFinalNoTools = false
    const duplicateTraceRetrieveResults = new Map<string, unknown>()
    const toolInputCounts = new Map<string, number>()
    const toolTargetCounts = new Map<string, number>()
    const openRouterPreferredProvidersByModel = new Map<string, string>()
    let pendingInteractiveTerminalName: string | undefined
    let currentProviderId = input.providerId
    let currentModelId = input.modelId
    let currentRuntimeConfig = input.runtimeConfig
    let handedOverToFrontier = isSameModelSelection(input.runtimeConfig, input.frontierModelSettings)
    let frontierHandoverRejected = false
    const reconciliationNow = input.reconciliationClock ?? Date.now
    const reconciliationWatermark = new ReconciliationWatermarkController({
      ...(input.reconciliationWatermark ? { state: input.reconciliationWatermark } : {}),
      ...(input.taskStartedAt ? { startedAt: input.taskStartedAt } : {}),
      ...(input.reconciliationClock ? { now: input.reconciliationClock } : {}),
    })
    const persistReconciliationWatermark = async () => {
      await input.persistReconciliationWatermark?.(reconciliationWatermark.state())
    }

    const stablePrelude = await this.turnLifecycle.loadStablePrelude(input, messages)
    for (const event of stablePrelude.events) {
      yield event
    }
    if (stablePrelude.stableCachePreludeMessage) {
      insertStableCachePrelude(messages, stablePrelude.stableCachePreludeMessage)
    }
    insertDynamicPromptContext(messages, input.promptContext)
    if (input.resolvedTurnContextSeed) {
      const resolvedTurnContext: ResolvedTurnContext = prepareTurnContext(input.resolvedTurnContextSeed, input.resolvedTurnMemory, input.resolvedTurnCapabilities)
      messages.push({ role: "developer", content: renderResolvedTurnContext(resolvedTurnContext) })
    }

    for (let step = 0; ; step += 1) {
      const runtimeCapabilities = typeof input.runtimeCapabilities === "function"
        ? input.runtimeCapabilities()
        : input.runtimeCapabilities
      let capabilities: CapabilitySet
      try {
        capabilities = this.catalog.resolve(this.definition.roleManifest, runtimeCapabilities ?? [])
      } catch (error) {
        throw new SocratesError(
          "agent_role_manifest_mismatch",
          error instanceof Error ? error.message : String(error),
        )
      }
      const handoverAvailable = Boolean(
        input.completionMode === "main_structured" &&
          input.frontierModelSettings &&
          !handedOverToFrontier &&
          !frontierHandoverRejected,
      )
      const tools =
        forceFinalNoTools || !input.toolExecutors
          ? []
          : capabilities
              .modelDefinitions()
              .filter((tool) => tool.name !== "handover_to_frontier" || handoverAvailable)
      const compactionStartedEvents = new AsyncEventQueue<ContextCompactionLifecycleEvent>()
      const preparedContextPromise = (async () => {
        try {
          return await this.contextPipeline.prepare({
            provider: this.provider,
            providerId: currentProviderId,
            modelId: currentModelId,
            runtimeConfig: currentRuntimeConfig,
            system,
            messages,
            tools,
            ...(input.completionMode === "main_structured" ? { structuredOutputSchema: socratesFinalAnswerSchema } : {}),
            ...(input.contextCompression ? { compression: input.contextCompression } : {}),
            onCompactionStarted: (event) => compactionStartedEvents.push(event),
          })
        } finally {
          compactionStartedEvents.close()
        }
      })()
      void preparedContextPromise.catch(() => undefined)

      for await (const event of compactionStartedEvents) {
        yield event
      }

      const preparedContext = await preparedContextPromise
      const rawMessageCountAtPreparation = messages.length
      for (const event of preparedContext.compactionEvents) {
        yield event
        if (event.type === "context.compaction.failed") {
          throw event.error
        }
      }
      if (preparedContext.compactionEvents.some((event) => event.type === "context.compaction.completed")) {
        reconciliationWatermark.markCompactionBoundary()
        await persistReconciliationWatermark()
      }
      if (input.abortSignal?.aborted) {
        return
      }
      const modelCallId = input.createModelCall?.({
        providerId: currentProviderId,
        modelId: currentModelId,
        runtimeConfig: currentRuntimeConfig,
        messages: preparedContext.messages,
        estimatedTokens: preparedContext.estimatedTokens,
        tokenCount: preparedContext.tokenCount,
        tools,
        ...(input.promptContext ? { promptContext: input.promptContext } : {}),
      })
      const assistantParts: ModelMessagePart[] = []
      const toolCalls: NormalizedToolCall[] = []
      const repeatedToolInputsThisStep = new Set<string>()
      const streamedToolCallIds = new Set<string>()
      const completedToolCallIds = new Set<string>()
      const toolRunIds = new Map<string, string>()
      let stepText = ""
      const suppressAnswerDeltas = input.completionMode === "main_structured"
      const handoverToolExposed = tools.some((tool) => tool.name === "handover_to_frontier")
      const bufferAnswerForPotentialHandover = handoverToolExposed && !suppressAnswerDeltas
      const bufferedAnswerEvents: ModelEvent[] = []
      const bufferedCompletionEvents: ModelEvent[] = []
      let finishReason: string | undefined
      const preferredOpenRouterProvider =
        currentProviderId === "openrouter" ? openRouterPreferredProvidersByModel.get(currentModelId) : undefined
      const toolRunIdFor = (providerToolCallId: string): string => {
        const key = `${modelCallId ?? "model"}:${step}:${providerToolCallId}`
        const existing = toolRunIds.get(key)
        if (existing) {
          return existing
        }
        const toolRunId = createId("tcall")
        toolRunIds.set(key, toolRunId)
        return toolRunId
      }

      for await (const modelEvent of this.runtime.run({
        provider: this.provider,
        providerId: currentProviderId,
        modelId: currentModelId,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.cacheKey ? { cacheKey: input.cacheKey } : {}),
        ...(preferredOpenRouterProvider ? { providerRouting: { preferredOpenRouterProvider } } : {}),
        system,
        messages: preparedContext.messages,
        runtimeConfig: currentRuntimeConfig,
        tools,
        ...(input.completionMode === "main_structured" ? { structuredOutputSchema: socratesFinalAnswerSchema } : {}),
        ...(modelCallId ? { modelCallId } : {}),
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      })) {
        if (input.abortSignal?.aborted) {
          return
        }

        if (modelEvent.type === "model.answer.delta") {
          stepText += modelEvent.text
          if (suppressAnswerDeltas) {
            continue
          }
          if (bufferAnswerForPotentialHandover) {
            bufferedAnswerEvents.push(attachModelMetadata(modelEvent, modelCallId, step))
            continue
          }
        }

        if (currentProviderId === "openrouter" && (modelEvent.type === "model.usage" || modelEvent.type === "model.completed")) {
          const routedProvider = modelEvent.usage?.routedProvider?.trim()
          if (routedProvider && !openRouterPreferredProvidersByModel.has(currentModelId)) {
            openRouterPreferredProvidersByModel.set(currentModelId, routedProvider)
          }
        }

        if (modelEvent.type === "model.reasoning.completed") {
          assistantParts.push({
            type: "reasoning",
            text: modelEvent.text,
            ...(modelEvent.providerMetadata ? { providerMetadata: modelEvent.providerMetadata } : {}),
          })
        }

        if (modelEvent.type === "model.tool_call.streaming") {
          streamedToolCallIds.add(modelEvent.toolCallId)
          const tool = capabilities.get(modelEvent.toolName as ToolName)
          if (tool) {
            const preview = extractStreamingPreview(modelEvent.toolName, modelEvent.argsText)
            yield {
              type: "tool.call.streaming",
              toolCallId: toolRunIdFor(modelEvent.toolCallId),
              providerToolCallId: modelEvent.toolCallId,
              toolName: tool.name,
              category: tool.category,
              displayName: tool.displayName ?? tool.name,
              ...(preview.argsPreview ? { argsPreview: preview.argsPreview } : {}),
              ...(preview.pathPreview ? { pathPreview: preview.pathPreview } : {}),
              ...(modelCallId ? { modelCallId } : {}),
              stepIndex: step,
            }
          }
          continue
        }

        if (modelEvent.type === "model.tool_call.completed") {
          completedToolCallIds.add(modelEvent.toolCall.toolCallId)
          const parsed = normalizedToolCallSchema.safeParse(modelEvent.toolCall)
          if (parsed.success) {
            if (parsed.data.toolName !== "context_disposition") {
              const inputKey = stableToolInputKey(parsed.data.toolName, parsed.data.input)
              const nextCount = (toolInputCounts.get(inputKey) ?? 0) + 1
              toolInputCounts.set(inputKey, nextCount)
              if (nextCount >= 3) {
                repeatedToolInputsThisStep.add(`${parsed.data.toolName} ${JSON.stringify(parsed.data.input)}`)
              }
              const targetKey = normalizedToolTargetKey(parsed.data)
              if (targetKey) {
                const targetCount = (toolTargetCounts.get(targetKey) ?? 0) + 1
                toolTargetCounts.set(targetKey, targetCount)
                if (targetCount >= 4) repeatedToolInputsThisStep.add(targetKey)
              }
            }
            toolCalls.push({
              ...parsed.data,
              toolCallId: toolRunIdFor(parsed.data.toolCallId),
              providerToolCallId: parsed.data.toolCallId,
            })
          }
        }

        if (modelEvent.type === "model.completed") finishReason = modelEvent.finishReason

        if (bufferAnswerForPotentialHandover && modelEvent.type === "model.completed") {
          bufferedCompletionEvents.push(attachModelMetadata(modelEvent, modelCallId, step))
          continue
        }

        yield attachModelMetadata(modelEvent, modelCallId, step)
      }

      assertCompleteModelStep({ streamedToolCallIds, completedToolCallIds, ...(finishReason ? { finishReason } : {}) })
      const requestedHandover = toolCalls.find((toolCall) => toolCall.toolName === "handover_to_frontier")
      if (!requestedHandover) {
        for (const event of bufferedAnswerEvents) {
          yield event
        }
      }
      for (const event of bufferedCompletionEvents) {
        yield event
      }

      if (toolCalls.length === 0 && pendingInteractiveTerminalName) {
        if (!input.toolExecutors || tools.length === 0) {
          throw new SocratesError("interactive_terminal_wait_required", `Interactive Terminal "${pendingInteractiveTerminalName}" is still awaiting user input.`, {
            recoverable: true,
          })
        }
        // Once the prompt is visible, the user interacts directly with the PTY.
        // Suspend deterministically until the full program finishes instead of
        // relying on every provider to remember the wait call after drafting text.
        const providerToolCallId = createId("tcall")
        toolCalls.push({
          toolCallId: toolRunIdFor(providerToolCallId),
          providerToolCallId,
          toolName: "wait",
          input: {
            terminalNames: [pendingInteractiveTerminalName],
            wakeOn: ["completed", "failed"],
            reason: "Awaiting interactive Terminal completion",
          },
        })
      }

      if (toolCalls.length === 0 && input.completionMode === "main_structured") {
        const finalResult = parseSocratesFinalOutput(stepText)
        reconciliationWatermark.completeFinalCheckpoint()
        await persistReconciliationWatermark()
        yield { type: "agent.final_result", result: finalResult }
        return
      }

      if (!input.toolExecutors || tools.length === 0 || toolCalls.length === 0) {
        return
      }

      if (!input.workspacePath) {
        throw new SocratesError("workspace_path_required", "Tool execution requires an active project workspace")
      }
      if (!input.requestApproval) {
        throw new SocratesError("approval_handler_required", "Tool execution requires an approval handler")
      }

      if (stepText && !requestedHandover) {
        assistantParts.push({ type: "text", text: stepText })
      }
      assistantParts.push(
        ...toolCalls.map((toolCall) => ({
          type: "tool-call" as const,
          toolCallId: toolCall.providerToolCallId ?? toolCall.toolCallId,
          toolName: toolCall.toolName,
          input: toolCall.input,
          ...(toolCall.providerMetadata ? { providerMetadata: toolCall.providerMetadata } : {}),
        })),
      )

      const batch = this.turnLifecycle.executeToolCalls({
        toolCalls,
        capabilitySet: capabilities,
        context: {
          projectId: input.projectId ?? "",
          conversationId: input.conversationId ?? "",
          sessionId: input.sessionId ?? "",
          turnId: input.turnId ?? "",
          workspacePath: input.workspacePath,
          runtimeConfig: currentRuntimeConfig,
          executors: input.toolExecutors,
          requestApproval: input.requestApproval,
          requestCredentialInput:
            input.requestCredentialInput ??
            (async (request) => ({ decision: "cancelled" as const, source: request.source })),
          ...(input.frontierModelSettings
            ? {
                frontierModel: {
                  providerId: input.frontierModelSettings.providerId,
                  modelId: input.frontierModelSettings.modelId,
                },
              }
            : {}),
          modelCallId,
          stepIndex: step,
          ...(input.fileFreshness ? { fileFreshness: input.fileFreshness } : {}),
          ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
          applyContextDisposition: async (dispositionInput) =>
            toolOutputDispositions.apply(
              dispositionInput,
              toolCalls.some((toolCall) => toolCall.toolName !== "context_disposition"),
            ),
        },
        remainingBudget: maxToolCallsPerTurn - usedToolCalls,
        maxParallelToolCalls,
        duplicateTraceRetrieveResults,
      })

      let approvalRequestedAt: number | undefined
      for await (const event of batch.events) {
        if (event.type === "approval.requested") approvalRequestedAt ??= reconciliationNow()
        yield event
      }

      const execution = await batch.done
      const operationalToolCalls = toolCalls.filter((toolCall) => toolCall.toolName !== "context_disposition")
      const operationalResults = execution.results.filter((result) => result.toolName !== "context_disposition")
      reconciliationWatermark.recordBatch(operationalToolCalls, operationalResults)
      if (approvalRequestedAt !== undefined && reconciliationNow() - approvalRequestedAt >= 60_000) {
        reconciliationWatermark.markSuspension()
      }
      await persistReconciliationWatermark()
      const interactiveTerminalName = interactiveTerminalAwaitingInput(execution.results)
      if (interactiveTerminalName) {
        pendingInteractiveTerminalName = interactiveTerminalName
      }
      const waitResult = execution.results.find(
        (result): result is ToolExecutionResult & { ok: true; output: WaitToolOutput } =>
          result.ok === true && result.toolName === "wait" && waitToolOutputSchema.safeParse(result.output).success,
      )
      if (waitResult?.output.status === "waiting") {
        reconciliationWatermark.markSuspension()
        await persistReconciliationWatermark()
        yield { type: "agent.suspended", wait: waitResult.output }
        return
      }
      usedToolCalls += execution.countedToolCalls
      const confirmedToolErrorResults = execution.results.filter(isConfirmedToolErrorResult)
      confirmedToolErrors += confirmedToolErrorResults.length

      messages.push({ role: "assistant", content: assistantParts })
      const toolResultMessage: ModelMessage = {
        role: "tool",
        content: execution.results.map((result) => ({
          type: "tool-result",
          toolCallId: result.providerToolCallId ?? result.toolCallId,
          toolName: result.toolName,
          output: sanitizeToolExecutionResultForModel(result, result.providerToolCallId ?? result.toolCallId),
        })),
      }
      const reconciliationReminder = reconciliationWatermark.takePendingReminder()
      if (reconciliationReminder) {
        appendNoticeToLastSuccessfulToolResult(toolResultMessage, {
          kind: "socrates_reconciliation",
          key: `evidence-${reconciliationReminder.evidenceTo}`,
          text: buildSocratesReconciliationNotice(reconciliationReminder),
        })
        await persistReconciliationWatermark()
      }
      toolOutputDispositions.recordBatch({
        message: toolResultMessage,
        toolCalls: operationalToolCalls,
        providerId: currentProviderId,
        modelId: currentModelId,
      })
      messages.push(toolResultMessage)
      const rejectedHandover = execution.results.find(
        (result) =>
          result.ok === false &&
          result.toolName === "handover_to_frontier" &&
          result.error?.code === "tool_approval_rejected",
      )
      if (rejectedHandover) {
        frontierHandoverRejected = true
      }
      const acceptedHandover = execution.results.find(
        (result) =>
          result.ok === true &&
          result.toolName === "handover_to_frontier" &&
          frontierHandoverToolOutputSchema.safeParse(result.output).success,
      )
      if (acceptedHandover && input.frontierModelSettings) {
        const parsedHandover = frontierHandoverToolOutputSchema.parse(acceptedHandover.output)
        const messagesAddedAfterPreparation = messages.slice(rawMessageCountAtPreparation)
        // Transfer the exact projection the driver model just saw, followed by
        // the approved handover exchange. This avoids rebuilding Frontier from
        // raw pre-compaction history or introducing a second handover summary.
        messages.splice(0, messages.length, ...preparedContext.messages, ...messagesAddedAfterPreparation)
        const fromProviderId = currentProviderId
        const fromModelId = currentModelId
        currentProviderId = input.frontierModelSettings.providerId
        currentModelId = input.frontierModelSettings.modelId
        currentRuntimeConfig = frontierRuntimeConfig(input.frontierModelSettings, currentRuntimeConfig)
        handedOverToFrontier = true
        yield {
          type: "agent.handover",
          toolCallId: acceptedHandover.toolCallId,
          stepIndex: step,
          fromProviderId,
          fromModelId,
          toProviderId: currentProviderId,
          toModelId: currentModelId,
          ...(parsedHandover.focus ? { focus: parsedHandover.focus } : {}),
        }
      }
      const nativeToolMessages = execution.results.flatMap((result) => nativeFollowUpMessagesForToolResult(result, input.workspacePath))
      messages.push(...nativeToolMessages)
      if (repeatedToolInputsThisStep.size > 0) {
        forceFinalNoTools = true
      }

      if (maxConfirmedToolErrorsPerTurn > 0 && confirmedToolErrors >= maxConfirmedToolErrorsPerTurn) {
        forceFinalNoTools = true
      } else if (usedToolCalls >= 50 || execution.budgetExhausted || usedToolCalls >= maxToolCallsPerTurn) {
        forceFinalNoTools = true
      }
    }
  }

}
