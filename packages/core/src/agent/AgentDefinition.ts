import type { ToolName } from "@socrates/contracts"

export type AgentStructuredOutputSchema<TOutput> = {
  safeParse(value: unknown):
    | { success: true; data: TOutput }
    | { success: false; error: { flatten(): unknown } }
}

export type AgentCompletionDefinition<TOutput> =
  | {
      mode: "text"
      validate?: (text: string) => string
    }
  | {
      mode: "structured" | "streaming_tools_structured_final"
      schema: AgentStructuredOutputSchema<TOutput>
    }

export type AgentContextStage =
  | "stable_prompt"
  | "exact_messages"
  | "runtime_context"
  | "tool_definitions"
  | "consent_gated_compaction"

export type ContextProfile = Readonly<{
  id: string
  stages: readonly AgentContextStage[]
}>

export type RoleManifest = Readonly<{
  id: string
  modelTools: readonly ToolName[]
  dynamicToolPrefixes?: readonly string[]
}>

export type AgentLimits = Readonly<{
  maxToolCalls: number
  timeoutMs?: number
  maxOutputRepairAttempts?: number
}>

export type AgentPersistenceScope = "turn" | "conversation" | "goal" | "project" | "global" | "none"

export type AgentPromptDefinition<TPromptContext> = Readonly<{
  id: string
  buildSystem: (context: TPromptContext) => string
}>

export type AgentDefinition<TPromptContext = undefined, TOutput = string> = Readonly<{
  id: string
  role: string
  modelRole: string
  prompt: AgentPromptDefinition<TPromptContext>
  completion: AgentCompletionDefinition<TOutput>
  roleManifest: RoleManifest
  contextProfile: ContextProfile
  limits: AgentLimits
  persistenceScope: AgentPersistenceScope
}>

export const defineRoleManifest = (manifest: RoleManifest): RoleManifest => {
  assertNonEmpty(manifest.id, "RoleManifest id")
  assertUnique(manifest.modelTools, `RoleManifest ${manifest.id} model tools`)
  assertUnique(manifest.dynamicToolPrefixes ?? [], `RoleManifest ${manifest.id} dynamic tool prefixes`)
  return Object.freeze({
    ...manifest,
    modelTools: Object.freeze([...manifest.modelTools]),
    ...(manifest.dynamicToolPrefixes
      ? { dynamicToolPrefixes: Object.freeze([...manifest.dynamicToolPrefixes]) }
      : {}),
  })
}

export const defineContextProfile = (profile: ContextProfile): ContextProfile => {
  assertNonEmpty(profile.id, "ContextProfile id")
  assertUnique(profile.stages, `ContextProfile ${profile.id} stages`)
  if (!profile.stages.includes("stable_prompt") || !profile.stages.includes("exact_messages")) {
    throw new Error(`ContextProfile ${profile.id} must include stable_prompt and exact_messages.`)
  }
  const positions = profile.stages.map((stage) => CONTEXT_STAGE_ORDER.indexOf(stage))
  if (positions.some((position, index) => index > 0 && position < (positions[index - 1] ?? -1))) {
    throw new Error(`ContextProfile ${profile.id} stages must follow the canonical ContextPipeline order.`)
  }
  return Object.freeze({ ...profile, stages: Object.freeze([...profile.stages]) })
}

export const defineAgent = <TPromptContext, TOutput>(
  definition: AgentDefinition<TPromptContext, TOutput>,
): AgentDefinition<TPromptContext, TOutput> => {
  assertNonEmpty(definition.id, "AgentDefinition id")
  assertNonEmpty(definition.role, `AgentDefinition ${definition.id} role`)
  assertNonEmpty(definition.modelRole, `AgentDefinition ${definition.id} modelRole`)
  assertNonEmpty(definition.prompt.id, `AgentDefinition ${definition.id} prompt id`)
  if (!Number.isInteger(definition.limits.maxToolCalls) || definition.limits.maxToolCalls < 0) {
    throw new Error(`AgentDefinition ${definition.id} maxToolCalls must be a non-negative integer.`)
  }
  if (
    definition.limits.timeoutMs !== undefined
    && (!Number.isInteger(definition.limits.timeoutMs) || definition.limits.timeoutMs <= 0)
  ) {
    throw new Error(`AgentDefinition ${definition.id} timeoutMs must be a positive integer.`)
  }
  const definitionRepairAttempts = definition.limits.maxOutputRepairAttempts
  if (definitionRepairAttempts !== undefined && (!Number.isInteger(definitionRepairAttempts) || definitionRepairAttempts < 0)) {
    throw new Error(`AgentDefinition ${definition.id} maxOutputRepairAttempts must be a non-negative integer.`)
  }
  return Object.freeze({
    ...definition,
    prompt: Object.freeze({ ...definition.prompt }),
    completion: Object.freeze({ ...definition.completion }),
    roleManifest: defineRoleManifest(definition.roleManifest),
    contextProfile: defineContextProfile(definition.contextProfile),
    limits: Object.freeze({ ...definition.limits }),
  })
}

