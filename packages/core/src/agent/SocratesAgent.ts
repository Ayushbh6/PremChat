import {
  frontierHandoverToolOutputSchema,
  normalizedToolCallSchema,
  waitToolOutputSchema,
  socratesFinalAnswerSchema,
  type SocratesFinalAnswer,
  type MemorySearchInput,
  type MemorySearchOutput,
  type ModelToolDefinition,
  type NormalizedToolCall,
  type ProviderId,
  type RuntimeConfig,
  type ResolvedTurnContext,
  type ResolvedTurnContextSeed,
  type ToolExecutionResult,
  type ToolName,
  type WaitToolOutput,
  type WorkerModelSettings,
} from "@socrates/contracts"
import { createId, SocratesError } from "@socrates/shared"
import type { ModelEvent, ModelMessage, ModelMessagePart, ModelProvider, TokenCountResult } from "@socrates/providers"
import {
  prepareContextForModelCall,
  precomputeContextSnapshot,
  type ContextCompactionLifecycleEvent,
  type ContextCompressionRuntime,
} from "../context/contextCompression"
import { ToolOutputDispositionLedger } from "../context/toolOutputDisposition"
import { buildSocratesSystemPrompt, type SocratesPromptContext } from "../prompts/socratesPrompt"
import { createDefaultToolRegistry, type ToolRegistry } from "../tools/registry"
import { createFinalAnswerToolRegistry } from "../tools/registry"
import type { ApprovalDecision, ApprovalRequest, CredentialInputDecision, CredentialInputRequest, ToolExecutors, ToolLifecycleEvent } from "../tools/types"
import {
  MemoryRouterAgent,
  type ActiveGoalCard,
  type MemoryRouterRunRecord,
} from "./MemoryRouterAgent"
import { AgentRuntime } from "./AgentRuntime"
import { buildSocratesFinalAnswerCheckpoint, buildSocratesReconciliationCheckpoint } from "../prompts/socratesFinalAnswerPrompt"
import { prepareTurnContext, renderResolvedTurnContext } from "./prepareTurnContext"
import { SocratesTurnLifecycle } from "./SocratesTurnLifecycle"
import { AsyncEventQueue } from "./AsyncEventQueue"
import {
  attachModelMetadata,
  escapeXmlAttribute,
  frontierRuntimeConfig,
  insertDynamicPromptContext,
  insertStableCachePrelude,
  isSameModelSelection,
  nativeFollowUpMessagesForToolResult,
} from "./socratesMemorySupport"
import {
  DOCS_PREFLIGHT_CHECKPOINT,
  ReconciliationVerificationLedger,
  TurnActionLedger,
  TurnDocsLedger,
  TurnMemorySaveLedger,
  interactiveTerminalAwaitingInput,
  isConfirmedToolErrorResult,
  memoryReviewRequiredError,
} from "./socratesTurnLedgers"
import {
  extractStreamingPreview,
  sanitizeToolExecutionResultForModel,
  stableToolInputKey,
} from "./socratesToolResultSupport"
import {
  ReconciliationWatermarkController,
  buildSocratesProgressReconciliationCheckpoint,
  type ReconciliationWatermarkState,
} from "./reconciliationWatermark"

