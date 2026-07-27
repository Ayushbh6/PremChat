import fs from "node:fs"
import path from "node:path"
import type {
  RuntimeConfig,
  ToolExecutionResult,
  ToolName,
} from "@socrates/contracts"
import type { ModelEvent, ModelMessage } from "@socrates/providers"
import { renderSocratesSurfaceMap } from "@socrates/contracts"
import { buildSocratesDynamicContext, type SocratesPromptContext } from "../prompts/socratesPrompt"
import type { CapabilitySet } from "../capabilities/CapabilityCatalog"
import type { ToolLifecycleEvent } from "../tools/types"
import type { SocratesAgentTurnInput, StableCachePreludeSnapshot, FrontierModelSettings } from "./SocratesAgent"
import type { ActiveGoalCard } from "./goalContext"

export type StablePreludeRunResult = {
  events: ToolLifecycleEvent[]
  records?: StablePreludeToolRecord[]
  stableCachePreludeMessage?: string
  activeGoal?: ActiveGoalCard
}

export type StablePreludeToolRecord = {
  toolName: ToolName
  input: unknown
  events: ToolLifecycleEvent[]
  result: ToolExecutionResult
}

export const emptyStablePreludeRunResult = (): StablePreludeRunResult => ({ events: [] })

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

export const canLoadStableCachePrelude = (input: SocratesAgentTurnInput, capabilities: CapabilitySet): boolean =>
  Boolean(
    input.toolExecutors &&
      input.workspacePath &&
      input.requestApproval &&
      input.projectId &&
      input.conversationId &&
      input.sessionId &&
      input.turnId &&
      capabilities.get("project_docs") &&
      capabilities.get("user_profile") &&
      capabilities.get("soul"),
  )

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

export const stablePreludeRecallRequests = (): Array<{ toolName: ToolName; input: unknown }> => [
  { toolName: "project_docs", input: { operation: "read_section", area: "memory", sectionId: "always_apply_rules", charLimit: 10_000 } },
  { toolName: "user_profile", input: { operation: "read_section", sectionId: "global_always_apply_rules", charLimit: 10_000 } },
  { toolName: "soul", input: { operation: "read_section", sectionId: "core_identity", charLimit: 4_000 } },
  { toolName: "soul", input: { operation: "read_section", sectionId: "voice_and_presence", charLimit: 4_000 } },
  { toolName: "soul", input: { operation: "read_section", sectionId: "relationship_to_user", charLimit: 4_000 } },
]

export const stablePreludeSectionContent = (output: unknown): string | undefined => {
  const record = output && typeof output === "object" && !Array.isArray(output) ? (output as Record<string, unknown>) : undefined
  const section = record?.section && typeof record.section === "object" && !Array.isArray(record.section) ? (record.section as Record<string, unknown>) : undefined
  return typeof section?.content === "string" ? section.content : typeof record?.content === "string" ? record.content : undefined
}

export const cleanStablePreludeText = (text: string): string => text.trim().replace(/^[-*]\s+/, "").trim()

export const isAlwaysApplyPlaceholderText = (text: string): boolean => {
  const normalized = cleanStablePreludeText(text).toLowerCase()
  return normalized.startsWith("add at most 10") && (normalized.includes("hard") || normalized.includes("rule"))
}

export const renderStableCachePrelude = (records: StablePreludeToolRecord[]): string | undefined => {
  let projectRules: string | undefined
  let globalRules: string | undefined
  const identitySections = new Map<string, string>()

  for (const record of records) {
    if (!record.result.ok || !isStableCachePreludeRecord(record)) {
      continue
    }
    const content = normalizeAlwaysApplyRules(stablePreludeSectionContent(record.result.output))
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

export const isStableCachePreludeRecord = (record: StablePreludeToolRecord): boolean =>
  isProjectAlwaysApplyRecord(record) || isGlobalAlwaysApplyRecord(record) || isStableIdentityRecord(record)

export const isStableIdentityRecord = (record: StablePreludeToolRecord): boolean => {
  if (record.toolName !== "soul") return false
  const input = objectRecord(record.input)
  return input?.operation === "read_section" && ["core_identity", "voice_and_presence", "relationship_to_user"].includes(String(input.sectionId))
}

export const isProjectAlwaysApplyRecord = (record: StablePreludeToolRecord): boolean => {
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

export const isGlobalAlwaysApplyRecord = (record: StablePreludeToolRecord): boolean => {
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
