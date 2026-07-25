import fs from "node:fs"
import path from "node:path"
import type {
  MemoryReconciliationAction,
  MemoryRouterPostTurnResult,
  MemoryRouterPreTurnResult,
  RuntimeConfig,
  ToolExecutionResult,
  ToolName,
} from "@socrates/contracts"
import type { ModelEvent, ModelMessage, ModelProvider } from "@socrates/providers"
import { SocratesError } from "@socrates/shared"
import { renderSocratesSurfaceMap } from "@socrates/contracts"
import { buildSocratesDynamicContext, type SocratesPromptContext } from "../prompts/socratesPrompt"
import type { ToolLifecycleEvent } from "../tools/types"
import type { ToolRegistry } from "../tools/registry"
import type { SocratesAgentTurnInput, StableCachePreludeSnapshot, MemoryLoopPhase, MemoryRouterModelSettings, FrontierModelSettings } from "./SocratesAgent"
import type { ActiveGoalCard } from "./MemoryRouterAgent"

export type MemoryLoopRunResult = {
  events: ToolLifecycleEvent[]
  summary?: string
  records?: MemoryLoopToolRecord[]
  stableCachePreludeMessage?: string
  developerMessage?: string
  reconciliationActions?: MemoryReconciliationAction[]
  activeGoal?: ActiveGoalCard
}

export type MemoryLoopToolRecord = {
  toolName: ToolName
  input: unknown
  events: ToolLifecycleEvent[]
  result: ToolExecutionResult
}

export const emptyMemoryLoopRunResult = (): MemoryLoopRunResult => ({ events: [] })

export const insertStableCachePrelude = (messages: ModelMessage[], content: string): void => {
  const firstNonSystemIndex = messages.findIndex((message) => message.role !== "system")
  messages.splice(firstNonSystemIndex === -1 ? messages.length : firstNonSystemIndex, 0, {
    role: "developer",
    content,
  })
}

export const insertDynamicPromptContext = (messages: ModelMessage[], context?: SocratesPromptContext): void => {
  const content = buildSocratesDynamicContext(context)
  if (!content) return
  const stableIndex = messages.findIndex(
    (message) => message.role === "developer" && typeof message.content === "string" && message.content.includes("<socrates_stable_cache_prelude>"),
  )
  const firstNonSystemIndex = messages.findIndex((message) => message.role !== "system")
  const insertIndex = stableIndex >= 0 ? stableIndex + 1 : firstNonSystemIndex === -1 ? messages.length : firstNonSystemIndex
  messages.splice(insertIndex, 0, { role: "developer", content })
}

export const canRunMemoryLoop = (provider: ModelProvider, input: SocratesAgentTurnInput, toolRegistry: ToolRegistry): boolean =>
  typeof provider.generateStructured === "function" &&
  Boolean(toolRegistry.get("memory_note")) &&
  Boolean(input.toolExecutors && input.workspacePath && input.requestApproval && input.projectId && input.conversationId && input.sessionId && input.turnId)

export const canLoadStableCachePrelude = (input: SocratesAgentTurnInput, toolRegistry: ToolRegistry): boolean =>
  Boolean(
    input.toolExecutors &&
      input.workspacePath &&
      input.requestApproval &&
      input.projectId &&
      input.conversationId &&
      input.sessionId &&
      input.turnId &&
      toolRegistry.get("project_docs") &&
      toolRegistry.get("user_profile") &&
      toolRegistry.get("soul"),
  )

export const memoryRouterModelSettingsFor = (input: SocratesAgentTurnInput): MemoryRouterModelSettings =>
  input.memoryRouterModelSettings ?? {
    providerId: input.providerId,
    authMode: input.runtimeConfig.authMode ?? "api_key",
    modelId: input.modelId,
    thinkingEnabled: false,
    thinkingEffort: "none",
  }

export const renderActiveGoalDeveloperMessage = (goal: ActiveGoalCard): string => [
  '<socrates_active_goal source="project_goal_ledger">',
  `title: ${goal.title}`,
  `state: ${goal.state}`,
  `note: ${goal.note}`,
  "Treat this as the primary goal for the current turn. Do not expose internal goal ids.",
  "</socrates_active_goal>",
].join("\n")

export const isSameModelSelection = (runtimeConfig: RuntimeConfig, settings: FrontierModelSettings | undefined): boolean =>
  Boolean(
    settings &&
      runtimeConfig.providerId === settings.providerId &&
      runtimeConfig.modelId === settings.modelId &&
      (runtimeConfig.authMode ?? "api_key") === (settings.authMode ?? "api_key") &&
      runtimeConfig.thinkingEnabled === settings.thinkingEnabled &&
      (runtimeConfig.thinkingEffort ?? undefined) === (settings.thinkingEffort ?? undefined),
  )

