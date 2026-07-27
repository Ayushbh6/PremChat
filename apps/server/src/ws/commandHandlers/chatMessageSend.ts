import type { WebSocket } from "ws"
import {
  DEFAULT_CONTEXT_COMPRESSION_THRESHOLDS,
  createResolvedTurnContextSeed,
  findModelOption,
  type SocratesAgent,
  type SocratesAgentEvent,
} from "@socrates/core"
import type { ClientCommand, RuntimeConfig, SocratesFinalAnswer } from "@socrates/contracts"
import type { McpRuntime } from "@socrates/mcp"
import type { ModelMessage, ModelProvider, ModelUsage } from "@socrates/providers"
import { normalizeError, nowIso, SocratesError } from "@socrates/shared"
import {
  listWorkspaceEnvKeyCandidates,
  readWorkspaceEnvValue,
} from "@socrates/workspace"
import { apiError } from "../../http"
import { generateConversationTitle } from "../../services/conversationTitleGenerator"
import type { SocratesStore } from "../../services/store"
import type { ActiveTurns } from "../activeTurns"
import type { ConversationTerminalManager } from "../conversationTerminals"
import type { ConversationSubscriptions } from "../conversationSubscriptions"
import { appendAndEmit, makeEvent, type EventSink } from "../eventSender"
import type { V2FlowStore } from "../../services/v2/flowStore"
import { routeClassicGoal } from "../classicGoalRoutingCoordinator"
import { createClassicToolExecutors } from "../classicToolExecutors"
import {
  createClassicContextCompressionRuntime,
  sendClassicContextCompactionEvent,
  sendClassicContextUsageSnapshot,
} from "../classicContextRuntime"
import {
  ensureParagraphBoundary,
  isBashOutput,
  isEditOutput,
  providerCacheKey,
  toContractUsage,
  toStoredUsage,
  withLateDeveloperContext,
} from "../classicMessageSupport"

const requireCommandScope = (command: ClientCommand): { projectId: string; conversationId: string } => {
  if (!command.projectId || !command.conversationId) {
    throw new SocratesError("missing_command_scope", "projectId and conversationId are required for this command")
  }
  return { projectId: command.projectId, conversationId: command.conversationId }
}

const contextBudgetTokens = DEFAULT_CONTEXT_COMPRESSION_THRESHOLDS.hardLimitTokens

type TerminalTaskContinuation = {
  projectId: string
  conversationId: string
  sessionId: string
  turnId: string
  runtimeConfigId: string
  runtimeConfig: RuntimeConfig
  wakeContext: string
}

