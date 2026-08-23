import type { WebSocket } from "ws"
import {
  socratesRuntimeConfigSchema,
  socratesServerEventSchema,
  type SocratesClientCommand,
  type SocratesSnapshot,
  type SocratesLiveActivity,
  type SocratesFinalAnswer,
  type SocratesRuntimeConfig,
  type SocratesServerEvent,
  type SocratesTurn,
} from "@socrates/contracts"
import {
  createResolvedTurnContextSeed,
  findModelOption,
  selectExactMemoryCandidates,
  type SocratesAgent,
  type SocratesAgentEvent,
} from "@socrates/core"
import type { McpRuntime } from "@socrates/mcp"
import type { ModelUsage } from "@socrates/providers"
import { createId, normalizeError, nowIso, SocratesError } from "@socrates/shared"
import { listWorkspaceEnvKeyCandidates, readWorkspaceEnvValue } from "@socrates/workspace"
import type { SocratesStore } from "../services/store"
import { createSocratesContextCompressionRuntime } from "../services/socrates/contextCompressionRuntime"
import type { SocratesContinuedTerminalTask, GlobalSocratesStore, SocratesReadyTerminalTask } from "../services/socrates/socratesStore"
import { buildSocratesWorkingMessages } from "../services/socrates/socratesWorkingContext"
import { ActiveTurns } from "../ws/activeTurns"
import { makeSocratesEvent } from "./eventSender"
import { resolveSocratesGoal } from "./goalLifecycleCoordinator"
import { createSocratesLiveActivity, socratesToolActivity } from "./liveActivity"
import { actorForRuntimeSource, recordSocratesModelUsage, safeRuntimeStringify } from "./runtimeTelemetry"
import { SocratesSubscriptions } from "./subscriptions"
import { SocratesTerminalRuntime } from "./terminalRuntime"
import { createSocratesToolExecutors } from "./toolExecutors"

type ScopedCommand<T extends SocratesClientCommand["type"]> = Extract<SocratesClientCommand, { type: T }>
type RuntimeMessageCommand = ScopedCommand<"socrates.message.send"> & { projectId: string }

export type SocratesExecutionRuntimeDeps = {
  store: GlobalSocratesStore
  sharedStore: SocratesStore
  agent: SocratesAgent
  subscriptions?: SocratesSubscriptions
  activeTurns?: ActiveTurns
  mcpRuntime?: McpRuntime
  supervisorScope?: string
}

export class SocratesExecutionRuntime {
  readonly subscriptions: SocratesSubscriptions
  readonly activeTurns: ActiveTurns
  readonly terminals: SocratesTerminalRuntime
  private readonly inFlight = new Map<string, Promise<void>>()
  private initialized = false

  constructor(private readonly deps: SocratesExecutionRuntimeDeps) {
    this.subscriptions = deps.subscriptions ?? new SocratesSubscriptions()
    this.activeTurns = deps.activeTurns ?? new ActiveTurns()
    this.terminals = new SocratesTerminalRuntime(deps.store, (type, payload, scope, source) => {
      this.emitUntyped(type, payload, scope, source ?? "terminal")
    }, { ...(deps.supervisorScope ? { supervisorScope: deps.supervisorScope } : {}) })
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    this.terminals.setTaskWakeHandler((task) => this.scheduleTerminalContinuation(task))
    await this.terminals.reconcilePersistedTerminals()
    for (const task of this.deps.store.listReadyTerminalTasks()) this.scheduleTerminalContinuation(task)
  }

  subscribe(socket: WebSocket, command: ScopedCommand<"socrates.subscribe">): void {
    this.subscriptions.subscribe(socket)
    this.subscriptions.send(socket, makeSocratesEvent(
      "socrates.connection.ready",
      { connectionId: createId("conn"), serverTime: nowIso() },
      {},
    ))
    const afterSequence = command.payload.afterSequence ?? 0
    for (const persisted of this.deps.store.listRuntimeEvents(afterSequence, 2_000)) {
      const replay = socratesServerEventSchema.safeParse({
        id: persisted.id,
        schemaVersion: 3,
        timestamp: persisted.createdAt,
        ...(persisted.goalId ? { goalId: persisted.goalId } : {}),
        ...(persisted.turnId ? { turnId: persisted.turnId } : {}),
        actor: actorForRuntimeSource(persisted.source),
        type: persisted.type,
        payload: persisted.payload,
      })
      if (replay.success) this.subscriptions.send(socket, replay.data)
    }
    // Snapshot is deliberately last: it is the authoritative hydration state
    // and carries the newest reconnect cursor even when an older client replays
    // duplicate, idempotent events.
    this.subscriptions.send(socket, makeSocratesEvent(
      "socrates.state.snapshot",
      { snapshot: this.deps.store.getSnapshot() },
      {},
    ))
  }

  unsubscribe(socket: WebSocket): void {
    this.subscriptions.unsubscribe(socket)
  }