export const frontierRuntimeConfig = (settings: FrontierModelSettings, current: RuntimeConfig): RuntimeConfig => ({
  ...current,
  providerId: settings.providerId,
  authMode: settings.authMode ?? "api_key",
  modelId: settings.modelId,
  thinkingEnabled: settings.thinkingEnabled,
  ...(settings.thinkingEffort ? { thinkingEffort: settings.thinkingEffort } : { thinkingEffort: undefined }),
})

export const escapeXmlAttribute = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

export const memoryRouterBaseInput = (input: SocratesAgentTurnInput, messages: ModelMessage[]) => {
  if (!input.projectId || !input.conversationId || !input.sessionId || !input.turnId || !input.workspacePath || !input.toolExecutors) {
    throw new SocratesError("memory_router_context_unavailable", "Memory Router requires complete active-turn context.", { recoverable: true })
  }
  return {
    modelSettings: memoryRouterModelSettingsFor(input),
    projectId: input.projectId,
    conversationId: input.conversationId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    workspacePath: input.workspacePath,
    ...(input.promptContext?.projectName ? { projectName: input.promptContext.projectName } : {}),
    ...(input.promptContext?.projectDescription ? { projectDescription: input.promptContext.projectDescription } : {}),
    userMessage: latestUserText(messages),
    recentMessages: messages,
    ...(input.activeGoal ? { activeGoal: input.activeGoal } : {}),
    toolExecutors: input.toolExecutors,
    ...(input.automaticMemorySearch ? { automaticMemorySearch: input.automaticMemorySearch } : {}),
    ...(input.cacheKey ? { cacheKey: input.cacheKey } : {}),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    ...(input.recordMemoryRouterRun ? { recordRun: input.recordMemoryRouterRun } : {}),
  }
}

export const stablePreludeRecallRequests = (): Array<{ toolName: ToolName; input: unknown }> => [
  { toolName: "project_docs", input: { operation: "read_section", area: "memory", sectionId: "always_apply_rules", charLimit: 10_000 } },
  { toolName: "user_profile", input: { operation: "read_section", sectionId: "global_always_apply_rules", charLimit: 10_000 } },
  { toolName: "soul", input: { operation: "read_section", sectionId: "core_identity", charLimit: 4_000 } },
  { toolName: "soul", input: { operation: "read_section", sectionId: "voice_and_presence", charLimit: 4_000 } },
  { toolName: "soul", input: { operation: "read_section", sectionId: "relationship_to_user", charLimit: 4_000 } },
]

export const routedPreTurnRecallRequests = (route: MemoryRouterPreTurnResult): Array<{ toolName: ToolName; input: unknown }> => {
  const requests: Array<{ toolName: ToolName; input: unknown }> = []
  const seen = new Set<string>()
  const stableTargets = new Set([
    "project_memory:always_apply_rules",
    "user_profile:global_always_apply_rules",
    "identity:core_identity",
    "identity:voice_and_presence",
    "identity:relationship_to_user",
  ])
  const push = (request: { toolName: ToolName; input: unknown }) => {
    const key = `${request.toolName}:${JSON.stringify(request.input)}`
    if (!seen.has(key)) {
      seen.add(key)
      requests.push(request)
    }
  }
  for (const target of route.readTargets) {
    if (stableTargets.has(`${target.surface}:${target.sectionId}`)) {
      continue
    }
    if (target.surface === "project_notes") {
      push({ toolName: "project_docs", input: { operation: "read_section", area: "notes", sectionId: target.sectionId, charLimit: 20_000 } })
    } else if (target.surface === "project_memory") {
      push({ toolName: "project_docs", input: { operation: "read_section", area: "memory", sectionId: target.sectionId, charLimit: 20_000 } })
    } else if (target.surface === "repo_docs") {
      push({ toolName: "repo_docs", input: { operation: "read_section", path: target.fileName, sectionId: target.sectionId, charLimit: 20_000 } })
    } else if (target.surface === "user_profile") {
      push({ toolName: "user_profile", input: { operation: "read_section", sectionId: target.sectionId, charLimit: 20_000 } })
    } else if (target.surface === "identity") {
      push({ toolName: "soul", input: { operation: "read_section", sectionId: target.sectionId, charLimit: 20_000 } })
    }
  }
  return requests
}

