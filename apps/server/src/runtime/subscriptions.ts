import type { WebSocket } from "ws"
import type { SocratesServerEvent } from "@socrates/contracts"
import { sendSocratesEvent } from "./eventSender"

export class SocratesSubscriptions {
  private readonly sockets = new Set<WebSocket>()
  private readonly closeHandlerAttached = new WeakSet<WebSocket>()

  subscribe(socket: WebSocket): void {
    this.ensureCloseHandler(socket)
    this.sockets.add(socket)
  }

  unsubscribe(socket: WebSocket): void {
    this.sockets.delete(socket)
  }

  isSubscribed(socket: WebSocket): boolean {
    return this.sockets.has(socket)
  }

  emit(event: SocratesServerEvent, fallbackSocket?: WebSocket): void {
    const recipients = new Set(this.sockets)
    if (fallbackSocket) recipients.add(fallbackSocket)
    for (const socket of recipients) sendSocratesEvent(socket, event)
  }

  send(socket: WebSocket, event: SocratesServerEvent): void {
    sendSocratesEvent(socket, event)
  }

  private ensureCloseHandler(socket: WebSocket): void {
    if (this.closeHandlerAttached.has(socket)) return
    this.closeHandlerAttached.add(socket)
    socket.on("close", () => this.unsubscribe(socket))
  }
}