  async startTurn(socket: WebSocket, command: ScopedCommand<"socrates.message.send">): Promise<SocratesTurn> {
    const projectId = this.deps.store.resolveRuntimeProjectId(command.payload.foregroundGoalIdAtCompose)
    const runtimeCommand: RuntimeMessageCommand = { ...command, projectId }
    await this.deps.sharedStore.refreshAvailableModels()
    const runtimeConfig = socratesRuntimeConfigSchema.parse(
      this.deps.sharedStore.resolveRuntimeConfig(command.payload.runtimeConfig) as SocratesRuntimeConfig,
    )
    const created = this.deps.store.createTurn({
      projectId,
      clientMessageId: command.payload.clientMessageId,
      content: command.payload.content,
      ...(command.payload.attachmentIds ? { attachmentIds: command.payload.attachmentIds } : {}),
      runtimeConfig,
    })
    this.subscriptions.subscribe(socket)
    this.activeTurns.create(created.turn.id)
    this.emit(
      "socrates.turn.started",
      { turn: created.turn, userMessage: created.userMessage },
      { turnId: created.turn.id },
      "main_agent",
      socket,
    )
    this.emitActivity(
      createSocratesLiveActivity(created.turn.id, "routing", "Finding the right focus…"),
      { turnId: created.turn.id },
      socket,
    )
    const execution = this.executeTurn({
      socket,
      command: runtimeCommand,
      runtimeConfig,
      created,
    }).finally(() => {
      this.inFlight.delete(created.turn.id)
    })
    this.inFlight.set(created.turn.id, execution)
    void execution
    return created.turn
  }

  cancel(command: ScopedCommand<"socrates.turn.cancel">): SocratesTurn {
    this.activeTurns.get(command.payload.turnId)?.abort()
    const turn = this.deps.store.cancelTurn(command.payload.turnId, command.payload.reason ?? "Cancelled by the user.")
    const projectId = this.deps.store.resolveRuntimeProjectId(turn.goalId)
    this.deps.sharedStore.indexSocratesTurnRetrieval(projectId, command.payload.turnId)
    this.emit("socrates.turn.updated", { turn }, { turnId: command.payload.turnId }, "main_agent")
    return turn
  }

  decideApproval(command: ScopedCommand<"socrates.approval.decide">): void {
    const approval = this.deps.store.resolveApproval(
      command.payload.approvalId,
      command.payload.decision,
      command.payload.reason,
    )
    this.activeTurns.resolveApproval(command.payload.approvalId, {
      decision: command.payload.decision,
      ...(command.payload.reason ? { reason: command.payload.reason } : {}),
    })
    this.emit("socrates.approval.updated", { approval }, {}, "user")
    if (command.payload.decision === "rejected") {
      this.activeTurns.get(approval.turnId)?.abort()
      const turn = this.deps.store.cancelTurn(
        approval.turnId,
        command.payload.reason ?? "The user rejected this tool call.",
      )
      this.emit("socrates.turn.updated", { turn }, { turnId: approval.turnId }, "user")
    }
  }

  submitCredential(command: ScopedCommand<"socrates.credential.input.submit">): void {
    const request = this.deps.store.resolveCredentialRequest(
      command.payload.credentialRequestId,
      command.payload.decision,
    )
    // The submitted value crosses exactly one in-memory handoff. It is never
    // included in the persisted runtime event, a log line, or a Socrates DB record.
    this.activeTurns.resolveCredentialInput(command.payload.turnId, command.payload.credentialRequestId, {
      decision: command.payload.decision,
      ...(command.payload.value !== undefined ? { value: command.payload.value } : {}),
      source: "user_input",
    })
    this.emit("socrates.credential.input.resolved", { request }, { turnId: command.payload.turnId }, "user")
  }

  submitFeedback(command: ScopedCommand<"socrates.feedback.submit">): void {
    const projectId = this.deps.store.resolveRuntimeProjectId(command.goalId)
    const feedback = this.deps.store.submitFeedback({
      projectId,
      messageId: command.payload.messageId,
      ...(command.payload.turnId ? { turnId: command.payload.turnId } : {}),
      ...(command.payload.modelCallId ? { modelCallId: command.payload.modelCallId } : {}),
      rating: command.payload.rating,
      ...(command.payload.reasonCode ? { reasonCode: command.payload.reasonCode } : {}),
      ...(command.payload.note ? { note: command.payload.note } : {}),
    })
    this.emit("socrates.feedback.updated", { feedback }, {
      ...(command.payload.turnId ? { turnId: command.payload.turnId } : {}),
    }, "user")
  }

  async respondToClarification(socket: WebSocket, command: ScopedCommand<"socrates.routing.clarification.respond">): Promise<SocratesTurn> {
    const resolved = this.deps.store.resolveRoutingClarification({
      routingRunId: command.payload.routingRunId,
      answerMessageId: command.payload.answerMessageId,
      answer: command.payload.answer,
    })
    const runtimeConfig = this.deps.store.getRuntimeConfig(resolved.created.turn.id).runtimeConfig
    this.subscriptions.subscribe(socket)
    this.activeTurns.create(resolved.created.turn.id)
    this.emit("socrates.message.completed", { message: resolved.answerMessage }, {
      turnId: resolved.created.turn.id,
    }, "user")
    this.emit("socrates.routing.clarification.resolved", {
      routingRun: resolved.routingRun,
      answerMessage: resolved.answerMessage,
    }, { turnId: resolved.created.turn.id }, "goal_resolution")
    const syntheticCommand = {
      id: createId("socraevent"),
      schemaVersion: 3 as const,
      timestamp: nowIso(),
      turnId: resolved.created.turn.id,
      type: "socrates.message.send" as const,
      payload: {
        clientMessageId: resolved.created.userMessage.id,
        content: resolved.created.userMessage.content,
        runtimeConfig,
      },
      projectId: this.deps.store.resolveRuntimeProjectId(resolved.created.turn.goalId),
    } satisfies RuntimeMessageCommand
    const execution = this.executeTurn({
      socket,
      command: syntheticCommand,
      runtimeConfig,
      created: resolved.created,
      clarificationAnswer: resolved.clarificationAnswer,
    }).finally(() => this.inFlight.delete(resolved.created.turn.id))
    this.inFlight.set(resolved.created.turn.id, execution)
    void execution
    return resolved.created.turn
  }

