import type { McpRuntime } from "@socrates/mcp"
import {
  isWorkspaceMutationLocked,
  shouldSerializeBashInput,
  withWorkspaceMutationLock,
} from "@socrates/workspace"
import { createMainToolExecutors } from "../services/mainToolExecutors"
import type { GlobalSocratesStore } from "../services/socrates/socratesStore"
import type { SocratesStore } from "../services/store"
import type { ActiveTurns } from "../ws/activeTurns"
import type { SocratesTerminalRuntime } from "./terminalRuntime"

export type SocratesToolExecutorsInput = {
  socratesStore: GlobalSocratesStore
  sharedStore: SocratesStore
  activeTurns: ActiveTurns
  terminals: SocratesTerminalRuntime
  projectId: string
  goalId: string
  turnId: string
  workspacePath: string
  mcpRuntime?: McpRuntime
  exposeMcpServer?: (serverId: string) => void
}

/** Socrates supplies source-owned Terminal, wait, skill-archive, and memory-note adapters. */
export const createSocratesToolExecutors = (input: SocratesToolExecutorsInput) => createMainToolExecutors({
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
        goalId: input.goalId,
        turnId: input.turnId,
        workspacePath: context.workspacePath,
        ...(context.filesystemAuthorization ? { filesystemAuthorization: context.filesystemAuthorization } : {}),
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
      goalId: input.goalId,
      turnId: input.turnId,
    }),
    traceScope: () => ({
      presentedConversationId: "global-socrates",
      goalId: input.goalId,
      projectId: input.socratesStore.getGoalHomeProjectId(input.goalId),
    }),
    runSkills: async (toolInput, context) => {
      const attachedArchive = toolInput.operation === "preview_import" && "attachmentPath" in toolInput
        ? input.socratesStore.readCurrentTurnSkillZip({
            projectId: input.projectId,
            turnId: input.turnId,
            attachmentPath: toolInput.attachmentPath,
          })
        : undefined
      return toolInput.operation === "preview_import" || toolInput.operation === "commit_import"
        ? input.sharedStore.runSkillsImportTool(input.projectId, toolInput, {
            conversationId: "global-socrates",
            turnId: input.turnId,
            workspacePath: input.workspacePath,
            ...(context.abortSignal ? { signal: context.abortSignal } : {}),
            ...(attachedArchive ? { attachedArchive } : {}),
          })
        : input.sharedStore.runSkillsTool(input.projectId, toolInput, input.workspacePath)
    },
    createMemoryNote: async (toolInput) => {
      const source = input.socratesStore.getTurnMemorySource(input.turnId)
      return input.sharedStore.createMemoryNote(input.projectId, toolInput, {
        conversationId: "global-socrates",
        sessionId: input.turnId,
        turnId: input.turnId,
        ...source,
        sourceRuntime: "socrates",
        appendClassicEvent: false,
      })
    },
    mcpSessionKey: () => "global-socrates",
  },
})
