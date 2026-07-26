import type { McpRuntime } from "@socrates/mcp"
import {
  isShellSessionResetError,
  isWorkspaceMutationLocked,
  shouldSerializeBashInput,
  withWorkspaceMutationLock,
} from "@socrates/workspace"
import { createMainToolExecutors } from "../services/mainToolExecutors"
import type { SocratesStore } from "../services/store"
import type { ActiveTurns } from "./activeTurns"
import type { ConversationTerminalManager } from "./conversationTerminals"

export const createClassicToolExecutors = (
  store: SocratesStore,
  projectId: string,
  turnId: string,
  activeTurns: ActiveTurns,
  terminals: ConversationTerminalManager,
  mcpRuntime?: McpRuntime,
  options: { exposeMcpServer?: (serverId: string) => void; goalId?: string } = {},
) => createMainToolExecutors({
  store,
  projectId,
  turnId,
  activeTurns,
  ...(mcpRuntime ? { mcpRuntime } : {}),
  ...(options.exposeMcpServer ? { exposeMcpServer: options.exposeMcpServer } : {}),
  runtime: {
    bash: async (input, context) => {
      const toolCallId = context.toolCallId ?? "unknown"
      store.createShellCommand({
        toolCallId,
        conversationId: context.conversationId,
        sessionId: context.sessionId,
        turnId: context.turnId,
        command: input.command ?? `${input.operation ?? "run"} ${input.processId ?? ""}`.trim(),
        cwd: input.cwd ?? context.workspacePath,
        metadata: { operation: input.operation ?? "run", processId: input.processId, terminalId: input.terminalId },
      })
      try {
        const execute = () => terminals.executeBash(input, context, activeTurns)
        const waiting = shouldSerializeBashInput(input) && isWorkspaceMutationLocked(context.workspacePath)
        const output = shouldSerializeBashInput(input)
          ? await withWorkspaceMutationLock(context.workspacePath, async () => {
              if (waiting) context.onOutput?.({ stream: "log", text: "Waiting for another workspace mutation in this project to finish...\n" })
              return execute()
            })
          : await execute()
        store.updateShellCommandMetadata(toolCallId, {
          operation: output.operation ?? input.operation ?? "run",
          platform: output.shell.platform,
          shellKind: output.shell.kind,
          shellExecutable: output.shell.executable,
          processId: output.process?.processId,
          processStatus: output.process?.status,
          nextOutputSequence: output.process?.nextOutputSequence,
          terminalId: output.terminal?.terminalId,
          terminalName: output.terminal?.name,
          terminalStatus: output.terminal?.status,
          autoDetached: output.terminal?.autoDetached,
          awaitingInput: output.terminal?.awaitingInput,
          lastPrompt: output.terminal?.lastPrompt,
        })
        if (output.timedOut && !output.terminal) activeTurns.resetShellSession(context.turnId, context.workspacePath)
        return output
      } catch (error) {
        if (isShellSessionResetError(error)) activeTurns.resetShellSession(context.turnId, context.workspacePath)
        store.failShellCommand(toolCallId)
        throw error
      }
    },
    wait: async (input, context) => {
      const registered = store.registerTerminalWait({
        projectId,
        conversationId: context.conversationId,
        sessionId: context.sessionId,
        turnId: context.turnId,
        runtimeConfig: context.runtimeConfig,
        wait: input,
      })
      return {
        status: registered.status,
        terminalNames: input.terminalNames,
        wakeOn: input.wakeOn,
        reason: input.reason,
        message: registered.message,
      }
    },
    traceScope: (context) => ({ presentedConversationId: context.conversationId, ...(options.goalId ? { goalId: options.goalId } : {}) }),
    runSkills: async (input, context) => input.operation === "preview_import" || input.operation === "commit_import"
      ? store.runSkillsImportTool(projectId, input, {
          conversationId: context.conversationId,
          turnId: context.turnId,
          ...(context.abortSignal ? { signal: context.abortSignal } : {}),
        })
      : store.runSkillsTool(projectId, input),
    createMemoryNote: async (input, context) => store.createMemoryNote(projectId, input, {
      conversationId: context.conversationId,
      sessionId: context.sessionId,
      turnId: context.turnId,
    }),
    mcpSessionKey: (context) => context.conversationId,
  },
})