export type SocratesAgentTurnInput = {
  projectId?: string
  conversationId?: string
  sessionId?: string
  cacheKey?: string
  turnId?: string
  providerId: ProviderId
  modelId: string
  runtimeConfig: RuntimeConfig
  memoryRouterModelSettings?: MemoryRouterModelSettings
  frontierModelSettings?: FrontierModelSettings
  messages: ModelMessage[]
  promptContext?: SocratesPromptContext
  systemPromptOverride?: string
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
  recordMemoryRouterRun?: (input: MemoryRouterRunRecord) => void | Promise<void>
  automaticMemorySearch?: (input: MemorySearchInput) => Promise<MemorySearchOutput>
  activeGoal?: ActiveGoalCard
  resolvedTurnContextSeed?: ResolvedTurnContextSeed
  completionMode: "main_structured" | "worker_text"
  contextCompression?: ContextCompressionRuntime
  maxToolCallsPerTurn?: number
  maxConfirmedToolErrorsPerTurn?: number
  maxParallelToolCalls?: number
  dynamicTools?: ModelToolDefinition[] | (() => ModelToolDefinition[])
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

export type MemoryRouterModelSettings = Pick<WorkerModelSettings, "providerId" | "authMode" | "modelId" | "thinkingEnabled" | "thinkingEffort">
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

export class SocratesAgent {
  private readonly memoryRouterAgent: MemoryRouterAgent
  private readonly runtime = new AgentRuntime()
  private readonly turnLifecycle: SocratesTurnLifecycle

  constructor(
    private readonly provider: ModelProvider,
    private readonly toolRegistry: ToolRegistry = createDefaultToolRegistry(),
  ) {
    this.memoryRouterAgent = new MemoryRouterAgent(provider)
    this.turnLifecycle = new SocratesTurnLifecycle(provider, toolRegistry, this.memoryRouterAgent)
  }

  async precomputeContext(input: SocratesAgentContextPrecomputeInput): Promise<ContextCompactionLifecycleEvent[]> {
    const system = buildSocratesSystemPrompt()
    const messages = [...input.messages]
    insertDynamicPromptContext(messages, input.promptContext)
    return precomputeContextSnapshot({
      provider: this.provider,
      providerId: input.providerId,
      modelId: input.modelId,
      runtimeConfig: input.runtimeConfig,
      system,
      messages,
      compression: input.contextCompression,
    })
  }

  async *streamTurn(input: SocratesAgentTurnInput): AsyncIterable<SocratesAgentEvent> {
    const system = input.systemPromptOverride ?? buildSocratesSystemPrompt()
    const messages: ModelMessage[] = [...input.messages]
    const toolOutputDispositions = new ToolOutputDispositionLedger(messages)
    const maxToolCallsPerTurn = input.maxToolCallsPerTurn ?? 80
    const maxConfirmedToolErrorsPerTurn = input.maxConfirmedToolErrorsPerTurn ?? 10
    const maxParallelToolCalls = input.maxParallelToolCalls ?? 5
    let usedToolCalls = 0
    let confirmedToolErrors = 0
    let forceFinalNoTools = false
    const duplicateTraceRetrieveResults = new Map<string, unknown>()
    const toolInputCounts = new Map<string, number>()
    const openRouterPreferredProvidersByModel = new Map<string, string>()
    const actionLedger = new TurnActionLedger()
    const docsLedger = new TurnDocsLedger()
    const memorySaveLedger = new TurnMemorySaveLedger()
    let totalToolCountNudgeSent = false
    let baselineInputTokens: number | undefined
    let currentTurnTokenSoftNudgeSent = false
    let currentTurnTokenHardStopSent = false
    let docsPreflightSent = false
    let docsSyncCheckpointSent = false
    let pendingInteractiveTerminalName: string | undefined
    let activeGoal: ActiveGoalCard | undefined = input.activeGoal
    let resolvedTurnContext: ResolvedTurnContext | undefined
    let finalCheckpointSent = false
    let accumulatedAnswerText = ""
    let currentProviderId = input.providerId
    let currentModelId = input.modelId
    let currentRuntimeConfig = input.runtimeConfig
    let handedOverToFrontier = isSameModelSelection(input.runtimeConfig, input.frontierModelSettings)
    let frontierHandoverRejected = false
    const reconciliationVerification = new ReconciliationVerificationLedger()
    const progressReconciliationEnabled = input.completionMode === "main_structured"
    const reconciliationNow = input.reconciliationClock ?? Date.now
    const reconciliationWatermark = new ReconciliationWatermarkController({
      ...(input.reconciliationWatermark ? { state: input.reconciliationWatermark } : {}),
      ...(input.taskStartedAt ? { startedAt: input.taskStartedAt } : {}),
      ...(input.reconciliationClock ? { now: input.reconciliationClock } : {}),
    })
    const persistReconciliationWatermark = async () => {
      await input.persistReconciliationWatermark?.(reconciliationWatermark.state())
    }
    let reconciliationReminderCount = 0
    let contextDispositionComplianceReminderCount = 0

    const preTurnMemoryLoop = await this.turnLifecycle.runPreTurnMemoryLoop(input, messages, docsLedger)
    activeGoal = preTurnMemoryLoop.activeGoal ?? activeGoal
    for (const event of preTurnMemoryLoop.events) {
      yield event
    }
    if (preTurnMemoryLoop.stableCachePreludeMessage) {
      insertStableCachePrelude(messages, preTurnMemoryLoop.stableCachePreludeMessage)
    }
    insertDynamicPromptContext(messages, input.promptContext)
    if (preTurnMemoryLoop.developerMessage) {
      messages.push({ role: "developer", content: preTurnMemoryLoop.developerMessage })
    }
    if (input.resolvedTurnContextSeed) {
      resolvedTurnContext = prepareTurnContext(input.resolvedTurnContextSeed, preTurnMemoryLoop.records)
      messages.push({ role: "developer", content: renderResolvedTurnContext(resolvedTurnContext) })
    }
    if (input.toolExecutors && input.workspacePath) {
      messages.push({
        role: "developer",
        content: `<runtime_terminal_capabilities>
Current runtime fact: the bash tool is a fully interactive, conversation-scoped PTY Terminal with operation="start", inputMode="user", plus live user input, and wait can suspend until completed or failed. This current capability contract overrides contradictory project memory, notes, prior chats, or known-pitfall text. Never tell the user interactive Terminal is unavailable. For an interactive Terminal request, perform the required docs preflight and then use bash operation="start", inputMode="user", with a portable Node.js or Python stdin program.
</runtime_terminal_capabilities>`,
      })
    }
    memorySaveLedger.recordMemoryLoopRecords(preTurnMemoryLoop.records ?? [])
    const preTurnMemoryLedgerMessage = memorySaveLedger.flushDeveloperMessage()
    if (preTurnMemoryLedgerMessage) {
      messages.push({ role: "developer", content: preTurnMemoryLedgerMessage })
    }

    for (let step = 0; ; step += 1) {
      const pendingProgressCheckpoint = !progressReconciliationEnabled || finalCheckpointSent
        ? undefined
        : reconciliationWatermark.beginPendingCheckpoint()
      if (pendingProgressCheckpoint) {
        reconciliationVerification.beginCheckpoint()
        reconciliationReminderCount = 0
        messages.push({
          role: "developer",
          content: buildSocratesProgressReconciliationCheckpoint(pendingProgressCheckpoint),
        })
        await persistReconciliationWatermark()
      }
      const dynamicTools = typeof input.dynamicTools === "function" ? input.dynamicTools() : input.dynamicTools
      const handoverAvailable = Boolean(
        input.completionMode === "main_structured" &&
          !finalCheckpointSent &&
          input.frontierModelSettings &&
          !handedOverToFrontier &&
          !frontierHandoverRejected,
      )
      const tools =
        forceFinalNoTools || !input.toolExecutors
          ? []
          : this.toolRegistry
              .modelDefinitions(dynamicTools)
              .filter((tool) => tool.name !== "handover_to_frontier" || handoverAvailable)
      if (forceFinalNoTools && input.completionMode === "main_structured") {
        const finalEvents: ModelEvent[] = []
        const result = await this.runtime.run({
          provider: this.provider,
          providerId: currentProviderId,
          modelId: currentModelId,
          runtimeConfig: currentRuntimeConfig,
          system,
          messages: [...messages, {
            role: "developer",
            content: buildSocratesFinalAnswerCheckpoint({
              ...(resolvedTurnContext ? { resolvedTurnContext } : {}),
              ...(activeGoal ? { activeGoal } : {}),
              ...(accumulatedAnswerText.trim() ? { proposedAnswer: accumulatedAnswerText } : {}),
            }),
          }],
          completion: { mode: "structured", schema: socratesFinalAnswerSchema },
          toolRegistry: createFinalAnswerToolRegistry(),
          toolExecutors: {},
          maxToolCalls: 0,
          projectId: input.projectId ?? "",
          conversationId: input.conversationId ?? "",
          sessionId: input.sessionId ?? "",
          turnId: input.turnId ?? "",
          workspacePath: input.workspacePath ?? "",
          ...(input.cacheKey ? { cacheKey: `${input.cacheKey}:main-final` } : {}),
          ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
          onModelEvent: (event) => finalEvents.push(event),
          createModelCall: (prepared) => input.createModelCall?.({
            providerId: currentProviderId,
            modelId: currentModelId,
            runtimeConfig: currentRuntimeConfig,
            messages: prepared.messages,
            estimatedTokens: prepared.estimatedTokens,
            tokenCount: prepared.tokenCount,
            tools: [],
            ...(input.promptContext ? { promptContext: input.promptContext } : {}),
          }),
        })
        const finalModelCallId = finalEvents.find((event) => event.modelCallId)?.modelCallId
        for (const event of finalEvents.filter((event) => event.type !== "model.completed")) {
          yield attachModelMetadata(event, event.modelCallId ?? finalModelCallId, step)
        }
        yield { type: "agent.final_result", result: result.output }
        for (const event of finalEvents.filter((event) => event.type === "model.completed")) {
          yield attachModelMetadata(event, event.modelCallId ?? finalModelCallId, step)
        }
        return
      }
      if (!docsPreflightSent && input.toolExecutors && input.workspacePath && tools.length > 0) {
        messages.push({ role: "developer", content: DOCS_PREFLIGHT_CHECKPOINT })
        docsPreflightSent = true
      }
      const compactionStartedEvents = new AsyncEventQueue<ContextCompactionLifecycleEvent>()
      const preparedContextPromise = (async () => {
        try {
          return await prepareContextForModelCall({
            provider: this.provider,
            providerId: currentProviderId,
            modelId: currentModelId,
            runtimeConfig: currentRuntimeConfig,
            system,
            messages,
            tools,
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
      for (const event of preparedContext.compactionEvents) {
        yield event
        if (event.type === "context.compaction.failed") {
          throw event.error
        }
      }
      if (progressReconciliationEnabled && !finalCheckpointSent && preparedContext.compactionEvents.some((event) => event.type === "context.compaction.completed")) {
        reconciliationWatermark.markCompactionBoundary()
        await persistReconciliationWatermark()
        if (!reconciliationWatermark.activeCheckpoint() && reconciliationWatermark.beginPendingCheckpoint()) {
          reconciliationVerification.beginCheckpoint()
          messages.push({
            role: "developer",
            content: buildSocratesProgressReconciliationCheckpoint(reconciliationWatermark.activeCheckpoint()!),
          })
          await persistReconciliationWatermark()
          continue
        }
      }
      if (input.abortSignal?.aborted) {
        return
      }
      baselineInputTokens ??= preparedContext.estimatedTokens
      const currentTurnTokenGrowth = Math.max(0, preparedContext.estimatedTokens - baselineInputTokens)
      if (!forceFinalNoTools && tools.length > 0 && currentTurnTokenGrowth >= 80_000 && !currentTurnTokenHardStopSent) {
        messages.push({
          role: "developer",
          content:
            "Runtime anti-spiral guard: current-turn context growth is above 80k estimated tokens. Do not call more tools. Give a concise status/final answer from the evidence already gathered, mention uncertainty, and ask the user to refine or continue if more investigation is needed.",
        })
        forceFinalNoTools = true
        currentTurnTokenHardStopSent = true
        continue
      }
      if (!forceFinalNoTools && tools.length > 0 && currentTurnTokenGrowth >= 50_000 && !currentTurnTokenSoftNudgeSent) {
        messages.push({
          role: "developer",
          content:
            "Runtime efficiency warning: current-turn context growth is above 50k estimated tokens. Stop repeating investigation. Use the action ledger and answer unless one specific missing fact is essential.",
        })
        currentTurnTokenSoftNudgeSent = true
        continue
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
      const toolRunIds = new Map<string, string>()
      let stepText = ""
      // The first no-tool answer is a proposed draft. Hold its user-visible
      // deltas through same-Socrates reconciliation and structured finalization.
      const suppressAnswerDeltas = input.completionMode === "main_structured"
        || docsLedger.requiresProjectMemoryReview()
      const suppressCheckpointReasoning = input.completionMode === "main_structured" && finalCheckpointSent
      const handoverToolExposed = tools.some((tool) => tool.name === "handover_to_frontier")
      const bufferAnswerForPotentialHandover = handoverToolExposed && !suppressAnswerDeltas
      const bufferedAnswerEvents: ModelEvent[] = []
      const bufferedCompletionEvents: ModelEvent[] = []
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
        if (
          suppressCheckpointReasoning &&
          (modelEvent.type === "model.reasoning.delta" || modelEvent.type === "model.reasoning.completed")
        ) {
          continue
        }

        if (modelEvent.type === "model.tool_call.streaming") {
          const tool = this.toolRegistry.get(modelEvent.toolName as ToolName)
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
          const parsed = normalizedToolCallSchema.safeParse(modelEvent.toolCall)
          if (parsed.success) {
            if (parsed.data.toolName !== "context_disposition") {
              const inputKey = stableToolInputKey(parsed.data.toolName, parsed.data.input)
              const nextCount = (toolInputCounts.get(inputKey) ?? 0) + 1
              toolInputCounts.set(inputKey, nextCount)
              if (nextCount >= 3) {
                repeatedToolInputsThisStep.add(`${parsed.data.toolName} ${JSON.stringify(parsed.data.input)}`)
              }
            }
            toolCalls.push({
              ...parsed.data,
              toolCallId: toolRunIdFor(parsed.data.toolCallId),
              providerToolCallId: parsed.data.toolCallId,
            })
          }
        }

        if (bufferAnswerForPotentialHandover && modelEvent.type === "model.completed") {
          bufferedCompletionEvents.push(attachModelMetadata(modelEvent, modelCallId, step))
          continue
        }

        yield attachModelMetadata(modelEvent, modelCallId, step)
      }

      const pendingDispositionResults = toolOutputDispositions.pendingResults()
      const hasFunctionalToolCall = toolCalls.some((toolCall) => toolCall.toolName !== "context_disposition")
      const hasContextDispositionCall = toolCalls.some((toolCall) => toolCall.toolName === "context_disposition")
      if (pendingDispositionResults.length > 0 && hasFunctionalToolCall && !hasContextDispositionCall) {
        if (contextDispositionComplianceReminderCount >= 2) {
          // A provider that repeatedly ignores the control contract must not
          // deadlock the task. Conservatively retain the visible results exact
          // and record that decision through the normal auditable tool path.
          // This fallback makes no semantic release/distillation judgment.
          const providerToolCallId = createId("tcall")
          toolCalls.unshift({
            toolCallId: toolRunIdFor(providerToolCallId),
            providerToolCallId,
            toolName: "context_disposition",
            input: {
              decisions: pendingDispositionResults.slice(0, 8).map((result) => ({ result, action: "keep_exact" as const })),
            },
          })
          contextDispositionComplianceReminderCount = 0
        } else {
          contextDispositionComplianceReminderCount += 1
          messages.push({
            role: "developer",
            content: [
              "The previous proposed functional tool calls were not executed because they omitted the required same-response context_disposition call.",
              `Before retrying those functional calls, classify the visible pending results (${pendingDispositionResults.slice(0, 8).join(", ")}) with one context_disposition call in the same response.`,
              "This is a model judgment: choose keep_exact, distill, release, or unresolved for each result you classify. Do not call context_disposition alone.",
              ...(contextDispositionComplianceReminderCount >= 2
                ? ["This is the second compliance reminder. Include the context_disposition call now; one more omission will use the safe keep-exact fallback so the task can continue."]
                : []),
            ].join("\n"),
          })
          continue
        }
      }
      if (hasContextDispositionCall) {
        contextDispositionComplianceReminderCount = 0
      }

      const requestedHandover = toolCalls.find((toolCall) => toolCall.toolName === "handover_to_frontier")
      if (!requestedHandover && !reconciliationWatermark.activeCheckpoint()) {
        accumulatedAnswerText += stepText
        for (const event of bufferedAnswerEvents) {
          yield event
        }
      }
      for (const event of bufferedCompletionEvents) {
        yield event
      }

      if (toolCalls.length === 0 && docsLedger.requiresProjectMemoryReview()) {
        if (!input.toolExecutors || tools.length === 0) {
          throw memoryReviewRequiredError()
        }
        // This is deterministic runtime bookkeeping, not a judgment call. Some
        // providers repeatedly attempt a final answer instead of following the
        // reminder, which used to turn a healthy interactive Terminal into a
        // failed turn. Execute the bounded required read through the normal tool
        // lifecycle so it remains visible, auditable, and available to the model.
        const providerToolCallId = createId("tcall")
        toolCalls.push({
          toolCallId: toolRunIdFor(providerToolCallId),
          providerToolCallId,
          toolName: "project_docs",
          input: { operation: "read", area: "memory", charLimit: 10_000 },
        })
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

      if (toolCalls.length === 0 && reconciliationWatermark.activeCheckpoint()) {
        if (reconciliationVerification.hasPending()) {
          if (reconciliationReminderCount >= 2) {
            throw new SocratesError("memory_reconciliation_incomplete", `Required .socrates progress reconciliation was not verified: ${reconciliationVerification.pendingSummary()}`, { recoverable: true })
          }
          reconciliationReminderCount += 1
          messages.push({
            role: "developer",
            content: `Progress checkpoint cannot close until the required .socrates reconciliation is verified. Pending: ${reconciliationVerification.pendingSummary()}. Read the changed target again, then continue the same task without answering.`,
          })
          continue
        }
        reconciliationWatermark.completeCheckpoint()
        await persistReconciliationWatermark()
        reconciliationReminderCount = 0
        continue
      }

      if (toolCalls.length === 0 && input.completionMode === "main_structured" && !finalCheckpointSent) {
        finalCheckpointSent = true
        reconciliationVerification.beginCheckpoint()
        messages.push({
          role: "developer",
          content: buildSocratesReconciliationCheckpoint({
            ...(resolvedTurnContext ? { resolvedTurnContext } : {}),
            ...(activeGoal ? { activeGoal } : {}),
            ...((stepText || accumulatedAnswerText).trim() ? { proposedAnswer: stepText || accumulatedAnswerText } : {}),
          }),
        })
        continue
      }

      if (toolCalls.length === 0 && finalCheckpointSent && reconciliationVerification.hasPending()) {
        if (reconciliationReminderCount >= 2) {
          throw new SocratesError("memory_reconciliation_incomplete", `Required .socrates reconciliation was not verified: ${reconciliationVerification.pendingSummary()}`, { recoverable: true })
        }
        reconciliationReminderCount += 1
        messages.push({
          role: "developer",
          content: `Final answer is blocked until the required .socrates reconciliation is completed and verified. Pending: ${reconciliationVerification.pendingSummary()}. Read the current target, apply the exact update, then read that same section again after the mutation.`,
        })
        continue
      }

      if (toolCalls.length === 0 && input.completionMode === "main_structured") {
        reconciliationWatermark.completeFinalCheckpoint()
        await persistReconciliationWatermark()
        forceFinalNoTools = true
        continue
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
        docsLedger,
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
      messages.push(toolResultMessage)
      const rejectedHandover = execution.results.find(
        (result) =>
          result.ok === false &&
          result.toolName === "handover_to_frontier" &&
          result.error?.code === "tool_approval_rejected",
      )
      if (rejectedHandover) {
        frontierHandoverRejected = true
        messages.push({
          role: "developer",
          content: `<frontier_handover status="rejected">
The user declined the Frontier handover. The handover tool is unavailable for the rest of this turn. Do not request it again. Continue and complete the task yourself using the work and evidence already gathered.
</frontier_handover>`,
        })
      }
      const acceptedHandover = execution.results.find(
        (result) =>
          result.ok === true &&
          result.toolName === "handover_to_frontier" &&
          frontierHandoverToolOutputSchema.safeParse(result.output).success,
      )
      if (acceptedHandover && input.frontierModelSettings) {
        const parsedHandover = frontierHandoverToolOutputSchema.parse(acceptedHandover.output)
        const fromProviderId = currentProviderId
        const fromModelId = currentModelId
        currentProviderId = input.frontierModelSettings.providerId
        currentModelId = input.frontierModelSettings.modelId
        currentRuntimeConfig = frontierRuntimeConfig(input.frontierModelSettings, currentRuntimeConfig)
        handedOverToFrontier = true
        messages.push({
          role: "developer",
          content: `<frontier_handover${parsedHandover.focus ? ` focus="${escapeXmlAttribute(parsedHandover.focus)}"` : ""}>
You are Frontier and now own this task for the rest of the current turn. Continue from the complete conversation and tool history above; do not restart or repeat completed work. The prior model's provisional answer was discarded. Treat all gathered evidence and tool results as authoritative, perform any remaining work, and give the sole final user answer. You cannot hand this task back.
</frontier_handover>`,
        })
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
      docsLedger.recordBatch({ toolCalls: operationalToolCalls, results: operationalResults })
      reconciliationVerification.recordBatch(operationalToolCalls, operationalResults)
      const ledgerUpdate = actionLedger.recordBatch({
        toolCalls: operationalToolCalls,
        results: operationalResults,
        estimatedTokens: preparedContext.estimatedTokens,
        currentTurnTokenGrowth,
      })
      messages.push({ role: "developer", content: ledgerUpdate.summary })
      for (const warning of ledgerUpdate.warnings) {
        messages.push({ role: "developer", content: warning })
      }
      memorySaveLedger.recordBatch({ toolCalls: operationalToolCalls, results: operationalResults })
      const memoryLedgerMessage = memorySaveLedger.flushDeveloperMessage()
      if (memoryLedgerMessage) {
        messages.push({ role: "developer", content: memoryLedgerMessage })
      }
      if (!docsSyncCheckpointSent) {
        const checkpoint = docsLedger.buildSyncCheckpoint()
        if (checkpoint) {
          messages.push({ role: "developer", content: checkpoint })
          docsSyncCheckpointSent = true
        }
      }
      if (repeatedToolInputsThisStep.size > 0) {
        messages.push({
          role: "user",
          content: `You have repeated the same exact tool call input at least 3 times this turn (${[...repeatedToolInputsThisStep].slice(0, 3).join("; ")}). Stop repeating identical calls. Either answer from the evidence already gathered, inspect a different target, or ask the user for more information.`,
        })
      }
      toolOutputDispositions.recordBatch({
        message: toolResultMessage,
        providerId: currentProviderId,
        modelId: currentModelId,
      })
      if (!totalToolCountNudgeSent && usedToolCalls >= 50) {
        messages.push({
          role: "user",
          content:
            "You have made 50 or more tool calls in this turn. Before using more tools, decide whether you already have enough evidence to answer. If not, ask the user to continue or state the specific missing evidence.",
        })
        totalToolCountNudgeSent = true
      }

      if (maxConfirmedToolErrorsPerTurn > 0 && confirmedToolErrors >= maxConfirmedToolErrorsPerTurn) {
        const recentCodes = [...new Set(confirmedToolErrorResults.map((result) => result.error?.code).filter(Boolean))]
        messages.push({
          role: "user",
          content: `There have been ${confirmedToolErrors} confirmed tool-call execution errors this turn${recentCodes.length > 0 ? ` (latest codes: ${recentCodes.join(", ")})` : ""}. Do not call more tools. Give the best final answer from the evidence already available, and mention any remaining uncertainty or the exact tool-error blocker.`,
        })
        forceFinalNoTools = true
      } else if (ledgerUpdate.forceFinalReason) {
        messages.push({
          role: "developer",
          content: `Runtime anti-spiral guard: ${ledgerUpdate.forceFinalReason} Do not call more tools. Give a concise status/final answer from the evidence already available, mention uncertainty, and ask the user to refine or continue if more investigation is needed.`,
        })
        forceFinalNoTools = true
      } else if (execution.budgetExhausted || usedToolCalls >= maxToolCallsPerTurn) {
        messages.push({
          role: "user",
          content:
            "The per-turn tool-call budget has been exhausted. Do not call more tools. Give the best final answer from the evidence already available, and mention any remaining uncertainty.",
        })
        forceFinalNoTools = true
      }
    }
  }

}