export const handleChatMessageSend = async (
  socket: WebSocket | undefined,
  store: SocratesStore,
  agent: SocratesAgent,
  activeTurns: ActiveTurns,
  terminals: ConversationTerminalManager,
  subscriptions: ConversationSubscriptions,
  command: Extract<ClientCommand, { type: "chat.message.send" }> | undefined,
  mcpRuntime?: McpRuntime,
  titleProvider?: ModelProvider,
  continuation?: TerminalTaskContinuation,
  flowStore?: V2FlowStore,
): Promise<void> => {
  if (!command && !continuation) {
    throw new SocratesError("missing_chat_command", "A chat message or continuation is required.")
  }
  const { projectId, conversationId } = continuation ?? requireCommandScope(command as Extract<ClientCommand, { type: "chat.message.send" }>)
  await store.refreshAvailableModels()
  const runtimeConfig = continuation?.runtimeConfig ?? store.resolveRuntimeConfig((command as Extract<ClientCommand, { type: "chat.message.send" }>).payload.runtimeConfig)
  const payload = command ? { ...command.payload, runtimeConfig } : undefined
  if (socket) {
    subscriptions.subscribe(socket, conversationId)
  }
  const emitEvent: EventSink = (event) => subscriptions.emit(event, socket)
  const created = continuation
    ? {
        sessionId: continuation.sessionId,
        turnId: continuation.turnId,
        runtimeConfigId: continuation.runtimeConfigId,
        userMessage: undefined,
        shouldGenerateTitle: false,
        fallbackTitle: "",
      }
    : store.createTurnFromUserMessage(projectId, conversationId, payload as NonNullable<typeof payload>)
  if (!continuation) {
    store.startAgentTask({ projectId, conversationId, sessionId: created.sessionId, turnId: created.turnId, runtimeConfig })
  }
  const abortController = activeTurns.create(created.turnId)

  if (!continuation && created.userMessage) {
    emitEvent(
      makeEvent(
        "turn.started",
        {
          turnId: created.turnId,
          userMessage: created.userMessage,
        },
        {
          projectId,
          conversationId,
          sessionId: created.sessionId,
          turnId: created.turnId,
          actor: { type: "main_agent" },
        },
      ),
    )
  }

  if (created.shouldGenerateTitle) {
    const placeholderConversation = store.getConversation(projectId, conversationId).conversation
    appendAndEmit(
      emitEvent,
      store,
      makeEvent(
        "conversation.updated",
        { conversation: placeholderConversation },
        {
          projectId,
          conversationId,
          sessionId: created.sessionId,
          turnId: created.turnId,
          actor: { type: "system" },
        },
      ),
      "server",
    )
  }

  if (created.shouldGenerateTitle && titleProvider && created.userMessage) {
    const titleUsageSourceId = `title_${created.turnId}`
    const titleStartedAt = nowIso()
    void generateConversationTitle({
      provider: titleProvider,
      projectId,
      conversationId,
      sessionId: created.sessionId,
      turnId: created.turnId,
      workspacePath: store.getPrimaryWorkspacePath(projectId),
      message: created.userMessage,
      fallbackTitle: created.fallbackTitle,
      modelSettings: store.getWorkerModelSetting("title_generator"),
      abortSignal: abortController.signal,
    })
      .then((result) => {
        if (result?.usage) {
          store.recordConversationTitleUsage({
            projectId,
            conversationId,
            sessionId: created.sessionId,
            turnId: created.turnId,
            sourceId: titleUsageSourceId,
            providerId: result.providerId,
            modelId: result.modelId,
            status: "completed",
            startedAt: titleStartedAt,
            completedAt: nowIso(),
            usage: toStoredUsage(result.usage),
          })
        }
        const title = result?.title.trim()
        if (!title || title === created.fallbackTitle) {
          return
        }
        const conversation = store.autoTitleConversation(projectId, conversationId, title, created.fallbackTitle)
        if (!conversation) {
          return
        }
        appendAndEmit(
          emitEvent,
          store,
          makeEvent(
            "conversation.updated",
            { conversation },
            {
              projectId,
              conversationId,
              sessionId: created.sessionId,
              turnId: created.turnId,
              actor: { type: "system" },
            },
          ),
          "server",
        )
      })
      .catch(() => undefined)
  }

  const selectedModel =
    store.findAvailableModelOption(runtimeConfig.providerId, runtimeConfig.modelId, runtimeConfig.authMode ?? "api_key") ??
    findModelOption(runtimeConfig.providerId, runtimeConfig.modelId, runtimeConfig.authMode ?? "api_key")
  const includeImageParts = selectedModel?.capabilities?.vision === true
  const history = store.getConversationModelMessages(projectId, conversationId, { includeImageParts })
  const workspacePath = store.getPrimaryWorkspacePath(projectId)
  const terminalContext = store.terminalContextBrief(conversationId)
  let modelHistory: ModelMessage[] = withLateDeveloperContext(history, terminalContext, continuation?.wakeContext)
  const stableCachePreludeSnapshot = store.loadStableCachePreludeSnapshot(projectId, workspacePath)
  const promptContext = {
    ...store.getAgentContext(projectId),
  }
  const configuredFrontier = store.getWorkerModelSetting("frontier")
  const frontierModelSettings = store.resolveModelSettings(configuredFrontier, "frontier").effective
  const modelCallIds: string[] = []
  const latestUsageByModelCallId = new Map<string, ModelUsage>()
  const responseMetadataByModelCallId = new Map<string, unknown>()
  let latestModelCallId: string | undefined

  let answerText = ""
  let reasoningText = ""
  let finalResult: SocratesFinalAnswer | undefined
  let latestUsage: ModelUsage | undefined
  let lastAnswerModelCallId: string | undefined
  let suspended = false
  let durableTurnCommitted = false
  let suspendedWait: Extract<SocratesAgentEvent, { type: "agent.suspended" }>["wait"] | undefined
  const exposedMcpServers = new Set<string>()
  let activeGoal = continuation && flowStore ? flowStore.getClassicGoalForTurn(created.turnId) : undefined

  try {
    if (!continuation && flowStore && created.userMessage) {
      activeGoal = await routeClassicGoal({
        projectId,
        conversationId,
        sessionId: created.sessionId,
        turnId: created.turnId,
        runtimeConfigId: created.runtimeConfigId,
        userMessageId: created.userMessage.id,
        userMessage: created.userMessage.content,
        workspacePath,
        recentMessages: modelHistory,
        flowStore,
        sharedStore: store,
        ...(titleProvider ? { provider: titleProvider } : {}),
      })
      store.indexGoalRetrieval(projectId, activeGoal.goalId)
    }
    if (continuation && flowStore && !activeGoal) {
      throw new SocratesError("classic_goal_link_missing", "The continued task no longer has a goal link.", { recoverable: true })
    }
    if (activeGoal) {
      modelHistory = await store.prepareBoundedGoalHistory({
        projectId,
        goalId: activeGoal.goalId,
        query: activeGoal.taskRequest ?? activeGoal.title,
        messages: modelHistory,
      })
    }
    const reconciliationWatermark = activeGoal
      ? store.getTaskReconciliationWatermark("classic", created.turnId)
      : undefined
    for await (const agentEvent of agent.streamTurn({
      projectId,
      conversationId,
      sessionId: created.sessionId,
      turnId: created.turnId,
      providerId: runtimeConfig.providerId,
      modelId: runtimeConfig.modelId,
      runtimeConfig,
      memoryRouterModelSettings: store.getWorkerModelSetting("memory_router"),
      ...(frontierModelSettings ? { frontierModelSettings } : {}),
      cacheKey: providerCacheKey(projectId, conversationId),
      messages: modelHistory,
      promptContext,
      workspacePath,
      stableCachePreludeSnapshot,
      completionMode: "main_structured",
      ...(reconciliationWatermark ? {
        reconciliationWatermark: reconciliationWatermark.state,
        taskStartedAt: reconciliationWatermark.taskStartedAt,
        persistReconciliationWatermark: (state) => store.saveTaskReconciliationWatermark("classic", created.turnId, state),
      } : {}),
      automaticMemorySearch: (input) => store.searchMemory(projectId, input, true),
      ...(activeGoal ? { activeGoal } : {}),
      ...(activeGoal ? {
        resolvedTurnContextSeed: createResolvedTurnContextSeed({
          presentation: { kind: "classic", aperture: "selected_conversation" },
          projectName: promptContext.projectName,
          ...(promptContext.projectDescription ? { projectDescription: promptContext.projectDescription } : {}),
          goal: activeGoal,
          messages: modelHistory,
        }),
      } : {}),
      toolExecutors: createClassicToolExecutors(store, projectId, created.turnId, activeTurns, terminals, mcpRuntime, {
        exposeMcpServer: (serverId) => exposedMcpServers.add(serverId),
        ...(activeGoal ? { goalId: activeGoal.goalId } : {}),
      }),
      runtimeCapabilities: () =>
        mcpRuntime ? [...exposedMcpServers].flatMap((serverId) => mcpRuntime.getDynamicCapabilityDefinitions(serverId, { workspacePath })) : [],
      contextCompression: createClassicContextCompressionRuntime(store, projectId, conversationId, created.sessionId, created.turnId),
      maxParallelToolCalls: 5,
      maxToolCallsPerTurn: 80,
      createModelCall: (modelRequest) => {
        const modelCallId = store.createModelCall({
          conversationId,
          sessionId: created.sessionId,
          turnId: created.turnId,
          runtimeConfigId: created.runtimeConfigId,
          providerId: modelRequest.providerId,
          modelId: modelRequest.modelId,
          request: {
            providerId: modelRequest.providerId,
            modelId: modelRequest.modelId,
            estimatedTokens: modelRequest.estimatedTokens,
            contextBudgetTokens,
            tokenCount: modelRequest.tokenCount,
            messages: modelRequest.messages,
            promptContext: modelRequest.promptContext,
            runtimeConfig: modelRequest.runtimeConfig,
            tools: modelRequest.tools.map((tool) => tool.name),
            stablePrelude: {
              source: "backend_snapshot",
              cacheHit: stableCachePreludeSnapshot.cacheHit === true,
            },
          },
        })
        modelCallIds.push(modelCallId)
        latestModelCallId = modelCallId
        const model =
          store.findAvailableModelOption(modelRequest.providerId, modelRequest.modelId, modelRequest.runtimeConfig.authMode ?? "api_key") ??
          findModelOption(modelRequest.providerId, modelRequest.modelId, modelRequest.runtimeConfig.authMode ?? "api_key")
        if (model?.contextWindowTokens) {
          sendClassicContextUsageSnapshot(emitEvent, store, {
            projectId,
            conversationId,
            sessionId: created.sessionId,
            turnId: created.turnId,
            modelCallId,
            providerId: modelRequest.providerId,
            modelId: modelRequest.modelId,
            contextWindowTokens: Math.min(model.contextWindowTokens, contextBudgetTokens),
            contextUsedTokens: modelRequest.estimatedTokens,
            metadata: {
              source: "model_context_estimate",
              tokenCount: modelRequest.tokenCount,
            },
          })
        }
        return modelCallId
      },
      requestApproval: async (request) => {
        const approvalId = store.createApproval({
          approvalId: request.approvalId,
          conversationId,
          sessionId: created.sessionId,
          turnId: created.turnId,
          toolCallId: request.toolCallId,
          actionKind: request.actionKind,
          action: request,
        })
        store.attachToolApproval(request.toolCallId, approvalId)
        const event = makeEvent(
          "approval.requested",
          {
            approvalId,
            toolCallId: request.toolCallId,
            providerToolCallId: request.providerToolCallId,
            actionKind: request.actionKind,
            title: request.title,
            description: request.description,
            actionPreview: request.actionPreview,
            risk: request.risk,
          },
          {
            projectId,
            conversationId,
            sessionId: created.sessionId,
            turnId: created.turnId,
            actor: { type: "system" },
          },
        )
        appendAndEmit(emitEvent, store, event, "server")
        return activeTurns.waitForApproval(created.turnId, approvalId, abortController.signal)
      },
      requestCredentialInput: async (request) => {
        if (request.source === "workspace_env") {
          const candidate = listWorkspaceEnvKeyCandidates(workspacePath, request.envKey).find((item) => item.hasKey)
          if (candidate) {
            const value = readWorkspaceEnvValue(workspacePath, candidate.fileName, request.envKey)
            if (value) {
              return { decision: "submitted" as const, value, source: "workspace_env" as const }
            }
          }
        }

        const effectiveSource = "user_input" as const
        const event = makeEvent(
          "credential.input.requested",
          {
            credentialRequestId: request.credentialRequestId,
            toolCallId: request.toolCallId,
            serverId: request.serverId,
            ...(request.serverLabel ? { serverLabel: request.serverLabel } : {}),
            envKey: request.envKey,
            source: effectiveSource,
          },
          {
            projectId,
            conversationId,
            sessionId: created.sessionId,
            turnId: created.turnId,
            actor: { type: "system" },
          },
        )
        appendAndEmit(emitEvent, store, event, "server")
        const decision = await activeTurns.waitForCredentialInput(
          created.turnId,
          request.credentialRequestId,
          effectiveSource,
          abortController.signal,
        )
        appendAndEmit(
          emitEvent,
          store,
          makeEvent(
            "credential.input.resolved",
            {
              credentialRequestId: request.credentialRequestId,
              toolCallId: request.toolCallId,
              decision: decision.decision,
            },
            {
              projectId,
              conversationId,
              sessionId: created.sessionId,
              turnId: created.turnId,
              actor: { type: "system" },
            },
          ),
          "server",
        )
        return decision
      },
      recordMemoryRouterRun: async (run) => {
        const errorId = run.error
          ? store.recordError({
              conversationId,
              sessionId: created.sessionId,
              turnId: created.turnId,
              source: "memory_router",
              code: run.error.code,
              message: run.error.message,
              details: { phase: run.phase, modelId: run.modelId, routerDetails: run.error.details },
              recoverable: run.error.recoverable,
            })
          : undefined
        for (const [index, usage] of run.usages.entries()) {
          store.recordMemoryRouterUsage({
            projectId,
            conversationId,
            sessionId: created.sessionId,
            turnId: created.turnId,
            sourceId: `${created.turnId}:memory_router:${run.phase}:${index + 1}`,
            providerId: run.providerId,
            modelId: run.modelId,
            status: run.status,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
            usage: toStoredUsage(usage),
            metadata: {
              phase: run.phase,
              ...(errorId ? { errorId } : {}),
              ...(run.error ? { errorCode: run.error.code } : {}),
            },
          })
        }
      },
      abortSignal: abortController.signal,
    })) {
      if (agentEvent.type === "agent.suspended") {
        suspended = true
        suspendedWait = agentEvent.wait
        break
      }
      if (agentEvent.type === "agent.handover") {
        appendAndEmit(
          emitEvent,
          store,
          makeEvent(
            "agent.model.handover",
            {
              toolCallId: agentEvent.toolCallId,
              stepIndex: agentEvent.stepIndex,
              fromProviderId: agentEvent.fromProviderId,
              fromModelId: agentEvent.fromModelId,
              toProviderId: agentEvent.toProviderId,
              toModelId: agentEvent.toModelId,
              ...(agentEvent.focus ? { focus: agentEvent.focus } : {}),
            },
            {
              projectId,
              conversationId,
              sessionId: created.sessionId,
              turnId: created.turnId,
              actor: { type: "system", label: "Frontier handover" },
            },
          ),
          "core",
        )
        continue
      }
      if (
        agentEvent.type === "context.compaction.started" ||
        agentEvent.type === "context.compaction.completed" ||
        agentEvent.type === "context.compaction.failed"
      ) {
        sendClassicContextCompactionEvent(emitEvent, store, agentEvent, {
          projectId,
          conversationId,
          sessionId: created.sessionId,
          turnId: created.turnId,
        })
        continue
      }

      if (abortController.signal.aborted) {
        return
      }

      if (agentEvent.type === "model.started") {
        latestModelCallId = agentEvent.modelCallId ?? latestModelCallId
      }

      if (agentEvent.type === "model.reasoning.delta") {
        const modelCallId = agentEvent.modelCallId ?? latestModelCallId
        reasoningText += agentEvent.text
        if (!modelCallId) {
          continue
        }
        store.appendModelStreamChunk({
          modelCallId,
          turnId: created.turnId,
          channel: "reasoning",
          text: agentEvent.text,
        })
        const event = makeEvent(
          "agent.thinking.delta",
          { text: agentEvent.text, modelCallId, stepIndex: agentEvent.stepIndex },
          {
            projectId,
            conversationId,
            sessionId: created.sessionId,
            turnId: created.turnId,
            actor: { type: "main_agent" },
          },
        )
        appendAndEmit(emitEvent, store, event, "core")
      }

      if (agentEvent.type === "agent.final_result") {
        finalResult = agentEvent.result
      } else if (agentEvent.type === "model.answer.delta") {
        const modelCallId = agentEvent.modelCallId ?? latestModelCallId
        if (!modelCallId) {
          continue
        }
        const separator =
          lastAnswerModelCallId && lastAnswerModelCallId !== modelCallId && answerText.trim().length > 0
            ? ensureParagraphBoundary(answerText)
            : ""
        const text = `${separator}${agentEvent.text}`
        answerText += text
        lastAnswerModelCallId = modelCallId
        store.appendModelStreamChunk({
          modelCallId,
          turnId: created.turnId,
          channel: "answer",
          text,
        })
      }

      if (agentEvent.type === "model.usage") {
        latestUsage = agentEvent.usage
        const modelCallId = agentEvent.modelCallId ?? latestModelCallId
        if (modelCallId) {
          latestUsageByModelCallId.set(modelCallId, agentEvent.usage)
        }
      }

      if (agentEvent.type === "model.completed") {
        latestUsage = agentEvent.usage ?? latestUsage
        const modelCallId = agentEvent.modelCallId ?? latestModelCallId
        if (modelCallId) {
          if (agentEvent.usage) {
            latestUsageByModelCallId.set(modelCallId, agentEvent.usage)
          }
        }
      }

      if (agentEvent.type === "model.response.metadata") {
        const modelCallId = agentEvent.modelCallId ?? latestModelCallId
        if (modelCallId) {
          responseMetadataByModelCallId.set(modelCallId, agentEvent.response)
        }
      }

      if (agentEvent.type === "model.failed") {
        throw agentEvent.error
      }

      if (agentEvent.type === "tool.call.started") {
        const toolModelCallId = agentEvent.modelCallId ?? latestModelCallId
        store.createToolCall({
          toolCallId: agentEvent.toolCallId,
          conversationId,
          sessionId: created.sessionId,
          turnId: created.turnId,
          toolName: agentEvent.toolName,
          arguments: agentEvent.input ?? agentEvent.argsPreview ?? {},
          requiresApproval: agentEvent.requiresApproval,
          ...(agentEvent.providerToolCallId ? { providerToolCallId: agentEvent.providerToolCallId } : {}),
          ...(toolModelCallId ? { modelCallId: toolModelCallId } : {}),
        })
        const event = makeEvent(
          "tool.call.started",
          {
            toolCallId: agentEvent.toolCallId,
            providerToolCallId: agentEvent.providerToolCallId,
            toolName: agentEvent.toolName,
            category: agentEvent.category,
            displayName: agentEvent.displayName,
            argsPreview: agentEvent.argsPreview,
            requiresApproval: agentEvent.requiresApproval,
            modelCallId: agentEvent.modelCallId,
            stepIndex: agentEvent.stepIndex,
          },
          {
            projectId,
            conversationId,
            sessionId: created.sessionId,
            turnId: created.turnId,
            actor: { type: "tool", id: agentEvent.toolCallId, label: agentEvent.toolName },
          },
        )
        appendAndEmit(emitEvent, store, event, "tool")
      }

      if (agentEvent.type === "tool.call.streaming") {
        // Transient pre-call hint so the UI can show "Editing <file>" during the model
        // wait. It is replaced by the persisted tool.call.started event, so we do not store it.
        const event = makeEvent(
          "tool.call.streaming",
          {
            toolCallId: agentEvent.toolCallId,
            providerToolCallId: agentEvent.providerToolCallId,
            toolName: agentEvent.toolName,
            category: agentEvent.category,
            displayName: agentEvent.displayName,
            ...(agentEvent.argsPreview ? { argsPreview: agentEvent.argsPreview } : {}),
            ...(agentEvent.pathPreview ? { pathPreview: agentEvent.pathPreview } : {}),
            modelCallId: agentEvent.modelCallId,
            stepIndex: agentEvent.stepIndex,
          },
          {
            projectId,
            conversationId,
            sessionId: created.sessionId,
            turnId: created.turnId,
            actor: { type: "tool", id: agentEvent.toolCallId, label: agentEvent.toolName },
          },
        )
        emitEvent(event)
      }

      if (agentEvent.type === "tool.call.output") {
        if (agentEvent.text) {
          store.appendShellOutput(agentEvent.toolCallId, agentEvent.stream, agentEvent.text)
        }
        const event = makeEvent(
          "tool.call.output",
          {
            toolCallId: agentEvent.toolCallId,
            providerToolCallId: agentEvent.providerToolCallId,
            stream: agentEvent.stream,
            text: agentEvent.text,
            data: agentEvent.data,
            modelCallId: agentEvent.modelCallId,
            stepIndex: agentEvent.stepIndex,
          },
          {
            projectId,
            conversationId,
            sessionId: created.sessionId,
            turnId: created.turnId,
            actor: { type: "tool", id: agentEvent.toolCallId },
          },
        )
        appendAndEmit(emitEvent, store, event, "tool")
      }

      if (agentEvent.type === "tool.call.completed") {
        store.completeToolCall(agentEvent.toolCallId, agentEvent.output)
        if (isBashOutput(agentEvent.output)) {
          store.updateShellCommandMetadata(agentEvent.toolCallId, {
            operation: agentEvent.output.operation ?? "run",
            platform: agentEvent.output.shell.platform,
            shellKind: agentEvent.output.shell.kind,
            shellExecutable: agentEvent.output.shell.executable,
            processId: agentEvent.output.process?.processId,
            processStatus: agentEvent.output.process?.status,
            nextOutputSequence: agentEvent.output.process?.nextOutputSequence,
            terminalId: agentEvent.output.terminal?.terminalId,
            terminalName: agentEvent.output.terminal?.name,
            terminalStatus: agentEvent.output.terminal?.status,
            autoDetached: agentEvent.output.terminal?.autoDetached,
            awaitingInput: agentEvent.output.terminal?.awaitingInput,
            lastPrompt: agentEvent.output.terminal?.lastPrompt,
          })
          store.completeShellCommand(agentEvent.toolCallId, {
            exitCode: agentEvent.output.exitCode,
            signal: agentEvent.output.signal ?? null,
            durationMs: agentEvent.output.durationMs,
            cwd: agentEvent.output.cwd,
          })
        }
        if (isEditOutput(agentEvent.output)) {
          store.recordFileOperations({
            conversationId,
            sessionId: created.sessionId,
            turnId: created.turnId,
            toolCallId: agentEvent.toolCallId,
            files: agentEvent.output.changedFiles,
          })
          store.recordPatch({
            conversationId,
            sessionId: created.sessionId,
            turnId: created.turnId,
            toolCallId: agentEvent.toolCallId,
            diff: agentEvent.output.diff,
            files: agentEvent.output.changedFiles,
          })
        }
        const event = makeEvent(
          "tool.call.completed",
          {
            toolCallId: agentEvent.toolCallId,
            providerToolCallId: agentEvent.providerToolCallId,
            summary: agentEvent.summary,
            resultPreview: agentEvent.resultPreview,
            metrics: agentEvent.metrics,
            durationMs: agentEvent.durationMs,
            modelCallId: agentEvent.modelCallId,
            stepIndex: agentEvent.stepIndex,
          },
          {
            projectId,
            conversationId,
            sessionId: created.sessionId,
            turnId: created.turnId,
            actor: { type: "tool", id: agentEvent.toolCallId, label: agentEvent.toolName },
          },
        )
        appendAndEmit(emitEvent, store, event, "tool")
      }

      if (agentEvent.type === "tool.call.failed") {
        const errorId = store.recordError({
          conversationId,
          sessionId: created.sessionId,
          turnId: created.turnId,
          source: "tool",
          code: agentEvent.error.code,
          message: agentEvent.error.message,
          details: agentEvent.error.details,
          recoverable: agentEvent.error.recoverable,
        })
        store.failToolCall(agentEvent.toolCallId, errorId, agentEvent.error.code === "tool_approval_rejected")
        const event = makeEvent(
          "tool.call.failed",
          {
            toolCallId: agentEvent.toolCallId,
            providerToolCallId: agentEvent.providerToolCallId,
            toolName: agentEvent.toolName,
            error: apiError(agentEvent.error.code, agentEvent.error.message, {
              details: agentEvent.error.details,
              recoverable: agentEvent.error.recoverable,
            }),
            modelCallId: agentEvent.modelCallId,
            stepIndex: agentEvent.stepIndex,
          },
          {
            projectId,
            conversationId,
            sessionId: created.sessionId,
            turnId: created.turnId,
            actor: { type: "tool", id: agentEvent.toolCallId, label: agentEvent.toolName },
          },
        )
        appendAndEmit(emitEvent, store, event, "tool")
      }

      if (agentEvent.type === "approval.resolved") {
        if (agentEvent.decision === "approved") {
          store.markToolRunningByApproval(agentEvent.approvalId)
        }
        const event = makeEvent(
          "approval.resolved",
          {
            approvalId: agentEvent.approvalId,
            toolCallId: agentEvent.toolCallId,
            providerToolCallId: agentEvent.providerToolCallId,
            decision: agentEvent.decision,
          },
          {
            projectId,
            conversationId,
            sessionId: created.sessionId,
            turnId: created.turnId,
            actor: { type: "system" },
          },
        )
        appendAndEmit(emitEvent, store, event, "server")
      }
    }

    if (abortController.signal.aborted) {
      return
    }

    if (suspended) {
      for (const modelCallId of modelCallIds) {
        store.completeModelCall({
          modelCallId,
          response: { finish: "waiting" },
          ...(responseMetadataByModelCallId.has(modelCallId)
            ? { providerResponse: responseMetadataByModelCallId.get(modelCallId) }
            : {}),
          ...(latestUsageByModelCallId.get(modelCallId) ? { usage: toStoredUsage(latestUsageByModelCallId.get(modelCallId) as ModelUsage) } : {}),
        })
      }
      if (suspendedWait) {
        appendAndEmit(
          emitEvent,
          store,
          makeEvent(
            "turn.waiting",
            {
              turnId: created.turnId,
              terminalNames: suspendedWait.terminalNames,
              wakeOn: suspendedWait.wakeOn,
              reason: suspendedWait.reason,
            },
            {
              projectId,
              conversationId,
              sessionId: created.sessionId,
              turnId: created.turnId,
              actor: { type: "main_agent" },
            },
          ),
          "core",
        )
      }
      return
    }

    if (!finalResult) {
      throw new SocratesError("agent_final_result_missing", "Socrates completed without a validated final result.", { recoverable: true })
    }
    const validatedFinalResult = finalResult
    const assistantMessage = store.completeAgentTurnAtomically({
      conversationId,
      sessionId: created.sessionId,
      turnId: created.turnId,
      content: validatedFinalResult.finalAnswer,
      reasoning: reasoningText,
      ...(flowStore ? {
        afterPersist: (message) => {
          flowStore.finalizeClassicGoal(created.turnId, validatedFinalResult.goalFinalization, message.id)
        },
      } : {}),
    })
    durableTurnCommitted = true
    const turnUsageReport = store.buildTurnUsageReport(created.turnId)

    const messageCompleted = makeEvent(
      "message.completed",
      {
        message: assistantMessage,
        ...(latestUsage ? { usage: toContractUsage(latestUsage) } : {}),
        ...(turnUsageReport ? { turnUsageReport } : {}),
      },
      {
        projectId,
        conversationId,
        sessionId: created.sessionId,
        turnId: created.turnId,
        actor: { type: "main_agent" },
      },
    )
    appendAndEmit(emitEvent, store, messageCompleted, "core")

    const turnCompleted = makeEvent(
      "turn.completed",
      {
        turnId: created.turnId,
        assistantMessageId: assistantMessage.id,
        summary: "Agent response completed.",
        ...(turnUsageReport ? { turnUsageReport } : {}),
      },
      {
        projectId,
        conversationId,
        sessionId: created.sessionId,
        turnId: created.turnId,
        actor: { type: "main_agent" },
      },
    )
    appendAndEmit(emitEvent, store, turnCompleted, "core")

    const finalizedGoal = flowStore?.getClassicGoalForTurn(created.turnId)
    if (finalizedGoal) store.indexGoalRetrieval(projectId, finalizedGoal.goalId)
    for (const modelCallId of modelCallIds) {
      store.completeModelCall({
        modelCallId,
        response: { messageId: assistantMessage.id, finish: "completed" },
        ...(responseMetadataByModelCallId.has(modelCallId)
          ? { providerResponse: responseMetadataByModelCallId.get(modelCallId) }
          : {}),
        ...(latestUsageByModelCallId.get(modelCallId) ? { usage: toStoredUsage(latestUsageByModelCallId.get(modelCallId) as ModelUsage) } : {}),
      })
    }
    store.indexTurnTraceDocuments(projectId, conversationId, created.turnId)
    store.recordProjectStateLedgerTurn(projectId, conversationId, created.turnId, "completed", validatedFinalResult.finalAnswer)
    store.completeTerminalTaskForTurn(created.turnId, "completed")

    const postTurnHistory = store.getConversationModelMessages(projectId, conversationId, { includeImageParts })
    await agent.precomputeContext({
      providerId: runtimeConfig.providerId,
      modelId: runtimeConfig.modelId,
      runtimeConfig,
      messages: postTurnHistory,
      promptContext,
      contextCompression: createClassicContextCompressionRuntime(store, projectId, conversationId, created.sessionId, created.turnId),
    })
  } catch (error) {
    if (abortController.signal.aborted) {
      return
    }
    const normalized = normalizeError(error)
    if (durableTurnCommitted) {
      store.recordError({
        conversationId,
        sessionId: created.sessionId,
        turnId: created.turnId,
        source: "post_commit",
        code: "post_commit_processing_failed",
        message: normalized.message,
        details: normalized.details,
        recoverable: true,
      })
      return
    }
    const errorId = store.failTurn({
      conversationId,
      sessionId: created.sessionId,
      turnId: created.turnId,
      code: normalized.code,
      message: normalized.message,
      details: normalized.details,
    })
    for (const modelCallId of modelCallIds) {
      store.failModelCall(modelCallId, errorId)
    }
    const failed = makeEvent(
      "turn.failed",
      {
        turnId: created.turnId,
        error: apiError(normalized.code, normalized.message, { details: normalized.details }),
      },
      {
        projectId,
        conversationId,
        sessionId: created.sessionId,
        turnId: created.turnId,
        actor: { type: "main_agent" },
      },
    )
    appendAndEmit(emitEvent, store, failed, "core")
    store.indexTurnTraceDocuments(projectId, conversationId, created.turnId)
    store.recordProjectStateLedgerTurn(projectId, conversationId, created.turnId, "failed", answerText)
    store.completeTerminalTaskForTurn(created.turnId, "failed")
  } finally {
    activeTurns.delete(created.turnId)
  }
}