  updateFocus(command: ScopedCommand<"socrates.goal.update">): void {
    const result = this.deps.store.updateGoal({
      goalId: command.payload.goalId,
      action: command.payload.action,
      ...(command.payload.note ? { note: command.payload.note } : {}),
    })
    for (const transition of result.transitions) {
      const goal = this.deps.store.getSnapshot().goals.find((candidate) => candidate.id === transition.goalId)
      if (goal) this.emit("socrates.goal.transitioned", { goal, transition }, { goalId: goal.id }, "user")
    }
    this.emit("socrates.state.snapshot", { snapshot: this.deps.store.getSnapshot() }, {}, "system")
  }

  async stopTerminal(command: ScopedCommand<"socrates.terminal.stop">): Promise<void> {
    await this.terminals.stop(command.payload.terminalId)
  }

  async inputTerminal(command: ScopedCommand<"socrates.terminal.input">): Promise<void> {
    await this.terminals.writeInput(command.payload.terminalId, {
      ...(command.payload.data !== undefined ? { data: command.payload.data } : {}),
      ...(command.payload.text !== undefined ? { text: command.payload.text } : {}),
      ...(command.payload.key !== undefined ? { key: command.payload.key } : {}),
      ...(command.payload.submit !== undefined ? { submit: command.payload.submit } : {}),
    })
  }

  async resizeTerminal(command: ScopedCommand<"socrates.terminal.resize">): Promise<void> {
    await this.terminals.resize(command.payload.terminalId, command.payload.cols, command.payload.rows)
  }

  renameTerminal(command: ScopedCommand<"socrates.terminal.rename">): void {
    this.terminals.rename(command.payload.terminalId, command.payload.name)
  }

