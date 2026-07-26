import type { SocratesAgent } from "@socrates/core"
import type { McpRuntime } from "@socrates/mcp"
import type { ModelProvider } from "@socrates/providers"
import type { SocratesStore } from "../../services/store"
import type { V2FlowStore } from "../../services/v2/flowStore"
import type { ActiveTurns } from "../activeTurns"
import type { ConversationSubscriptions } from "../conversationSubscriptions"
import type { ConversationTerminalManager } from "../conversationTerminals"
import { appendAndEmit, makeEvent } from "../eventSender"
import { handleChatMessageSend } from "./chatMessageSend"

export const resumeTerminalTask = async (
  store: SocratesStore,
  agent: SocratesAgent,
  activeTurns: ActiveTurns,
  terminals: ConversationTerminalManager,
  subscriptions: ConversationSubscriptions,
  task: ReturnType<SocratesStore["claimTerminalTaskWake"]>[number],
  mcpRuntime?: McpRuntime,
  titleProvider?: ModelProvider,
  flowStore?: V2FlowStore,
): Promise<void> => {
  const continued = store.beginTerminalTaskContinuation(task)
  if (!continued) return
  appendAndEmit(
    (event) => subscriptions.emit(event),
    store,
    makeEvent("turn.resumed", {
      turnId: continued.turnId,
      resumedFromTurnId: continued.currentTurnId,
      terminalName: continued.terminalName,
      wakeEvent: continued.wakeEvent,
    }, {
      projectId: continued.projectId,
      conversationId: continued.conversationId,
      sessionId: continued.sessionId,
      turnId: continued.turnId,
      actor: { type: "main_agent" },
    }),
    "core",
  )
  const fromSequence = store.getModelVisibleTerminalOutputSequence(continued.terminalId)
  const output = store.terminalOutputSnapshot(continued.terminalId, fromSequence, 8_000)
  store.setModelVisibleTerminalOutputSequence(continued.terminalId, output.modelVisibleNextSequence)
  const taskProgress = store.getTaskEvidence(continued.turnId, { operation: "overview", limit: 10, charLimit: 6_000 })
  const wakeContext = [
    `You were waiting for Terminal "${continued.terminalName}".`,
    `Wake reason: ${continued.wakeEvent}.`,
    `Terminal status: ${continued.terminalStatus}${continued.exitCode === null ? "" : `; exit code ${continued.exitCode}`}.`,
    `Wait reason: ${continued.reason}.`,
    output.stdout || output.stderr ? `New terminal output:\n${[output.stdout, output.stderr].filter(Boolean).join("\n")}` : "No new terminal output was captured.",
    "Task progress before this wake is authoritative lifecycle evidence. Do not restart completed, stopped, exited, or otherwise already-attempted work merely because it is absent from the active Terminal list. Verify with bash list/status only when the remaining task genuinely requires it.",
    taskProgress.content,
  ].join("\n")
  await handleChatMessageSend(undefined, store, agent, activeTurns, terminals, subscriptions, undefined, mcpRuntime, titleProvider, {
    projectId: continued.projectId,
    conversationId: continued.conversationId,
    sessionId: continued.sessionId,
    turnId: continued.turnId,
    runtimeConfigId: continued.runtimeConfigId,
    runtimeConfig: continued.runtimeConfig,
    wakeContext,
  }, flowStore)
}