export const latestUserText = (messages: readonly ModelMessage[]): string => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== "user") {
      continue
    }
    if (typeof message.content === "string") {
      return message.content
    }
    return message.content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`)).join("\n")
  }
  return ""
}

export const memoryLoopSectionContent = (output: unknown): string | undefined => {
  const record = output && typeof output === "object" && !Array.isArray(output) ? (output as Record<string, unknown>) : undefined
  const section = record?.section && typeof record.section === "object" && !Array.isArray(record.section) ? (record.section as Record<string, unknown>) : undefined
  return typeof section?.content === "string" ? section.content : typeof record?.content === "string" ? record.content : undefined
}

export const cleanMemoryLoopText = (text: string): string => text.trim().replace(/^[-*]\s+/, "").trim()

export const isAlwaysApplyPlaceholderText = (text: string): boolean => {
  const normalized = cleanMemoryLoopText(text).toLowerCase()
  return normalized.startsWith("add at most 10") && (normalized.includes("hard") || normalized.includes("rule"))
}

export const summarizeMemoryLoop = (
  phase: MemoryLoopPhase,
  route: MemoryRouterPreTurnResult | MemoryRouterPostTurnResult,
  records: MemoryLoopToolRecord[],
  skipped: string[],
): string => {
  const routeSummary = "readTargets" in route ? `readTargets=${route.readTargets.length}` : `actions=${route.actions.length}`
  const actions = records.map((record) => `${record.toolName}:${record.result.ok ? "ok" : record.result.error?.code ?? "failed"}`)
  return [`${phase}: ${routeSummary}`, `reason: ${route.reason}`, actions.length ? `actions: ${actions.join(", ")}` : "actions: none", ...skipped].join("\n")
}

export const renderMemoryLoopDeveloperMessage = (
  phase: MemoryLoopPhase,
  route: MemoryRouterPreTurnResult | MemoryRouterPostTurnResult,
  records: MemoryLoopToolRecord[],
  skipped: string[],
  options: { stableCachePreludeApplied?: boolean } = {},
): string =>
  [
    `<socrates_memory_loop phase="${phase}">`,
    "Structured memory route was executed by the runtime before the next user-visible answer.",
    `route: ${JSON.stringify(route)}`,
    options.stableCachePreludeApplied
      ? "stable_cache_prelude: global/project always-apply rule reads were placed before conversation history for provider prompt-cache locality."
      : undefined,
    skipped.length ? `skipped: ${skipped.join("; ")}` : undefined,
    records.length > 0 ? "tool_results:" : "tool_results: none",
    ...records.map((record, index) =>
      [
        `- ${index + 1}. ${record.toolName} ${record.result.ok ? "ok" : `failed:${record.result.error?.code ?? "unknown"}`}`,
        `  input: ${clipText(JSON.stringify(record.input), 800)}`,
        `  output: ${clipText(previewMemoryLoopOutput(record.result.output), 4_000)}`,
      ].join("\n"),
    ),
    "Use these results as current context. Mention saved memory/docs actions in the answer when relevant; do not repeat the same save unless new information materially changes it.",
    "</socrates_memory_loop>",
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n")

export const renderStableCachePrelude = (records: MemoryLoopToolRecord[]): string | undefined => {
  let projectRules: string | undefined
  let globalRules: string | undefined
  const identitySections = new Map<string, string>()

  for (const record of records) {
    if (!record.result.ok || !isStableCachePreludeRecord(record)) {
      continue
    }
    const content = normalizeAlwaysApplyRules(memoryLoopSectionContent(record.result.output))
    if (isProjectAlwaysApplyRecord(record)) {
      projectRules = content
    } else if (isGlobalAlwaysApplyRecord(record)) {
      globalRules = content
    } else if (isStableIdentityRecord(record)) {
      const sectionId = objectRecord(record.input)?.sectionId
      if (typeof sectionId === "string") identitySections.set(sectionId, content)
    }
  }

  if (projectRules === undefined && globalRules === undefined && identitySections.size === 0) {
    return undefined
  }

  return renderStableCachePreludeParts({ projectRules, globalRules, identitySections })
}

export const renderStableCachePreludeParts = ({
  projectRules,
  globalRules,
  identitySections,
}: {
  projectRules: string | undefined
  globalRules: string | undefined
  identitySections: Map<string, string>
}): string =>
  [
    "<socrates_stable_cache_prelude>",
    "Stable always-apply rules loaded by the runtime before conversation/user text. Treat them as standing instructions for this turn; do not quote these tags to the user.",
    "<identity_core>",
    ...["core_identity", "voice_and_presence", "relationship_to_user"].map(
      (sectionId) => `<${sectionId}>\n${identitySections.get(sectionId) ?? "- No identity content loaded."}\n</${sectionId}>`,
    ),
    "</identity_core>",
    "<global_always_apply_rules>",
    globalRules ?? "- No global always-apply rules loaded.",
    "</global_always_apply_rules>",
    "<project_always_apply_rules>",
    projectRules ?? "- No project always-apply rules loaded.",
    "</project_always_apply_rules>",
    renderSocratesSurfaceMap(),
    "</socrates_stable_cache_prelude>",
  ].join("\n")

export const renderStableCachePreludeSnapshot = (snapshot: StableCachePreludeSnapshot): string =>
  renderStableCachePreludeParts({
    projectRules: normalizeAlwaysApplyRules(snapshot.projectRules),
    globalRules: normalizeAlwaysApplyRules(snapshot.globalRules),
    identitySections: new Map(
      Object.entries(snapshot.identitySections).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
  })

export const isStableCachePreludeRecord = (record: MemoryLoopToolRecord): boolean =>
  isProjectAlwaysApplyRecord(record) || isGlobalAlwaysApplyRecord(record) || isStableIdentityRecord(record)

export const isStableIdentityRecord = (record: MemoryLoopToolRecord): boolean => {
  if (record.toolName !== "soul") return false
  const input = objectRecord(record.input)
  return input?.operation === "read_section" && ["core_identity", "voice_and_presence", "relationship_to_user"].includes(String(input.sectionId))
}

export const isProjectAlwaysApplyRecord = (record: MemoryLoopToolRecord): boolean => {
  if (record.toolName !== "project_docs") {
    return false
  }
  const input = objectRecord(record.input)
  return (
    input?.area === "memory" &&
    input.sectionId === "always_apply_rules" &&
    (input.operation === "read_section" || input.operation === "patch_section")
  )
}

export const isGlobalAlwaysApplyRecord = (record: MemoryLoopToolRecord): boolean => {
  if (record.toolName !== "user_profile") {
    return false
  }
  const input = objectRecord(record.input)
  return input?.operation === "read_section" && input.sectionId === "global_always_apply_rules"
}

export const objectRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

export const normalizeAlwaysApplyRules = (content: string | undefined): string => {
  const rules =
    content
      ?.split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0)
      .filter((line) => !isAlwaysApplyPlaceholderText(line)) ?? []
  return rules.length > 0 ? rules.join("\n") : "- No always-apply rules recorded."
}

export const memoryLoopWarning = (phase: MemoryLoopPhase, warning: string): MemoryLoopRunResult => ({
  events: [],
  summary: `${phase}: memory loop warning: ${warning}`,
  developerMessage: `<socrates_memory_loop phase="${phase}" status="warning">\n${warning}\nContinue with the ordinary task. ${
    phase === "pre_turn"
      ? "Do not claim routed memory was successfully loaded."
      : "Do not claim final memory reconciliation succeeded."
  }\n</socrates_memory_loop>`,
})

export const previewMemoryLoopOutput = (output: unknown): string => {
  if (output === undefined) {
    return ""
  }
  if (typeof output === "string") {
    return output
  }
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

export const clipText = (text: string | undefined, limit: number): string => {
  const value = text ?? ""
  return value.length > limit ? `${value.slice(0, limit)}...` : value
}

export const nativeFollowUpMessagesForToolResult = (result: ToolExecutionResult, workspacePath: string | undefined): ModelMessage[] => {
  if (!workspacePath || !result.ok || result.toolName !== "read") {
    return []
  }
  const output = result.output
  if (!isReadImageOutput(output) || output.image.nativeVisionSupported !== true || !output.mimeType) {
    return []
  }
  const imageBytes = readWorkspaceImageForModel(workspacePath, output.path)
  if (!imageBytes) {
    return []
  }
  return [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Native image content returned by read for ${output.path}. Use this image together with the read tool metadata.`,
        },
        { type: "image", mediaType: output.mimeType, data: imageBytes, fileName: path.basename(output.path) },
      ],
    },
  ]
}

export const isReadImageOutput = (value: unknown): value is {
  path: string
  kind: "image"
  mimeType?: string
  image: { nativeVisionSupported: boolean }
} =>
  typeof value === "object" &&
  value !== null &&
  (value as { kind?: unknown }).kind === "image" &&
  typeof (value as { path?: unknown }).path === "string" &&
  typeof (value as { image?: { nativeVisionSupported?: unknown } }).image?.nativeVisionSupported === "boolean"

export const readWorkspaceImageForModel = (workspacePath: string, relativePath: string): string | undefined => {
  const workspaceRoot = path.resolve(workspacePath)
  const absolutePath = path.resolve(workspaceRoot, relativePath)
  const relative = path.relative(workspaceRoot, absolutePath)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined
  }
  try {
    return fs.readFileSync(absolutePath).toString("base64")
  } catch {
    return undefined
  }
}

export const attachModelMetadata = (event: ModelEvent, modelCallId: string | undefined, stepIndex: number): ModelEvent => ({
  ...event,
  ...(modelCallId ? { modelCallId } : {}),
  stepIndex,
}) as ModelEvent
