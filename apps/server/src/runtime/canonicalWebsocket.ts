import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import websocket from "@fastify/websocket"
import type { WebSocket } from "ws"
import {
  globalSocratesClientCommandSchema,
  globalSocratesServerEventSchema,
  type GlobalSocratesClientCommand,
  type GlobalSocratesServerEvent,
  type RuntimeConfig,
} from "@socrates/contracts"
import type { SocratesAgent } from "@socrates/core"
import { createId, nowIso, SocratesError } from "@socrates/shared"
import { FileFreshnessTracker } from "@socrates/workspace"
import { executeCanonicalTask } from "./canonicalExecution"
import { resolveCanonicalGoal } from "./canonicalGoalResolution"
import { CanonicalInteractionCoordinator } from "./canonicalInteractions"
import type { CanonicalSocratesStore } from "../services/canonical/canonicalSocratesStore"
import { createCanonicalToolExecutors } from "../services/canonical/canonicalToolExecutors"

export type CanonicalSocratesWebSocketRuntime = {
  shutdown: () => Promise<boolean>
}

/**
 * The fresh global WebSocket transport. It has one global subscription group
 * because app_state owns one foreground task; a socket is never a semantic
 * project or conversation container.
 */
export class CanonicalSocratesRuntime {
  private readonly sockets = new Set<WebSocket>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly executions = new Map<string, Promise<void>>()
  private readonly interactions: CanonicalInteractionCoordinator

  constructor(private readonly input: { store: CanonicalSocratesStore; agent: SocratesAgent; socratesHome: string }) {
    this.interactions = new CanonicalInteractionCoordinator(input.store)
  }

  subscribe(socket: WebSocket, afterSequence = 0): void {
    this.track(socket)
    this.send(socket, { type: "socrates.global.connection.ready", payload: { connectionId: createId("conn"), serverTime: nowIso() } })
    this.replay(socket, afterSequence)
    this.send(socket, { type: "socrates.global.snapshot", payload: { snapshot: this.input.store.getSnapshot() } })
  }

  unsubscribe(socket: WebSocket): void {
    this.sockets.delete(socket)
  }

  async dispatch(socket: WebSocket, command: GlobalSocratesClientCommand): Promise<void> {
    if (command.type === "socrates.global.subscribe") return this.subscribe(socket, command.payload.afterSequence ?? 0)
    if (command.type === "socrates.global.unsubscribe") return this.unsubscribe(socket)
    if (command.type === "socrates.global.replay") return this.replay(socket, command.payload.afterSequence)
    if (command.type === "socrates.global.task.cancel") return this.cancel(command.payload.taskId, command.payload.reason)
    if (command.type === "socrates.global.interaction.resolve") {
      this.interactions.resolve({
        interactionId: command.payload.interactionId,
        decision: command.payload.input.decision,
        ...(command.payload.input.publicResolution ? { publicResolution: command.payload.input.publicResolution } : {}),
        ...(command.payload.input.secret ? { secret: command.payload.input.secret } : {}),
      })
      this.publishSnapshot()
      return
    }
    await this.startTask(socket, command.payload.content, command.payload.runtimeConfig)
  }

  async shutdown(): Promise<boolean> {
    for (const controller of this.controllers.values()) controller.abort()
    const pending = [...this.executions.values()]
    await Promise.allSettled(pending)
    return true
  }

  private async startTask(socket: WebSocket, content: string, runtimeConfig: RuntimeConfig): Promise<void> {
    const existing = this.input.store.getSnapshot().activeTask
    if (existing && ["routing", "running", "awaiting_input"].includes(existing.status)) {
      throw new SocratesError("global_task_already_active", "Socrates is already working on the current request. Stop it before sending another.", { recoverable: true })
    }
    this.track(socket)
    const task = this.input.store.createRootTask({ content, access: this.input.store.accessForNextTask() })
    const controller = new AbortController()
    this.controllers.set(task.id, controller)
    this.recordActivity(task.id, "routing", "Gathering relevant memory.")
    this.publishSnapshot()

    const execution = this.runTask(task.id, content, runtimeConfig, controller.signal)
      .catch((error) => this.publishError(socket, error))
      .finally(() => {
        this.controllers.delete(task.id)
        this.executions.delete(task.id)
        this.publishSnapshot()
      })
    this.executions.set(task.id, execution)
    void execution
  }

