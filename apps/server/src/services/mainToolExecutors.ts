import path from "node:path"
import type { CapabilityManagerToolInput, SkillsToolInput, SkillsToolOutput, TraceRetrieveMainToolInput } from "@socrates/contracts"
import type { ToolExecutors } from "@socrates/core"
import type { McpRuntime } from "@socrates/mcp"
import { SocratesError } from "@socrates/shared"
import {
  applyPatchWorkspace,
  editWorkspace,
  readWorkspacePath,
  resolveAuthorizedPath,
  searchWorkspace,
  withWorkspaceMutationLock,
} from "@socrates/workspace"
import {
  editSocratesResource,
  isSocratesResourcePath,
  readSocratesResource,
  searchSocratesResources,
} from "./resources/socratesResourceService"
import type { SocratesStore } from "./store"
import { currentRuntimeTime } from "./store/runtimeContext"
import type { ActiveTurns } from "../ws/activeTurns"
import { fetchUrlForTool } from "../ws/urlFetch"

export type MainToolRuntimeAdapter = Readonly<{
  bash: ToolExecutors["bash"]
  wait?: NonNullable<ToolExecutors["wait"]>
  traceScope: (context: Parameters<ToolExecutors["trace_retrieve"]>[1]) => {
    presentedConversationId: string
    goalId?: string
  }
  runSkills: (input: SkillsToolInput, context: Parameters<ToolExecutors["read"]>[1]) => Promise<SkillsToolOutput>
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
  const withFreshness = <C extends object>(context: C): C & { fileFreshness?: ReturnType<ActiveTurns["getFileFreshness"]> } => {
    const tracker = input.activeTurns.getFileFreshness(input.turnId)
    return tracker ? { ...context, fileFreshness: tracker } : context
  }
  return {
    read: (toolInput, context) => isSocratesResourcePath(toolInput.path)
      ? readSocratesResource(toolInput, { ...withFreshness(context), store: input.store, ...(input.mcpRuntime ? { mcpRuntime: input.mcpRuntime } : {}) })
      : readWorkspacePath(toolInput, withFreshness(context)),
    search: (toolInput, context) => toolInput.path && isSocratesResourcePath(toolInput.path)
      ? searchSocratesResources(toolInput, { store: input.store, projectId: input.projectId, workspacePath: context.workspacePath, ...(input.mcpRuntime ? { mcpRuntime: input.mcpRuntime } : {}) })
      : searchWorkspace(toolInput, context),
    url_fetch: (toolInput, context) => fetchUrlForTool(toolInput, context.abortSignal),
    edit: (toolInput, context) => isSocratesResourcePath(toolInput.path)
      ? withWorkspaceMutationLock(context.workspacePath, () => editSocratesResource(toolInput, { ...withFreshness(context), store: input.store }))
      : editWorkspace(toolInput, withFreshness(context)),
    apply_patch: (toolInput, context) => applyPatchWorkspace(toolInput, withFreshness({
      ...context,
      workspacePath: resolveAuthorizedPath(context),
    })),
    bash: (toolInput, context) => {
      const cwd = resolveAuthorizedPath(context, toolInput.cwd)
      return input.runtime.bash(
        { ...toolInput, ...(toolInput.cwd ? { cwd: "." } : {}) },
        { ...context, workspacePath: cwd },
      )
    },
    ...(input.runtime.wait ? { wait: input.runtime.wait } : {}),
    current_time: async () => currentRuntimeTime(),
    trace_retrieve: async (toolInput, context) => {
      const scope = input.runtime.traceScope(context)
      if (!scope.goalId) throw new SocratesError("trace_goal_context_unavailable", "The current goal context is unavailable.", { recoverable: true })
      return input.store.retrieveUnifiedMainToolTraces({
        projectId: input.projectId,
        presentedConversationId: scope.presentedConversationId,
        goalId: scope.goalId,
        currentTurnId: input.turnId,
        request: toolInput as TraceRetrieveMainToolInput,
      })
    },
    capability_manager: (toolInput, context, resolvedSecretEnv) => runCapabilityManager(input, toolInput, context, resolvedSecretEnv),
    memory_note: input.runtime.createMemoryNote,
    mcp_dynamic: (toolInput, context) => {
      if (!input.mcpRuntime) throw new SocratesError("mcp_runtime_unavailable", "MCP runtime is not available.", { recoverable: true })
      preflightMcpFilesystemInputs(toolInput.input, context)
      return input.mcpRuntime.callDynamicTool(toolInput.dynamicName, toolInput.input, {
        cwd: resolveAuthorizedPath(context),
        sessionKey: input.runtime.mcpSessionKey(context),
        workspacePath: resolveAuthorizedPath(context),
      })
    },
  }
}

const mcpFilesystemKey = /^(?:path|paths|cwd|root|roots|directory|directories|file_path|file_paths)$/i

const preflightMcpFilesystemInputs = (
  value: unknown,
  context: Parameters<NonNullable<ToolExecutors["mcp_dynamic"]>>[1],
  key = "",
  depth = 0,
): void => {
  if (depth > 8 || value === null || value === undefined) return
  if (typeof value === "string") {
    const isAbsoluteLocalPath = path.isAbsolute(value) || path.win32.isAbsolute(value)
    if (mcpFilesystemKey.test(key) && isAbsoluteLocalPath) {
      resolveAuthorizedPath(context, value)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) preflightMcpFilesystemInputs(item, context, key, depth + 1)
    return
  }
  if (typeof value !== "object") return
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    preflightMcpFilesystemInputs(child, context, childKey, depth + 1)
  }
}

