import type { FastifyInstance } from "fastify"
import websocket from "@fastify/websocket"
import type { WebSocket } from "ws"
import { socratesClientCommandSchema, type SocratesClientCommand } from "@socrates/contracts"
import { SocratesError } from "@socrates/shared"
import { SocratesExecutionRuntime, type SocratesExecutionRuntimeDeps } from "./runtime"

export type SocratesWebSocketRuntime = {
  runtime: SocratesExecutionRuntime
  subscriptions: SocratesExecutionRuntime["subscriptions"]
  shutdown: () => Promise<boolean>
}

export const registerSocratesWebSocketRoutes = async (
  app: FastifyInstance,
  deps: SocratesExecutionRuntimeDeps,
): Promise<SocratesWebSocketRuntime> => {
  if (!app.hasDecorator("websocketServer")) await app.register(websocket)
  const runtime = new SocratesExecutionRuntime(deps)
  await runtime.initialize()

  app.get("/api/socrates/ws", { websocket: true }, (socket) => {
    socket.on("message", (raw) => {
      void handleSocratesInboundMessage(socket, runtime, raw.toString())
    })
  })

  return {
    runtime,
    subscriptions: runtime.subscriptions,
    shutdown: () => runtime.shutdown(),
  }
}

export const handleSocratesInboundMessage = async (
  socket: WebSocket,
  runtime: SocratesExecutionRuntime,
  raw: string,
): Promise<void> => {
  let parsedJson: unknown
  try {
    // Never log raw socket input: credential submissions are ephemeral secrets.
    parsedJson = JSON.parse(raw)
  } catch {
    socket.close(1003, "Socrates websocket messages must be valid JSON.")
    return
  }

  const parsed = socratesClientCommandSchema.safeParse(parsedJson)
  if (!parsed.success) {
    runtime.emitCommandError(socket, untrustedScope(parsedJson), new SocratesError(
      "invalid_socrates_websocket_command",
      "Socrates websocket command did not match the contract.",
      { details: parsed.error.flatten(), recoverable: true },
    ))
    return
  }

  const command = parsed.data
  try {
    switch (command.type) {
      case "socrates.subscribe":
        runtime.subscribe(socket, command)
        return
      case "socrates.unsubscribe":
        runtime.unsubscribe(socket)
        return
      case "socrates.message.send":
        await runtime.startTurn(socket, command)
        return
      case "socrates.routing.clarification.respond":
        await runtime.respondToClarification(socket, command)
        return
      case "socrates.goal.update":
        runtime.updateFocus(command)
        return
      case "socrates.turn.cancel":
        runtime.cancel(command)
        return
      case "socrates.approval.decide":
        runtime.decideApproval(command)
        return
      case "socrates.feedback.submit":
        runtime.submitFeedback(command)
        return
      case "socrates.credential.input.submit":
        runtime.submitCredential(command)
        return
      case "socrates.terminal.stop":
        await runtime.stopTerminal(command)
        return
      case "socrates.terminal.input":
        await runtime.inputTerminal(command)
        return
      case "socrates.terminal.resize":
        await runtime.resizeTerminal(command)
        return
      case "socrates.terminal.rename":
        runtime.renameTerminal(command)
        return
    }
  } catch (error) {
    runtime.emitCommandError(socket, commandErrorScope(command), error)
  }
}

const commandErrorScope = (command: SocratesClientCommand): { goalId?: string; turnId?: string } => {
  const payloadTurnId = "turnId" in command.payload && typeof command.payload.turnId === "string"
    ? command.payload.turnId
    : undefined
  return {
    ...(command.goalId ? { goalId: command.goalId } : {}),
    ...(command.turnId ? { turnId: command.turnId } : payloadTurnId ? { turnId: payloadTurnId } : {}),
  }
}

const untrustedScope = (value: unknown): { goalId?: string; turnId?: string } => {
  if (!value || typeof value !== "object") return {}
  const record = value as Record<string, unknown>
  return {
    ...(typeof record.goalId === "string" ? { goalId: record.goalId } : {}),
    ...(typeof record.turnId === "string" ? { turnId: record.turnId } : {}),
  }
}
