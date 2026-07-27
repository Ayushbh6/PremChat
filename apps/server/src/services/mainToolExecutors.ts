import type { ProjectResource, TraceRetrieveMainToolInput } from "@socrates/contracts"
import type { ToolExecutors } from "@socrates/core"
import type { McpRuntime } from "@socrates/mcp"
import { SocratesError } from "@socrates/shared"
import {
  applyPatchWorkspace,
  editWorkspace,
  readWorkspacePath,
  searchWorkspace,
  withWorkspaceMutationLock,
} from "@socrates/workspace"
import type { SocratesStore } from "./store"
import { currentRuntimeTime } from "./store/runtimeContext"
import type { ActiveTurns } from "../ws/activeTurns"
import { fetchUrlForTool } from "../ws/urlFetch"

const docsMutationOperations = new Set(["edit", "patch_section"])

export type MainToolRuntimeAdapter = Readonly<{
  bash: ToolExecutors["bash"]
  wait?: NonNullable<ToolExecutors["wait"]>
  traceScope: (context: Parameters<ToolExecutors["trace_retrieve"]>[1]) => {
    presentedConversationId: string
    goalId?: string
  }
  runSkills: ToolExecutors["skills"]
  createMemoryNote: NonNullable<ToolExecutors["memory_note"]>
  mcpSessionKey: (context: Parameters<NonNullable<ToolExecutors["mcp_dynamic"]>>[1]) => string
}>

export type MainToolExecutorsInput = Readonly<{
  store: SocratesStore
  projectId: string
  turnId: string
  activeTurns: ActiveTurns
  runtime: MainToolRuntimeAdapter
  mcpRuntime?: McpRuntime
  exposeMcpServer?: (serverId: string) => void
}>

/**
 * One shared main-Socrates executor contract. Runtime adapters own only the
 * physical Terminal/wait and source-coordinate differences between views.
 */