const runCapabilityManager = async (
  owner: MainToolExecutorsInput,
  toolInput: CapabilityManagerToolInput,
  context: Parameters<NonNullable<ToolExecutors["capability_manager"]>>[1],
  resolvedSecretEnv?: Readonly<Record<string, string>>,
) => {
  const projectScope = "scope" in toolInput && toolInput.scope === "path"
  if (toolInput.operation === "skill_create" || toolInput.operation === "skill_update") {
    const source = { conversationId: context.conversationId, sessionId: context.sessionId, turnId: context.turnId }
    const built = projectScope
      ? toolInput.operation === "skill_create"
        ? await owner.store.buildProjectSkill(owner.projectId, { name: toolInput.name, request: toolInput.request }, source)
        : await owner.store.updateProjectSkill(owner.projectId, { name: toolInput.name, request: toolInput.request }, source)
      : toolInput.operation === "skill_create"
        ? await owner.store.buildGlobalSkill({ name: toolInput.name, request: toolInput.request })
        : await owner.store.updateGlobalSkill({ name: toolInput.name, request: toolInput.request }, source)
    owner.store.enqueueCapabilityRefresh(owner.projectId)
    return { operation: toolInput.operation, status: "completed" as const, summary: `${toolInput.operation === "skill_create" ? "Created" : "Updated"} ${built.skill.name}.`, resource: `socrates://skills/${toolInput.scope}/${encodeURIComponent(built.skill.name)}`, details: built }
  }
  if (toolInput.operation === "skill_delete") {
    const deleted = projectScope ? owner.store.deleteProjectSkill(owner.projectId, toolInput.name) : owner.store.deleteGlobalSkill(toolInput.name)
    owner.store.enqueueCapabilityRefresh(owner.projectId)
    return { operation: toolInput.operation, status: "completed" as const, summary: `Deleted ${deleted.deletedSkillName}.`, details: deleted }
  }
  if (toolInput.operation === "skill_enable" || toolInput.operation === "skill_disable") {
    const enabled = toolInput.operation === "skill_enable"
    const skill = projectScope
      ? owner.store.setProjectSkillEnabled(owner.projectId, toolInput.name, enabled)
      : owner.store.setGlobalSkillEnabled(toolInput.name, enabled)
    owner.store.enqueueCapabilityRefresh(owner.projectId)
    return { operation: toolInput.operation, status: "completed" as const, summary: `${enabled ? "Enabled" : "Disabled"} ${skill.name}.`, resource: `socrates://skills/${toolInput.scope}/${encodeURIComponent(skill.name)}`, details: skill }
  }
  if (toolInput.operation === "skill_preview_import" || toolInput.operation === "skill_commit_import") {
    const skillInput = toolInput.operation === "skill_preview_import"
      ? "url" in toolInput
        ? { operation: "preview_import" as const, scope: projectScope ? "project" as const : "global" as const, url: toolInput.url }
        : { operation: "preview_import" as const, scope: projectScope ? "project" as const : "global" as const, attachmentPath: toolInput.attachmentPath }
      : { operation: "commit_import" as const, scope: projectScope ? "project" as const : "global" as const, previewId: toolInput.previewId, conflictStrategy: toolInput.conflictStrategy }
    const result = await owner.runtime.runSkills(skillInput, context)
    if (toolInput.operation === "skill_commit_import") owner.store.enqueueCapabilityRefresh(owner.projectId)
    return { operation: toolInput.operation, status: toolInput.operation === "skill_preview_import" ? "preview_ready" as const : "completed" as const, summary: result.usageHint ?? `${toolInput.operation} completed.`, details: result }
  }
  if (!owner.mcpRuntime) throw new SocratesError("mcp_runtime_unavailable", "MCP runtime is not available.", { recoverable: true })
  const mcpInput = toolInput.operation === "mcp_check"
    ? { operation: "check" as const, id: toolInput.id }
    : toolInput.operation === "mcp_delete"
      ? { operation: "delete" as const, scope: projectScope ? "project" as const : "global" as const, id: toolInput.id }
      : toolInput.operation === "mcp_configure"
        ? { operation: "configure" as const, scope: projectScope ? "project" as const : "global" as const, server: toolInput.server }
        : (() => { throw new SocratesError("capability_operation_invalid", "Unsupported capability manager operation.") })()
  const output = await owner.mcpRuntime.handleRegistryTool(mcpInput, {
    workspacePath: context.workspacePath,
    ...(resolvedSecretEnv ? { resolvedSecretEnv } : {}),
  })
  owner.store.enqueueCapabilityRefresh(owner.projectId)
  if (output.tools?.length) owner.exposeMcpServer?.(output.server?.id ?? ("id" in mcpInput ? mcpInput.id : mcpInput.server.id))
  return { operation: toolInput.operation, status: "completed" as const, summary: output.summary, ...(output.server?.id ? { resource: `socrates://capabilities/mcp:${output.server.id}` } : {}), details: output }
}
