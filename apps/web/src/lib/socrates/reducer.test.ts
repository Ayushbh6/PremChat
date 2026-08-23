import { describe, expect, it } from "vitest"
import type { SocratesSnapshot, SocratesServerEvent } from "@socrates/contracts"
import { createSocratesRuntimeState, reduceSocratesEvent } from "./reducer"

const at = "2026-07-30T10:00:00.000Z"
const snapshot = {
  state: { id: "global", activeTaskId: "task_1", revision: 1, lastEventSequence: 1, createdAt: at, updatedAt: at },
  goals: [],
  latestCapsules: [],
  messages: [],
  messageWindow: { totalMessages: 0, hasEarlier: false },
  activeTask: {
    id: "task_1",
    rootTurnId: "turn_1",
    currentTurnId: "turn_1",
    status: "running",
    runtimeConfig: {},
    waitingOnTerminalIds: [],
    createdAt: at,
    updatedAt: at,
  },
  latestTask: {
    id: "task_1",
    rootTurnId: "turn_1",
    currentTurnId: "turn_1",
    status: "running",
    runtimeConfig: {},
    waitingOnTerminalIds: [],
    createdAt: at,
    updatedAt: at,
  },
  activeTurn: { id: "turn_1", ordinal: 1, status: "running", startedAt: at, updatedAt: at },
  canonicalToolCalls: [],
  activeTerminals: [],
  pendingApprovals: [],
  pendingCredentialRequests: [],
  lastEventSequence: 1,
} as unknown as SocratesSnapshot

const event = <T extends SocratesServerEvent["type"]>(
  type: T,
  payload: Extract<SocratesServerEvent, { type: T }>["payload"],
): Extract<SocratesServerEvent, { type: T }> => ({
  id: `event_${type}`,
  schemaVersion: 3,
  timestamp: at,
  actor: { type: "system" },
  type,
  payload,
} as Extract<SocratesServerEvent, { type: T }>)

describe("global Socrates reducer", () => {
  it("deduplicates and orders Terminal output", () => {
    const initial = createSocratesRuntimeState(snapshot)
    const first = reduceSocratesEvent(initial, event("socrates.terminal.output", {
      terminalId: "terminal_1",
      sequence: 2,
      stream: "stdout",
      text: "second",
      redacted: false,
    }))
    const second = reduceSocratesEvent(first, event("socrates.terminal.output", {
      terminalId: "terminal_1",
      sequence: 1,
      stream: "stdout",
      text: "first",
      redacted: false,
    }))
    const replaced = reduceSocratesEvent(second, event("socrates.terminal.output", {
      terminalId: "terminal_1",
      sequence: 2,
      stream: "stdout",
      text: "second-final",
      redacted: false,
    }))
    expect(replaced.terminalOutputs.terminal_1?.map((item) => [item.sequence, item.text])).toEqual([
      [1, "first"],
      [2, "second-final"],
    ])
  })

  it("clears active pointers and projects the terminal task status", () => {
    const initial = createSocratesRuntimeState(snapshot)
    const completed = reduceSocratesEvent(initial, event("socrates.turn.updated", {
      turn: { id: "turn_1", ordinal: 1, status: "completed", startedAt: at, updatedAt: at, completedAt: at },
    }))
    expect(completed.snapshot.activeTurn).toBeUndefined()
    expect(completed.snapshot.activeTask).toBeUndefined()
    expect(completed.snapshot.state.activeTaskId).toBeUndefined()
    expect(completed.snapshot.latestTask?.status).toBe("completed")
  })

  it("hydrates pending credentials from a replacement snapshot", () => {
    const initial = createSocratesRuntimeState(snapshot)
    const request = {
      id: "credential_1",
      turnId: "turn_1",
      toolCallId: "tool_1",
      serverId: "mail",
      envKey: "MAIL_TOKEN",
      source: "user_input",
      status: "pending",
      requestedAt: at,
    } as const
    const replacement = { ...snapshot, pendingCredentialRequests: [request], lastEventSequence: 9 } as unknown as SocratesSnapshot
    const hydrated = reduceSocratesEvent(initial, event("socrates.state.snapshot", { snapshot: replacement }))
    expect(hydrated.credentialRequests.credential_1).toEqual(request)
    expect(hydrated.snapshot.lastEventSequence).toBe(9)
  })

  it("clears completed work from the previous exchange when a new turn starts", () => {
    const previous = {
      ...snapshot,
      canonicalToolCalls: [{ id: "tool_previous" }],
    } as unknown as SocratesSnapshot
    const initial = createSocratesRuntimeState(previous)
    const started = reduceSocratesEvent(initial, event("socrates.turn.started", {
      turn: { id: "turn_2", ordinal: 2, status: "routing", startedAt: at, updatedAt: at },
      userMessage: {
        id: "message_2",
        turnId: "turn_2",
        ordinal: 2,
        role: "user",
        kind: "standard",
        content: "Start the next exchange.",
        status: "completed",
        createdAt: at,
        completedAt: at,
      },
    }))

    expect(started.snapshot.canonicalToolCalls).toEqual([])
    expect(started.snapshot.activeTurn?.id).toBe("turn_2")
  })
})
