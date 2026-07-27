import type { ModelToolDefinition, ToolName } from "@socrates/contracts"
import type { SocratesTool } from "../tools/types"

export type CapabilityKind =
  | "model_tool"
  | "dynamic_tool"
  | "automatic_retrieval"
  | "structured_worker"
  | "context_stage"
  | "deterministic_authority"
  | "typed_user_command"

export type CapabilityRuntimeScope =
  | "turn"
  | "conversation"
  | "goal"
  | "project"
  | "global"
  | "provider"
  | "runtime"

export type CapabilityPolicy = Readonly<{
  approval: "automatic" | "runtime_policy" | "always_approval" | "not_applicable"
  sandbox: "none" | "workspace" | "selected_resources" | "backend_authority"
  concurrency: "parallel" | "serialized" | "single_flight" | "not_applicable"
  retry: "none" | "model_correction" | "bounded_once" | "runtime_owned"
  timeout: "runtime_default" | "provider_default" | "none"
  idempotency: "idempotent" | "conditional" | "non_idempotent" | "not_applicable"
}>

export type CapabilityPersistence = Readonly<{
  evidence: "none" | "tool_events" | "canonical_source" | "lifecycle_receipt"
  usage: "none" | "model_call" | "usage_event"
  errors: "typed" | "typed_and_persisted"
  audit: "none" | "summary" | "full"
}>

export type CapabilityDocumentation = Readonly<{
  title: string
  guidance?: readonly string[]
  outputPaths?: readonly string[]
}>

export type CapabilitySource = Readonly<{
  owner: string
  definitionPath: string
  implementationPath?: string
  callers: readonly string[]
  tests: readonly string[]
  status: "canonical" | "legacy_remove_with_goal_lifecycle" | "legacy_remove_with_memory_selection" | "migration_compatibility"
}>

type CapabilityDefinitionBase = Readonly<{
  id: string
  description: string
  kind: CapabilityKind
  allowedRoles: readonly string[]
  runtimeScopes: readonly CapabilityRuntimeScope[]
  executorBinding: string
  policy: CapabilityPolicy
  persistence: CapabilityPersistence
  documentation?: CapabilityDocumentation
  source: CapabilitySource
}>

export type ModelToolCapabilityDefinition = CapabilityDefinitionBase & Readonly<{
  kind: "model_tool" | "dynamic_tool"
  tool: SocratesTool<any, any>
  providerProjection: ModelToolDefinition
}>

export type ServiceCapabilityDefinition = CapabilityDefinitionBase & Readonly<{
  kind: Exclude<CapabilityKind, "model_tool" | "dynamic_tool">
  inputSchema?: ModelToolDefinition["inputSchema"]
  resultSchema?: ModelToolDefinition["resultSchema"]
}>

export type CapabilityDefinition = ModelToolCapabilityDefinition | ServiceCapabilityDefinition

export type CapabilityInventoryEntry = Readonly<{
  id: string
  description: string
  kind: CapabilityKind
  allowedRoles: readonly string[]
  runtimeScopes: readonly CapabilityRuntimeScope[]
  executorBinding: string
  modelToolName?: ToolName
  providerSchema?: unknown
  hasInputSchema: boolean
  hasResultSchema: boolean
  policy: CapabilityPolicy
  persistence: CapabilityPersistence
  documentationTitle?: string
  documentationGuidance: readonly string[]
  documentationPaths: readonly string[]
  source: CapabilitySource
}>

export const defineCapability = <TCapability extends CapabilityDefinition>(
  capability: TCapability,
): TCapability => {
  assertNonEmpty(capability.id, "Capability id")
  assertNonEmpty(capability.description, `Capability ${capability.id} description`)
  assertNonEmpty(capability.executorBinding, `Capability ${capability.id} executor binding`)
  assertUnique(capability.allowedRoles, `Capability ${capability.id} allowed roles`)
  assertUnique(capability.runtimeScopes, `Capability ${capability.id} runtime scopes`)
  assertUnique(capability.source.callers, `Capability ${capability.id} callers`)
  assertUnique(capability.source.tests, `Capability ${capability.id} tests`)
  if (capability.kind === "model_tool" || capability.kind === "dynamic_tool") {
    if (capability.tool.name !== capability.providerProjection.name) {
      throw new Error(`Capability ${capability.id} model name and provider projection must match.`)
    }
    if (capability.tool.inputSchema !== capability.providerProjection.inputSchema) {
      throw new Error(`Capability ${capability.id} must project its canonical input schema.`)
    }
    if (capability.tool.resultSchema !== capability.providerProjection.resultSchema) {
      throw new Error(`Capability ${capability.id} must project its canonical result schema.`)
    }
  }
  return Object.freeze(capability)
}

export const describeCapability = (capability: CapabilityDefinition): CapabilityInventoryEntry => ({
  id: capability.id,
  description: capability.description,
  kind: capability.kind,
  allowedRoles: [...capability.allowedRoles],
  runtimeScopes: [...capability.runtimeScopes],
  executorBinding: capability.executorBinding,
  ...(capability.kind === "model_tool" || capability.kind === "dynamic_tool"
    ? {
        modelToolName: capability.tool.name,
        providerSchema: capability.providerProjection.providerInputSchema,
      }
    : {}),
  hasInputSchema: "tool" in capability
    ? Boolean(capability.tool.inputSchema)
    : Boolean(capability.inputSchema),
  hasResultSchema: "tool" in capability
    ? Boolean(capability.tool.resultSchema)
    : Boolean(capability.resultSchema),
  policy: capability.policy,
  persistence: capability.persistence,
  ...(capability.documentation?.title ? { documentationTitle: capability.documentation.title } : {}),
  documentationGuidance: [...(capability.documentation?.guidance ?? [])],
  documentationPaths: [...(capability.documentation?.outputPaths ?? [])],
  source: capability.source,
})

const assertNonEmpty = (value: string, label: string): void => {
  if (!value.trim()) throw new Error(`${label} must not be empty.`)
}

const assertUnique = (values: readonly string[], label: string): void => {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`)
}