  private async runTask(taskId: string, userMessage: string, runtimeConfig: RuntimeConfig, abortSignal: AbortSignal): Promise<void> {
    const initial = this.input.store.getSnapshot().activeTask
    if (!initial || initial.id !== taskId) throw new SocratesError("canonical_task_missing", "The task disappeared before goal resolution.")
    const workPath = path.join(this.input.socratesHome, "work", taskId)
    fs.mkdirSync(workPath, { recursive: true, mode: 0o700 })
    const resolution = await resolveCanonicalGoal({
      store: this.input.store,
      agent: this.input.agent,
      task: initial,
      userMessage,
      runtimeConfig,
      workspacePath: workPath,
      abortSignal,
    })
    if (resolution.kind === "clarification") {
      this.recordActivity(taskId, "waiting", "Socrates needs a clarification.")
      this.publishSnapshot()
      return
    }
    this.recordActivity(taskId, "working", "Socrates is working.")
    this.publishSnapshot()
    const scope = this.input.store.getTaskExecutionScope(taskId)
    const resourceWorkspace = scope.resources.find((resource) =>
      resource.availability === "available" && resource.canonicalPath && isUsableResourceRoot(resource.canonicalPath),
    )?.canonicalPath
    const taskWorkspacePath = resourceWorkspace ?? workPath
    await executeCanonicalTask({
      store: this.input.store,
      agent: this.input.agent,
      task: resolution.task,
      goalId: resolution.goalId,
      userMessage,
      runtimeConfig,
      workspacePath: taskWorkspacePath,
      filesystemAuthorization: scope.filesystemAuthorization,
      toolExecutors: createCanonicalToolExecutors({
        store: this.input.store,
        taskId,
        filesystemAuthorization: scope.filesystemAuthorization,
      }),
      fileFreshness: new FileFreshnessTracker(),
      abortSignal,
      streamInput: {
        requestApproval: (request) => this.interactions.waitForApproval(taskId, request, abortSignal),
        requestCredentialInput: (request) => this.interactions.requestCredential(taskId, request, abortSignal),
      },
      onApprovalRequested: (request) => {
        this.interactions.registerApproval(taskId, request)
        this.publishSnapshot()
      },
      onActivity: ({ phase, sentence }) => {
        this.recordActivity(taskId, phase, sentence)
        this.publishSnapshot()
      },
    })
  }

  private cancel(taskId: string, reason?: string): void {
    const controller = this.controllers.get(taskId)
    if (!controller) throw new SocratesError("active_task_not_found", "That task is no longer active.", { recoverable: true })
    this.interactions.cancelTask(taskId, reason ?? "The task was cancelled.")
    controller.abort(reason)
  }

  private recordActivity(taskId: string, phase: "routing" | "working" | "tool" | "waiting" | "finalizing" | "failed", sentence: string): void {
    this.input.store.recordSafeActivity({ taskId, phase, sentence })
    this.publishEventsSince(this.input.store.getSnapshot().latestEventSequence - 1)
  }

  private replay(socket: WebSocket, afterSequence: number): void {
    for (const event of this.input.store.listEvents(afterSequence, 2_000)) this.send(socket, { type: "socrates.global.event", payload: event })
  }

  private publishEventsSince(afterSequence: number): void {
    for (const event of this.input.store.listEvents(afterSequence, 2_000)) this.broadcast({ type: "socrates.global.event", payload: event })
  }

  private publishSnapshot(): void {
    this.broadcast({ type: "socrates.global.snapshot", payload: { snapshot: this.input.store.getSnapshot() } })
  }

  private publishError(socket: WebSocket, error: unknown): void {
    const normalized = error instanceof SocratesError
      ? { code: error.code, message: error.message, recoverable: error.recoverable }
      : { code: "canonical_runtime_failed", message: error instanceof Error ? error.message : String(error), recoverable: true }
    this.send(socket, { type: "socrates.global.error", payload: normalized })
  }

  private track(socket: WebSocket): void {
    if (this.sockets.has(socket)) return
    this.sockets.add(socket)
    socket.on("close", () => this.sockets.delete(socket))
  }

  private broadcast(event: GlobalSocratesServerEvent): void {
    for (const socket of this.sockets) this.send(socket, event)
  }

  private send(socket: WebSocket, event: GlobalSocratesServerEvent): void {
    if (socket.readyState !== 1) return
    socket.send(JSON.stringify(globalSocratesServerEventSchema.parse(event)))
  }
}

const isUsableResourceRoot = (candidate: string): boolean => {
  try {
    return fs.statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

export const registerCanonicalSocratesWebSocketRoutes = async (
  app: FastifyInstance,
  input: ConstructorParameters<typeof CanonicalSocratesRuntime>[0],
): Promise<CanonicalSocratesWebSocketRuntime> => {
  if (!app.hasDecorator("websocketServer")) await app.register(websocket)
  const runtime = new CanonicalSocratesRuntime(input)
  app.get("/api/socrates/ws", { websocket: true }, (socket) => {
    socket.on("message", (raw) => {
      void handleCanonicalSocratesInboundMessage(socket, runtime, raw.toString())
    })
  })
  return { shutdown: () => runtime.shutdown() }
}

export const handleCanonicalSocratesInboundMessage = async (socket: WebSocket, runtime: CanonicalSocratesRuntime, raw: string): Promise<void> => {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    socket.close(1003, "Socrates websocket messages must be valid JSON.")
    return
  }
  const command = globalSocratesClientCommandSchema.safeParse(value)
  if (!command.success) {
    socket.send(JSON.stringify(globalSocratesServerEventSchema.parse({
      type: "socrates.global.error",
      payload: { code: "invalid_global_socrates_command", message: "WebSocket command did not match the canonical global Socrates contract.", recoverable: true },
    })))
    return
  }
  try {
    await runtime.dispatch(socket, command.data)
  } catch (error) {
    const normalized = error instanceof SocratesError
      ? { code: error.code, message: error.message, recoverable: error.recoverable }
      : { code: "canonical_runtime_failed", message: error instanceof Error ? error.message : String(error), recoverable: true }
    socket.send(JSON.stringify(globalSocratesServerEventSchema.parse({ type: "socrates.global.error", payload: normalized })))
  }
}
