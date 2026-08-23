import type { WebSocket } from "ws"
import { socratesServerEventSchema, type SocratesServerEvent } from "@socrates/contracts"
import { createId, nowIso } from "@socrates/shared"

export const makeSocratesEvent = <T extends SocratesServerEvent["type"]>(
  type: T,
  payload: Extract<SocratesServerEvent, { type: T }>["payload"],
  context: Omit<
    Extract<SocratesServerEvent, { type: T }>,
    "id" | "schemaVersion" | "timestamp" | "type" | "payload"
  >,
): Extract<SocratesServerEvent, { type: T }> =>
  socratesServerEventSchema.parse({
    id: createId("socraevent"),
    schemaVersion: 3,
    timestamp: nowIso(),
    actor: { type: "system" },
    ...context,
    type,
    payload,
  }) as Extract<SocratesServerEvent, { type: T }>

export const sendSocratesEvent = (socket: WebSocket, event: SocratesServerEvent): boolean => {
  if (socket.readyState !== 1) return false
  try {
    socket.send(JSON.stringify(event))
    return true
  } catch {
    return false
  }
}