export const createMainToolExecutors = (input: MainToolExecutorsInput): ToolExecutors => {
  let skillsDiscoverySeen = false
  let skillsAvailable: boolean | undefined
  const withFreshness = <C extends object>(context: C): C & { fileFreshness?: ReturnType<ActiveTurns["getFileFreshness"]> } => {
    const tracker = input.activeTurns.getFileFreshness(input.turnId)
    return tracker ? { ...context, fileFreshness: tracker } : context
  }
  const hasVisibleSkills = (): boolean => {
    skillsAvailable ??= input.store.runSkillsTool(input.projectId, { operation: "list", n: 1 }).totalMatches > 0
    return skillsAvailable
  }
  const requireSkillsDiscovery = (toolName: "read" | "list_project_resources", resourcePath?: string): void => {
    if (skillsDiscoverySeen || !hasVisibleSkills()) return
    throw new SocratesError(
      "skills_discovery_required",
      `Before using ${toolName} for uploaded project resources, call skills({ operation: "list" }) first, then describe the exact relevant skill id if one applies.`,
      {
        recoverable: true,
        details: { toolName, ...(resourcePath ? { resourcePath } : {}), requiredTool: "skills", requiredOperation: "list" },
      },
    )
  }

  return {
    read: (toolInput, context) => {
      if (isProjectResourceRead(toolInput.path)) requireSkillsDiscovery("read", toolInput.path)
      return readWorkspacePath(toolInput, withFreshness(context))
    },
    search: (toolInput, context) => searchWorkspace(toolInput, context),
    url_fetch: (toolInput, context) => fetchUrlForTool(toolInput, context.abortSignal),
    edit: (toolInput, context) => editWorkspace(toolInput, withFreshness(context)),
    apply_patch: (toolInput, context) => applyPatchWorkspace(toolInput, withFreshness(context)),
    bash: input.runtime.bash,
    ...(input.runtime.wait ? { wait: input.runtime.wait } : {}),
    current_time: async () => currentRuntimeTime(),
    trace_retrieve: async (toolInput, context) => {
      const scope = input.runtime.traceScope(context)
      if (!scope.goalId) throw new SocratesError("trace_goal_context_unavailable", "The current goal context is unavailable.", { recoverable: true })
      return input.store.retrieveUnifiedMainToolTraces({
        projectId: input.projectId,
        presentedConversationId: scope.presentedConversationId,
        goalId: scope.goalId,
        request: toolInput as TraceRetrieveMainToolInput,
      })
    },
    tool_docs: async (toolInput) => input.store.runToolDocsTool(input.projectId, toolInput),
    skills: async (toolInput, context) => {
      const output = await input.runtime.runSkills(toolInput, context)
      if (["list", "describe", "search", "read"].includes(toolInput.operation)) skillsDiscoverySeen = true
      return output
    },
    skill_manager: async (toolInput, context) => {
      if (toolInput.operation === "create") {
        const { skill } = await input.store.buildProjectSkill(
          input.projectId,
          { name: toolInput.name, request: toolInput.request },
          { conversationId: context.conversationId, sessionId: context.sessionId, turnId: context.turnId },
        )
        return { operation: "create", name: skill.name, scope: "project", status: "created" }
      }
      const deleted = input.store.deleteProjectSkill(input.projectId, toolInput.name)
      return { operation: "delete", name: deleted.deletedSkillName, scope: "project", status: "deleted" }
    },
    memory_note: input.runtime.createMemoryNote,
    project_docs: (toolInput, context) => docsMutationOperations.has(toolInput.operation)
      ? withWorkspaceMutationLock(context.workspacePath, async () => input.store.runProjectDocsTool(input.projectId, context.workspacePath, toolInput))
      : Promise.resolve(input.store.runProjectDocsTool(input.projectId, context.workspacePath, toolInput)),
    repo_docs: (toolInput, context) => docsMutationOperations.has(toolInput.operation)
      ? withWorkspaceMutationLock(context.workspacePath, async () => input.store.runRepoDocsTool(input.projectId, context.workspacePath, toolInput))
      : Promise.resolve(input.store.runRepoDocsTool(input.projectId, context.workspacePath, toolInput)),
    soul: async (toolInput) => input.store.runSoulTool(input.projectId, toolInput),
    user_profile: async (toolInput) => input.store.runUserProfileTool(input.projectId, toolInput),
    list_project_resources: async (toolInput) => {
      requireSkillsDiscovery("list_project_resources")
      return listProjectResourcesForTool(input.store, input.projectId, toolInput)
    },
    mcp_registry: async (toolInput, context, resolvedSecretEnv) => {
      if (!input.mcpRuntime) throw new SocratesError("mcp_runtime_unavailable", "MCP runtime is not available.", { recoverable: true })
      const output = await input.mcpRuntime.handleRegistryTool(toolInput, {
        workspacePath: context.workspacePath,
        ...(resolvedSecretEnv ? { resolvedSecretEnv } : {}),
      })
      if (output.tools && output.tools.length > 0) {
        input.exposeMcpServer?.(output.server?.id ?? ("id" in toolInput ? toolInput.id : undefined) ?? ("name" in toolInput ? toolInput.name : undefined) ?? "playwright")
      }
      return output
    },
    mcp_dynamic: (toolInput, context) => {
      if (!input.mcpRuntime) throw new SocratesError("mcp_runtime_unavailable", "MCP runtime is not available.", { recoverable: true })
      return input.mcpRuntime.callDynamicTool(toolInput.dynamicName, toolInput.input, {
        cwd: context.workspacePath,
        sessionKey: input.runtime.mcpSessionKey(context),
        workspacePath: context.workspacePath,
      })
    },
  }
}

const isProjectResourceRead = (value: string): boolean => {
  const normalized = value.replaceAll("\\", "/")
  return normalized.startsWith(".socrates/resources/") || normalized.includes("/.socrates/resources/")
}

const listProjectResourcesForTool = (
  store: SocratesStore,
  projectId: string,
  input: Parameters<ToolExecutors["list_project_resources"]>[0],
) => {
  const charLimit = 20_000
  const limit = input.limit ?? 25
  const allResources = store.listResources(projectId).filter((resource) => input.kind ? resource.kind === input.kind : true)
  const resources: Array<Omit<ProjectResource, "projectId">> = []
  for (const resource of allResources) {
    if (resources.length >= limit) break
    const next = {
      id: resource.id,
      name: resource.name,
      kind: resource.kind,
      source: resource.source,
      ...(resource.uri ? { uri: resource.uri } : {}),
      ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
      ...(resource.sizeBytes === undefined ? {} : { sizeBytes: resource.sizeBytes }),
      status: resource.status,
    }
    if (JSON.stringify([...resources, next]).length > charLimit) break
    resources.push(next)
  }
  const originalLength = JSON.stringify(allResources).length
  const returnedLength = JSON.stringify(resources).length
  const hiddenCount = allResources.length - resources.length
  return {
    resources,
    summary: hiddenCount > 0 ? `Listed ${resources.length} of ${allResources.length} project resources.` : `Listed ${resources.length} project resources.`,
    totalResources: allResources.length,
    truncation: { truncated: hiddenCount > 0, charLimit, originalLength, returnedLength },
    ...(hiddenCount > 0 ? { warnings: [`${hiddenCount} resources were omitted by the output cap.`] } : {}),
  }
}
