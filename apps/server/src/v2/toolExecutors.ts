import type { McpRuntime } from "@socrates/mcp"
import {
  isWorkspaceMutationLocked,
  shouldSerializeBashInput,
  withWorkspaceMutationLock,
} from "@socrates/workspace"
import { createMainToolExecutors } from "../services/mainToolExecutors"
import type { V2FlowStore } from "../services/v2/flowStore"
import type { SocratesStore } from "../services/store"
import type { ActiveTurns } from "../ws/activeTurns"
import type { V2TerminalRuntime } from "./terminalRuntime"

export type V2ToolExecutorsInput = {
  flowStore: V2FlowStore
  sharedStore: SocratesStore
  activeTurns: ActiveTurns
  terminals: V2TerminalRuntime
  projectId: string
  flowId: string
  goalId: string
  turnId: string
  workspacePath: string
  mcpRuntime?: McpRuntime
  exposeMcpServer?: (serverId: string) => void
}

/** Flow supplies only source-owned Terminal, wait, skill-archive, and memory-note adapters. */
export const createV2ToolExecutors = (input: V2ToolExecutorsInput) => createMainToolExecutors({
  store: input.sharedStore,
  projectId: input.projectId,
  turnId: input.turnId,
  activeTurns: input.activeTurns,
  ...(input.mcpRuntime ? { mcpRuntime: input.mcpRuntime } : {}),
  ...(input.exposeMcpServer ? { exposeMcpServer: input.exposeMcpServer } : {}),
  runtime: {
    bash: async (toolInput, context) => {
      const execute = () => input.terminals.execute(toolInput, {
        projectId: input.projectId,
        flowId: input.flowId,
        goalId: input.goalId,
        turnId: input.turnId,
        workspacePath: input.workspacePath,
      }, context)
      if (!shouldSerializeBashInput(toolInput)) return execute()
      const waiting = isWorkspaceMutationLocked(input.workspacePath)
      return withWorkspaceMutationLock(input.workspacePath, async () => {
        if (waiting) context.onOutput?.({ stream: "log", text: "Waiting for another workspace mutation in this project to finish...\n" })
        return execute()
      })
    },
    wait: async (toolInput) => input.terminals.wait(toolInput, {
      projectId: input.projectId,
      flowId: input.flowId,
      goalId: input.goalId,
      turnId: input.turnId,
    }),
    traceScope: () => ({ presentedConversationId: input.flowId, goalId: input.goalId }),
    runSkills: async (toolInput, context) => {
      const attachedArchive = toolInput.operation === "preview_import" && toolInput.attachmentPath
        ? input.flowStore.readCurrentTurnSkillZip({
            projectId: input.projectId,
            flowId: input.flowId,
            turnId: input.turnId,
            attachmentPath: toolInput.attachmentPath,
          })
        : undefined
      return toolInput.operation === "preview_import" || toolInput.operation === "commit_import"
        ? input.sharedStore.runSkillsImportTool(input.projectId, toolInput, {
            conversationId: input.flowId,
            turnId: input.turnId,
            ...(context.abortSignal ? { signal: context.abortSignal } : {}),
            ...(attachedArchive ? { attachedArchive } : {}),
          })
        : input.sharedStore.runSkillsTool(input.projectId, toolInput)
    },
    createMemoryNote: async (toolInput) => {
      const source = input.flowStore.getTurnMemorySource(input.projectId, input.flowId, input.turnId)
      return input.sharedStore.createMemoryNote(input.projectId, toolInput, {
        conversationId: input.flowId,
        sessionId: input.turnId,
        turnId: input.turnId,
        ...source,
        sourceRuntime: "v2_flow",
        appendClassicEvent: false,
      })
    },
    mcpSessionKey: () => input.flowId,
  },
})