  async shutdown(timeoutMs = 10_000): Promise<boolean> {
    this.terminals.beginShutdown()
    this.activeTurns.abortAll()
    const settled = await Promise.race([
      Promise.allSettled([...this.inFlight.values()]).then(() => true),
      new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), timeoutMs)
        timeout.unref?.()
      }),
    ])
    await this.terminals.dispose({ preserveRunning: true })
    return settled
  }

  emitCommandError(socket: WebSocket, command: { goalId?: string; turnId?: string }, error: unknown): void {
    const normalized = normalizeError(error)
    const createdAt = nowIso()
    const event = makeSocratesEvent("socrates.error.created", {
      error: {
        id: createId("v2err"),
        ...(command.goalId ? { goalId: command.goalId } : {}),
        ...(command.turnId ? { turnId: command.turnId } : {}),
        source: "command",
        code: normalized.code,
        message: normalized.message,
        recoverable: normalized.recoverable,
        ...(normalized.details === undefined ? {} : { details: normalized.details }),
        createdAt,
      },
    }, {
      ...(command.goalId ? { goalId: command.goalId } : {}),
      ...(command.turnId ? { turnId: command.turnId } : {}),
    })
    this.subscriptions.send(socket, event)
  }

  private scheduleTerminalContinuation(task: SocratesReadyTerminalTask): void {
    const continued = this.deps.store.beginTerminalTaskContinuation(task)
    if (!continued) return
    this.activeTurns.create(continued.turn.id)
    this.emit("socrates.turn.updated", { turn: continued.suspendedTurn }, {
      goalId: continued.goalId,
      turnId: continued.suspendedTurn.id,
    }, "terminal")
    const command = {
      id: createId("socraevent"),
      schemaVersion: 3 as const,
      timestamp: nowIso(),
      projectId: continued.projectId,
      goalId: continued.goalId,
      turnId: continued.turn.id,
      type: "socrates.message.send" as const,
      payload: {
        clientMessageId: continued.userMessage.id,
        content: continued.userMessage.content,
        runtimeConfig: continued.runtimeConfig,
      },
    } satisfies RuntimeMessageCommand
    const created: ReturnType<GlobalSocratesStore["createTurn"]> = {
      state: this.deps.store.getState(),
      turn: continued.turn,
      userMessage: continued.userMessage,
      runtimeConfigId: continued.runtimeConfigId,
    }
    const execution = this.executeTurn({
      command,
      runtimeConfig: continued.runtimeConfig,
      created,
      continuation: continued,
    }).finally(() => this.inFlight.delete(continued.turn.id))
    this.inFlight.set(continued.turn.id, execution)
    void execution
  }

  private async executeTurn(input: {
    socket?: WebSocket
    command: RuntimeMessageCommand
    runtimeConfig: SocratesRuntimeConfig
    created: ReturnType<GlobalSocratesStore["createTurn"]>
    continuation?: SocratesContinuedTerminalTask
    clarificationAnswer?: string
  }): Promise<void> {
    const { command, created, runtimeConfig, continuation, clarificationAnswer } = input
    const abortController = this.activeTurns.get(created.turn.id)
    if (!abortController) return
    const modelCallIds = new Set<string>()
    const completedModelCalls = new Set<string>()
    const responseMetadata = new Map<string, unknown>()
    const usageByCall = new Map<string, ModelUsage>()
    let reasoningText = ""
    let finalResult: SocratesFinalAnswer | undefined
    let goalId: string | undefined
    let memoryCandidates: readonly import("@socrates/contracts").MemoryCandidate[] = []
    let capabilityCandidates: readonly import("@socrates/contracts").CapabilityCandidate[] = []
    let retrievalStatus: import("@socrates/contracts").CandidateRetrievalStatus = {
      goalCandidates: "completed",
      memoryCandidates: "completed",
      capabilityCandidates: "completed",
      warnings: [],
    }
    let suspended = false
    let durableTurnCommitted = false
    let frontierHandoverActive = false
    let lastActivitySignature = "routing:Finding the right focus…"
    const publishActivity = (activity: SocratesLiveActivity) => {
      const signature = `${activity.phase}:${activity.label}`
      if (signature === lastActivitySignature) return
      lastActivitySignature = signature
      this.emitActivity(activity, {
        ...(goalId ? { goalId } : {}),
        turnId: created.turn.id,
      }, input.socket)
    }
    try {
      const workspacePath = this.deps.store.getWorkspacePath(command.projectId)
      const promptContext = this.deps.sharedStore.getGlobalAgentContextAtWorkspace(workspacePath)
      const filesystemAuthorization = this.deps.sharedStore.createTurnFilesystemAuthorization(created.turn.id, workspacePath)
      let activeGoalId: string
      if (continuation) {
        activeGoalId = continuation.goalId
        goalId = activeGoalId
        publishActivity(createSocratesLiveActivity(created.turn.id, "thinking", "Resuming the current task…"))
        this.emit(
          "socrates.turn.updated",
          { turn: continuation.turn },
          { goalId: activeGoalId, turnId: created.turn.id },
          "main_agent",
        )
      } else {
        const resolution = await resolveSocratesGoal({
          projectId: command.projectId,
          turnId: created.turn.id,
          messageId: created.userMessage.id,
          messageContent: command.payload.content,
          ...(command.payload.foregroundGoalIdAtCompose
            ? { preferredGoalId: command.payload.foregroundGoalIdAtCompose }
            : {}),
          workspacePath,
          store: this.deps.store,
          sharedStore: this.deps.sharedStore,
          agent: this.deps.agent,
          runtimeConfig,
          recordUsage: (modelCallId, usage) => recordSocratesModelUsage(this.deps.store, modelCallId, usage),
          ...(clarificationAnswer ? { clarificationAnswer } : {}),
          abortSignal: abortController.signal,
        })
        if (resolution.status === "clarification") {
          publishActivity(createSocratesLiveActivity(created.turn.id, "awaiting_input", "Waiting for your focus choice…"))
          this.emit("socrates.routing.clarification.requested", {
            routingRun: resolution.routingRun,
            message: resolution.message,
          }, { turnId: created.turn.id }, "goal_resolution")
          this.emit("socrates.message.completed", { message: resolution.message }, { turnId: created.turn.id }, "goal_resolution")
          this.emit("socrates.turn.updated", { turn: resolution.turn }, { turnId: created.turn.id }, "goal_resolution")
          return
        }
        const applied = resolution.applied
        memoryCandidates = resolution.memoryCandidates
        capabilityCandidates = resolution.capabilityCandidates
        retrievalStatus = resolution.retrieval
        activeGoalId = resolution.goalId
        goalId = activeGoalId
        publishActivity(createSocratesLiveActivity(created.turn.id, "thinking", "Reviewing the relevant context…"))
        this.deps.sharedStore.indexGoalRetrieval(
          this.deps.store.getGoalHomeProjectId(activeGoalId),
          activeGoalId,
        )
        this.emit(
          "socrates.goal.routed",
          { routingRun: applied.routingRun, goal: applied.goal, ...(applied.transition ? { transition: applied.transition } : {}) },
          { goalId: activeGoalId, turnId: created.turn.id },
          "goal_resolution",
        )
        const routedTurn: SocratesTurn = { ...created.turn, goalId: activeGoalId, status: "running", updatedAt: nowIso() }
        this.emit("socrates.turn.updated", { turn: routedTurn }, { goalId: activeGoalId, turnId: created.turn.id }, "main_agent")
      }
      goalId = activeGoalId
      const activeGoalHomeProjectId = this.deps.store.getGoalHomeProjectId(
        activeGoalId,
      )

      const selectedModel =
        this.deps.sharedStore.findAvailableModelOption(runtimeConfig.providerId, runtimeConfig.modelId, runtimeConfig.authMode ?? "api_key") ??
        findModelOption(runtimeConfig.providerId, runtimeConfig.modelId, runtimeConfig.authMode ?? "api_key")
      const messages = await buildSocratesWorkingMessages(this.deps.store, this.deps.sharedStore, {
        projectId: command.projectId,
        goalId: activeGoalId,
        query: command.payload.content,
        includeImages: selectedModel?.capabilities?.vision === true,
        ...(continuation ? { lateDeveloperContext: continuation.wakeContext } : {}),
      })
      if (clarificationAnswer) {
        messages.push({ role: "user", content: `[Focus clarification answer: ${clarificationAnswer}]` })
      }
      const stableCachePreludeSnapshot = this.deps.sharedStore.loadStableCachePreludeSnapshot(command.projectId, workspacePath)
      const frontierModelSettings = this.deps.sharedStore.getWorkerModelSetting("frontier")
      const exposedMcpServers = new Set<string>()
      for (const candidate of capabilityCandidates) {
        if (candidate.kind === "mcp") exposedMcpServers.add(candidate.name)
      }
      const toolExecutors = createSocratesToolExecutors({
        socratesStore: this.deps.store,
        sharedStore: this.deps.sharedStore,
        activeTurns: this.activeTurns,
        terminals: this.terminals,
        projectId: command.projectId,
        goalId: activeGoalId,
        turnId: created.turn.id,
        workspacePath,
        ...(this.deps.mcpRuntime ? { mcpRuntime: this.deps.mcpRuntime } : {}),
        exposeMcpServer: (serverId) => exposedMcpServers.add(serverId),
      })
      const streamMessageId = `${created.turn.id}_assistant`
      const fileFreshness = this.activeTurns.getFileFreshness(created.turn.id)
      const activeGoal = this.deps.store.getActiveGoalCard({
        goalId: activeGoalId,
        sourceTurnId: created.turn.id,
        taskRequest: command.payload.content,
      })
      const reconciliationWatermark = this.deps.store.getTaskReconciliationWatermark(created.turn.id)
      for await (const event of this.deps.agent.streamTurn({
        projectId: command.projectId,
        conversationId: "global-socrates",
        sessionId: created.turn.id,
        turnId: created.turn.id,
        turnOrdinal: created.turn.ordinal,
        cacheKey: `socrates:goal:${activeGoalId}`,
        providerId: runtimeConfig.providerId,
        modelId: runtimeConfig.modelId,
        runtimeConfig,
        frontierModelSettings,
        messages,
        promptContext,
        workspacePath,
        filesystemAuthorization,
        stableCachePreludeSnapshot,
        completionMode: "main_structured",
        ...(reconciliationWatermark ? {
          reconciliationWatermark: reconciliationWatermark.state,
          taskStartedAt: reconciliationWatermark.taskStartedAt,
          persistReconciliationWatermark: (state) => this.deps.store.saveTaskReconciliationWatermark(created.turn.id, state),
        } : {}),
        activeGoal,
        resolvedTurnContextSeed: createResolvedTurnContextSeed({
          goal: activeGoal,
          messages,
          retrieval: retrievalStatus,
        }),
        resolvedTurnMemory: selectExactMemoryCandidates({
          candidates: memoryCandidates,
          userMessage: command.payload.content,
          goal: activeGoal,
        }),
        resolvedTurnCapabilities: capabilityCandidates.map(({ resultNumber: _resultNumber, ...candidate }) => candidate),
        contextCompression: createSocratesContextCompressionRuntime({
          store: this.deps.store,
          sharedStore: this.deps.sharedStore,
          projectId: command.projectId,
          goalId: activeGoalId,
          turnId: created.turn.id,
          workspacePath,
        }),
        bindContextResultHandle: ({ result, toolCallId }) => this.deps.store.bindContextResultHandle(toolCallId, result),
        toolExecutors,
        runtimeCapabilities: () => this.deps.mcpRuntime
          ? [...exposedMcpServers].flatMap((serverId) => this.deps.mcpRuntime!.getDynamicCapabilityDefinitions(serverId, { workspacePath }))
          : [],
        maxParallelToolCalls: 5,
        maxToolCallsPerTurn: 80,
        createModelCall: (request) => {
          const id = this.deps.store.createModelCall({
            projectId: command.projectId,
            goalId: activeGoalId,
            turnId: created.turn.id,
            role: frontierHandoverActive ? "frontier_agent" : "main_agent",
            providerId: request.providerId,
            modelId: request.modelId,
            request: {
              estimatedTokens: request.estimatedTokens,
              tokenCount: request.tokenCount,
              tools: request.tools.map((tool) => tool.name),
              messageCount: request.messages.length,
              contextProjection: "v2_goal_working_context",
            },
          })
          modelCallIds.add(id)
          return id
        },
        requestApproval: async (request) => {
          publishActivity(createSocratesLiveActivity(created.turn.id, "awaiting_input", "Waiting for your approval…"))
          const approval = this.deps.store.createApproval({
            id: request.approvalId,
            projectId: command.projectId,
            goalId: activeGoalId,
            turnId: created.turn.id,
            toolCallId: request.toolCallId,
            actionKind: request.actionKind,
            action: {
              toolName: request.toolName,
              title: request.title,
              description: request.description,
              actionPreview: request.actionPreview,
              risk: request.risk,
            },
          })
          this.emit("socrates.approval.updated", { approval }, { goalId: activeGoalId, turnId: created.turn.id }, "system")
          return this.activeTurns.waitForApproval(created.turn.id, request.approvalId, abortController.signal)
        },
        requestCredentialInput: async (request) => {
          if (request.source === "workspace_env") {
            const candidate = listWorkspaceEnvKeyCandidates(workspacePath, request.envKey).find((item) => item.hasKey)
            if (candidate) {
              const value = readWorkspaceEnvValue(workspacePath, candidate.fileName, request.envKey)
              if (value) return { decision: "submitted" as const, value, source: "workspace_env" as const }
            }
          }
          publishActivity(createSocratesLiveActivity(created.turn.id, "awaiting_input", "Waiting for a required credential…"))
          const persisted = this.deps.store.createCredentialRequest({
            id: request.credentialRequestId,
            projectId: command.projectId,
            goalId: activeGoalId,
            turnId: created.turn.id,
            toolCallId: request.toolCallId,
            serverId: request.serverId,
            ...(request.serverLabel ? { serverLabel: request.serverLabel } : {}),
            envKey: request.envKey,
            source: "user_input",
          })
          this.emit("socrates.credential.input.requested", { request: persisted }, { goalId: activeGoalId, turnId: created.turn.id }, "system")
          return this.activeTurns.waitForCredentialInput(created.turn.id, request.credentialRequestId, "user_input", abortController.signal)
        },
        abortSignal: abortController.signal,
        ...(fileFreshness ? { fileFreshness } : {}),
      })) {
        if (abortController.signal.aborted) break
        if (event.type === "agent.final_result") {
          finalResult = event.result
        } else if (event.type === "model.answer.delta") {
          publishActivity(createSocratesLiveActivity(created.turn.id, "preparing_answer", "Preparing the answer…"))
        } else if (event.type === "model.reasoning.delta") {
          reasoningText += event.text
          this.emit("socrates.message.delta", { messageId: streamMessageId, channel: "reasoning", text: event.text, ...(event.modelCallId ? { modelCallId: event.modelCallId } : {}) }, { goalId: activeGoalId, turnId: created.turn.id }, frontierHandoverActive ? "frontier_agent" : "main_agent")
        } else if (event.type === "model.reasoning.completed" && !reasoningText.endsWith(event.text)) {
          reasoningText += event.text
        } else if (event.type === "model.response.metadata" && event.modelCallId) {
          responseMetadata.set(event.modelCallId, event.response)
        } else if (event.type === "model.usage" && event.modelCallId) {
          usageByCall.set(event.modelCallId, event.usage)
          recordSocratesModelUsage(this.deps.store, event.modelCallId, event.usage)
        } else if (event.type === "model.completed" && event.modelCallId) {
          if (event.usage) {
            usageByCall.set(event.modelCallId, event.usage)
            recordSocratesModelUsage(this.deps.store, event.modelCallId, event.usage)
          }
          this.deps.store.completeModelCall({
            modelCallId: event.modelCallId,
            response: { finishReason: event.finishReason ?? "completed" },
            ...(responseMetadata.has(event.modelCallId) ? { providerResponse: responseMetadata.get(event.modelCallId) } : {}),
          })
          completedModelCalls.add(event.modelCallId)
        } else if (event.type === "model.started") {
          publishActivity(createSocratesLiveActivity(created.turn.id, "thinking", "Thinking through your request…"))
        } else if (event.type === "agent.handover") {
          frontierHandoverActive = true
          publishActivity(createSocratesLiveActivity(created.turn.id, "thinking", "Calling the Frontier model…"))
          this.emit("socrates.agent.handover", {
            toolCallId: event.toolCallId,
            stepIndex: event.stepIndex,
            fromProviderId: event.fromProviderId,
            fromModelId: event.fromModelId,
            toProviderId: event.toProviderId,
            toModelId: event.toModelId,
            ...(event.focus ? { focus: event.focus } : {}),
          }, { goalId: activeGoalId, turnId: created.turn.id }, "frontier_agent")
        } else if (event.type === "context.compaction.started") {
          publishActivity(createSocratesLiveActivity(created.turn.id, "thinking", "Condensing the working context…"))
          this.emit("socrates.context.compaction.started", {
            snapshotId: event.snapshotId,
            reason: event.reason,
            contextUsedTokensEstimate: event.contextUsedTokensEstimate,
            targetTokens: event.targetTokens,
          }, { goalId: activeGoalId, turnId: created.turn.id }, "context_compactor")
        } else if (event.type === "context.compaction.completed") {
          this.emit("socrates.context.compaction.completed", {
            snapshotId: event.snapshotId,
            inputTokensEstimate: event.inputTokensEstimate,
            outputTokensEstimate: event.outputTokensEstimate,
            contextUsedTokensEstimate: event.contextUsedTokensEstimate,
            sizeClass: event.sizeClass,
          }, { goalId: activeGoalId, turnId: created.turn.id }, "context_compactor")
        } else if (event.type === "context.compaction.failed") {
          this.emit("socrates.context.compaction.failed", {
            ...(event.snapshotId ? { snapshotId: event.snapshotId } : {}),
            error: {
              code: event.error.code,
              message: event.error.message,
              ...(event.error.details === undefined ? {} : { details: event.error.details }),
              recoverable: event.error.recoverable,
            },
          }, { goalId: activeGoalId, turnId: created.turn.id }, "context_compactor")
        } else {
          if (event.type === "tool.call.started") {
            publishActivity(socratesToolActivity(created.turn.id, event.toolName, event.input))
          }
          this.handleToolEvent(event, { projectId: command.projectId, goalId: activeGoalId, turnId: created.turn.id })
          if (event.type === "agent.suspended") {
            suspended = true
            publishActivity(createSocratesLiveActivity(created.turn.id, "awaiting_input", "Waiting for Terminal…"))
            break
          }
        }
      }
      if (abortController.signal.aborted) return
      if (suspended) {
        for (const modelCallId of modelCallIds) {
          if (completedModelCalls.has(modelCallId)) continue
          this.deps.store.completeModelCall({
            modelCallId,
            response: { finish: "waiting_for_terminal" },
            ...(responseMetadata.has(modelCallId) ? { providerResponse: responseMetadata.get(modelCallId) } : {}),
          })
          completedModelCalls.add(modelCallId)
        }
        const waitingTurn = this.deps.store.getTurn(created.turn.id)
        this.emit("socrates.turn.updated", { turn: waitingTurn }, {
          projectId: command.projectId,
          goalId: activeGoalId,
          turnId: created.turn.id,
        }, "main_agent")
        return
      }
      if (!finalResult) {
        throw new SocratesError("agent_final_result_missing", "Socrates completed without a validated final result.", { recoverable: true })
      }
      publishActivity(createSocratesLiveActivity(created.turn.id, "preparing_answer", "Preparing the answer…"))
      const assistantMessage = this.deps.store.commitValidatedTurn({
        projectId: command.projectId,
        turnId: created.turn.id,
        content: finalResult.finalAnswer,
        goalFinalization: finalResult.goalFinalization,
        ...(reasoningText ? { reasoning: reasoningText } : {}),
        persistUsageAndAudit: (message) => {
          for (const modelCallId of modelCallIds) {
            if (completedModelCalls.has(modelCallId)) continue
            this.deps.store.completeModelCall({
              modelCallId,
              response: { messageId: message.id, finish: "completed" },
              ...(responseMetadata.has(modelCallId) ? { providerResponse: responseMetadata.get(modelCallId) } : {}),
            })
          }
        },
      })
      durableTurnCommitted = true
      // Goal cards are derived retrieval data. The finalization transaction is
      // the authority for the goal status and latest capsule.
      this.deps.sharedStore.indexGoalRetrieval(activeGoalHomeProjectId, activeGoalId)
      for (const modelCallId of modelCallIds) completedModelCalls.add(modelCallId)
      const refreshedCapsule = this.deps.store.getSnapshot().latestCapsules
        .find((capsule) => capsule.goalId === activeGoalId)
      if (refreshedCapsule) {
        this.emit("socrates.goal.capsule.updated", { capsule: refreshedCapsule }, {
          projectId: command.projectId,
          goalId: activeGoalId,
          turnId: created.turn.id,
        }, "main_agent")
      }
      this.emit("socrates.message.completed", { message: assistantMessage }, { goalId: activeGoalId, turnId: created.turn.id }, "main_agent")
      this.emit("socrates.state.snapshot", { snapshot: this.deps.store.getSnapshot() }, { goalId: activeGoalId, turnId: created.turn.id }, "system")
      const completedAt = assistantMessage.completedAt ?? nowIso()
      this.emit("socrates.turn.updated", {
        turn: {
          ...created.turn,
          goalId: activeGoalId,
          assistantMessageId: assistantMessage.id,
          status: "completed",
          updatedAt: completedAt,
          completedAt,
        },
      }, { goalId: activeGoalId, turnId: created.turn.id }, "main_agent")

      this.deps.sharedStore.indexSocratesTurnRetrieval(command.projectId, created.turn.id)
      const postTurnMessages = await buildSocratesWorkingMessages(this.deps.store, this.deps.sharedStore, {
        projectId: command.projectId,
        goalId: activeGoalId,
        query: command.payload.content,
        includeImages: selectedModel?.capabilities?.vision === true,
      })
      await this.deps.agent.precomputeContext({
        providerId: runtimeConfig.providerId,
        modelId: runtimeConfig.modelId,
        runtimeConfig,
        messages: postTurnMessages,
        promptContext,
        contextCompression: createSocratesContextCompressionRuntime({
          store: this.deps.store,
          sharedStore: this.deps.sharedStore,
          projectId: command.projectId,
          goalId: activeGoalId,
          turnId: created.turn.id,
          workspacePath,
        }),
      })
    } catch (error) {
      if (abortController.signal.aborted) return
      if (durableTurnCommitted) {
        const normalized = normalizeError(error)
        this.deps.store.recordError({
          projectId: command.projectId,
          ...(goalId ? { goalId } : {}),
          turnId: created.turn.id,
          source: "post_commit",
          code: "post_commit_processing_failed",
          message: normalized.message,
          ...(normalized.details === undefined ? {} : { details: normalized.details }),
          ...(normalized.stack ? { stack: normalized.stack } : {}),
          recoverable: true,
        })
        return
      }
      const persisted = this.deps.store.failTurn({
        projectId: command.projectId,
        turnId: created.turn.id,
        error,
        source: "main_agent",
      })
      this.deps.sharedStore.indexSocratesTurnRetrieval(command.projectId, created.turn.id)
      for (const modelCallId of modelCallIds) {
        if (completedModelCalls.has(modelCallId)) continue
        this.deps.store.completeModelCall({ modelCallId, errorId: persisted.id })
      }
      this.emit("socrates.error.created", { error: persisted }, { ...(goalId ? { goalId } : {}), turnId: created.turn.id }, "main_agent")
      const failedAt = nowIso()
      this.emit("socrates.turn.updated", {
        turn: { ...created.turn, ...(goalId ? { goalId } : {}), status: "failed", errorId: persisted.id, updatedAt: failedAt, failedAt },
      }, { ...(goalId ? { goalId } : {}), turnId: created.turn.id }, "main_agent")
    } finally {
      this.terminals.endTurn(created.turn.id)
      this.activeTurns.delete(created.turn.id)
    }
  }

  private handleToolEvent(event: SocratesAgentEvent, scope: { projectId: string; goalId: string; turnId: string }): void {
    if (event.type === "tool.call.started") {
      const toolCall = this.deps.store.createToolCall({
        id: event.toolCallId,
        ...scope,
        ...(event.modelCallId ? { modelCallId: event.modelCallId } : {}),
        ...(event.providerToolCallId ? { providerToolCallId: event.providerToolCallId } : {}),
        toolName: event.toolName,
        arguments: event.input ?? {},
        requiresApproval: event.requiresApproval,
      })
      this.emit("socrates.tool.call.updated", { toolCall }, scope, "tool")
      return
    }
    if (event.type === "tool.call.completed") {
      const toolCall = this.deps.store.completeToolCall(event.toolCallId, event.output)
      if (event.toolName !== "context_disposition") {
        this.deps.store.recordEvidence({
          ...scope,
          sourceKind: event.toolName === "bash" ? "terminal_output" : "tool_output",
          sourceId: event.toolCallId,
          title: `${event.toolName}: ${event.summary}`.slice(0, 1_000),
          content: safeRuntimeStringify(event.output),
        })
      }
      this.emit("socrates.tool.call.updated", { toolCall }, scope, "tool")
      return
    }
    if (event.type === "tool.call.failed") {
      const error = this.deps.store.recordError({
        ...scope,
        source: "tool",
        code: event.error.code,
        message: event.error.message,
        details: event.error.details,
        recoverable: event.error.recoverable,
      })
      let toolCall
      try {
        toolCall = this.deps.store.failToolCall(event.toolCallId, error.id)
      } catch (lookupError) {
        if (!(lookupError instanceof SocratesError) || lookupError.code !== "socrates_tool_call_not_found") throw lookupError
        this.deps.store.createToolCall({
          id: event.toolCallId,
          ...scope,
          ...(event.modelCallId ? { modelCallId: event.modelCallId } : {}),
          ...(event.providerToolCallId ? { providerToolCallId: event.providerToolCallId } : {}),
          toolName: event.toolName,
          arguments: {},
          requiresApproval: false,
        })
        toolCall = this.deps.store.failToolCall(event.toolCallId, error.id)
      }
      this.emit("socrates.tool.call.updated", { toolCall }, scope, "tool")
      this.emit("socrates.error.created", { error }, scope, "tool")
    }
  }

  private emit<T extends SocratesServerEvent["type"]>(
    type: T,
    payload: Extract<SocratesServerEvent, { type: T }>["payload"],
    scope: { projectId?: string; goalId?: string; turnId?: string },
    source = "server",
    fallbackSocket?: WebSocket,
  ): void {
    const projectId = scope.projectId ?? this.deps.store.resolveRuntimeProjectId(scope.goalId)
    const persisted = this.deps.store.appendRuntimeEvent({
      projectId,
      ...(scope.goalId ? { goalId: scope.goalId } : {}),
      ...(scope.turnId ? { turnId: scope.turnId } : {}),
      type,
      source,
      payload,
    })
    const eventScope = {
      ...(scope.goalId ? { goalId: scope.goalId } : {}),
      ...(scope.turnId ? { turnId: scope.turnId } : {}),
    }
    const event = socratesServerEventSchema.parse({
      id: persisted.id,
      schemaVersion: 3,
      timestamp: persisted.createdAt,
      ...eventScope,
      actor: actorForRuntimeSource(source),
      type,
      payload,
    })
    this.subscriptions.emit(event, fallbackSocket)
  }

  private emitActivity(
    activity: SocratesLiveActivity,
    scope: { projectId?: string; goalId?: string; turnId: string },
    fallbackSocket?: WebSocket,
  ): void {
    this.emit("socrates.activity.updated", { activity }, scope, "system", fallbackSocket)
  }

  private emitUntyped(
    type: SocratesServerEvent["type"],
    payload: SocratesServerEvent["payload"],
    scope: { projectId?: string; goalId?: string; turnId?: string },
    source: string,
  ): void {
    const projectId = scope.projectId ?? this.deps.store.resolveRuntimeProjectId(scope.goalId)
    const persisted = this.deps.store.appendRuntimeEvent({
      projectId,
      ...(scope.goalId ? { goalId: scope.goalId } : {}),
      ...(scope.turnId ? { turnId: scope.turnId } : {}),
      type,
      source,
      payload,
    })
    const event = socratesServerEventSchema.parse({
      id: persisted.id,
      schemaVersion: 3,
      timestamp: persisted.createdAt,
      ...(scope.goalId ? { goalId: scope.goalId } : {}),
      ...(scope.turnId ? { turnId: scope.turnId } : {}),
      actor: actorForRuntimeSource(source),
      type,
      payload,
    })
    this.subscriptions.emit(event)
  }
}