export type AgentDefinitionInventoryEntry = Readonly<{
  id: string
  role: string
  modelRole: string
  promptId: string
  completionMode: AgentCompletionDefinition<unknown>["mode"]
  roleManifestId: string
  modelTools: readonly string[]
  dynamicToolPrefixes: readonly string[]
  contextProfileId: string
  contextStages: readonly AgentContextStage[]
  maxToolCalls: number
  timeoutMs?: number
  maxOutputRepairAttempts?: number
  persistenceScope: AgentPersistenceScope
}>

export const describeAgentDefinition = (
  definition: AgentDefinition<unknown, unknown>,
): AgentDefinitionInventoryEntry => ({
  id: definition.id,
  role: definition.role,
  modelRole: definition.modelRole,
  promptId: definition.prompt.id,
  completionMode: definition.completion.mode,
  roleManifestId: definition.roleManifest.id,
  modelTools: [...definition.roleManifest.modelTools],
  dynamicToolPrefixes: [...(definition.roleManifest.dynamicToolPrefixes ?? [])],
  contextProfileId: definition.contextProfile.id,
  contextStages: [...definition.contextProfile.stages],
  maxToolCalls: definition.limits.maxToolCalls,
  ...(definition.limits.timeoutMs !== undefined ? { timeoutMs: definition.limits.timeoutMs } : {}),
  ...(definition.completion.mode !== "text"
    ? {
        maxOutputRepairAttempts: definition.limits.maxOutputRepairAttempts ?? 1,
      }
    : {}),
  persistenceScope: definition.persistenceScope,
})

export const assertRoleManifestMatchesTools = (
  definition: Readonly<{ id: string; roleManifest: RoleManifest }>,
  toolNames: readonly ToolName[],
): void => {
  const expected = [...definition.roleManifest.modelTools].sort()
  const actual = [...toolNames].sort()
  if (expected.length === actual.length && expected.every((name, index) => name === actual[index])) return
  throw new Error(
    `Agent ${definition.id} tool scope does not match role manifest ${definition.roleManifest.id}. `
    + `Expected [${expected.join(", ")}], received [${actual.join(", ")}].`,
  )
}

export const assertRoleManifestAllowsDynamicTools = (
  definition: Readonly<{ id: string; roleManifest: RoleManifest }>,
  toolNames: readonly string[],
): void => {
  assertUnique(toolNames, `Agent ${definition.id} dynamic tools`)
  const prefixes = definition.roleManifest.dynamicToolPrefixes ?? []
  const disallowed = toolNames.filter((name) => !prefixes.some((prefix) => name.startsWith(prefix)))
  if (disallowed.length === 0) return
  throw new Error(
    `Agent ${definition.id} received dynamic tools outside role manifest ${definition.roleManifest.id}: `
    + `[${disallowed.sort().join(", ")}]. Allowed prefixes: [${prefixes.join(", ")}].`,
  )
}

const assertNonEmpty = (value: string, label: string): void => {
  if (!value.trim()) throw new Error(`${label} must not be empty.`)
}

const assertUnique = (values: readonly string[], label: string): void => {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`)
}

const CONTEXT_STAGE_ORDER: readonly AgentContextStage[] = [
  "stable_prompt",
  "exact_messages",
  "runtime_context",
  "tool_definitions",
  "consent_gated_compaction",
]
