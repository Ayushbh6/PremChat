import {
  chatCompactionSchema,
  memoryAgentJournalOutputSchema,
  memoryCompactionSchema,
  socratesFinalAnswerSchema,
  type MemoryAgentJournalOutput,
  type SocratesFinalAnswer,
} from "@socrates/contracts"
import type { z } from "zod"
import {
  defineAgent,
  defineRoleManifest,
  describeAgentDefinition,
  type AgentDefinition,
  type AgentDefinitionInventoryEntry,
  type AgentStructuredOutputSchema,
} from "./AgentDefinition"

export const socratesGoalResolutionPhaseManifest = defineRoleManifest({
  id: "socrates-goal-resolution-phase-v1",
  role: "socrates",
  capabilityIds: [
    "retrieval.goal_candidates",
    "retrieval.memory_candidates",
    "retrieval.capability_candidates",
    "context.stable_prompt",
    "context.exact_messages",
    "runtime.structured_repair",
  ],
})

const structuredWorkerContext = {
  id: "structured-worker-context-v1",
  stages: ["stable_prompt", "exact_messages", "tool_definitions", "automatic_compaction"],
} as const

const interactiveAgentContext = {
  id: "interactive-agent-context-v1",
  stages: [
    "stable_prompt",
    "exact_messages",
    "runtime_context",
    "tool_definitions",
    "automatic_compaction",
  ],
} as const

const socratesInteractiveContext = {
  id: "socrates-interactive-context-v1",
  stages: [
    "stable_prompt",
    "exact_messages",
    "runtime_context",
    "filesystem_access",
    "tool_definitions",
    "automatic_compaction",
  ],
} as const

const structuredContextCapabilities = [
  "context.stable_prompt",
  "context.exact_messages",
  "context.tool_definitions",
  "context.automatic_compaction",
] as const

const interactiveContextCapabilities = [
  "context.stable_prompt",
  "context.exact_messages",
  "context.runtime_state",
  "context.tool_definitions",
  "context.automatic_compaction",
] as const

const socratesInteractiveContextCapabilities = [
  "context.stable_prompt",
  "context.exact_messages",
  "context.runtime_state",
  "context.filesystem_access",
  "context.tool_definitions",
  "context.automatic_compaction",
] as const

export type DynamicSystemPromptContext = Readonly<{ system: string }>

export const socratesMainAgentDefinition = defineAgent<DynamicSystemPromptContext, SocratesFinalAnswer>({
  id: "socrates-main",
  role: "socrates",
  modelRole: "main",
  prompt: { id: "socrates-main-v1", buildSystem: (context) => context.system },
  completion: { mode: "streaming_tools_structured_final", schema: socratesFinalAnswerSchema },
  roleManifest: {
    id: "socrates-main-capabilities-v1",
    role: "socrates",
    capabilityIds: [
      "tool.read",
      "tool.search",
      "tool.url_fetch",
      "tool.edit",
      "tool.apply_patch",
      "tool.bash",
      "tool.wait",
      "tool.handover_to_frontier",
      "tool.current_time",
      "tool.trace_retrieve.main",
      "tool.capability_manager",
      "tool.memory_note",
      "tool.context_disposition",
      "retrieval.goal_candidates",
      "retrieval.memory_candidates",
      "retrieval.capability_candidates",
      "authority.memory_selection",
      "authority.goal_ledger",
      "authority.finalization",
      "authority.filesystem_access",
      ...socratesInteractiveContextCapabilities,
      "runtime.structured_repair",
      "runtime.frontier_handover",
    ],
    dynamicCapabilityPrefixes: ["dynamic.mcp."],
  },
  contextProfile: socratesInteractiveContext,
  limits: { maxToolCalls: 80, maxOutputRepairAttempts: 1 },
  persistenceScope: "goal",
})

export const skillWriterAgentDefinition = defineAgent<DynamicSystemPromptContext, string>({
  id: "skill-writer",
  role: "skill_writer",
  modelRole: "skill_writer",
  prompt: { id: "skill-writer-v1", buildSystem: (context) => context.system },
  completion: { mode: "text" },
  roleManifest: {
    id: "skill-writer-capabilities-v1",
    role: "skill_writer",
    capabilityIds: [
      "tool.current_time",
      "tool.trace_retrieve.global",
      "tool.read",
      "tool.search",
      "tool.skill_write",
      "worker.skill_writer",
      ...interactiveContextCapabilities,
    ],
  },
  contextProfile: interactiveAgentContext,
  limits: { maxToolCalls: 20 },
  persistenceScope: "project",
})

export const globalMemoryAgentDefinition = defineAgent<DynamicSystemPromptContext, MemoryAgentJournalOutput>({
  id: "global-memory",
  role: "global_memory",
  modelRole: "global_memory",
  prompt: { id: "global-memory-v1", buildSystem: (context) => context.system },
  completion: { mode: "streaming_tools_structured_final", schema: memoryAgentJournalOutputSchema },
  roleManifest: {
    id: "global-memory-capabilities-v1",
    role: "global_memory",
    capabilityIds: [
      "tool.memory_notes",
      "tool.read_memory_journal",
      "tool.edit_files",
      "worker.global_memory",
      ...structuredContextCapabilities,
      "runtime.structured_repair",
    ],
  },
  contextProfile: structuredWorkerContext,
  limits: { maxToolCalls: 60, maxOutputRepairAttempts: 1 },
  persistenceScope: "global",
})

const createCompressorDefinition = <TOutput>(input: {
  id: string
  role: string
  promptId: string
  schema: AgentStructuredOutputSchema<TOutput>
  persistenceScope: "conversation" | "global" | "none"
}): AgentDefinition<DynamicSystemPromptContext, TOutput> => defineAgent({
  id: input.id,
  role: input.role,
  modelRole: input.role,
  prompt: { id: input.promptId, buildSystem: (context) => context.system },
  completion: { mode: "structured", schema: input.schema },
  roleManifest: {
    id: `${input.id}-capabilities-v2`,
    role: input.role,
    capabilityIds: ["worker.context_compactor", ...structuredContextCapabilities, "runtime.structured_repair"],
  },
  contextProfile: structuredWorkerContext,
  limits: { maxToolCalls: 0, maxOutputRepairAttempts: 1 },
  persistenceScope: input.persistenceScope,
})

export const chatCompressorAgentDefinition = createCompressorDefinition<z.infer<typeof chatCompactionSchema>>({
  id: "socrates-context-compactor",
  role: "socrates_context_compactor",
  promptId: "socrates-context-compactor-v1",
  schema: chatCompactionSchema,
  persistenceScope: "conversation",
})

export const memoryCompressorAgentDefinition = createCompressorDefinition<z.infer<typeof memoryCompactionSchema>>({
  id: "memory-context-compactor",
  role: "memory_context_compactor",
  promptId: "memory-context-compactor-v1",
  schema: memoryCompactionSchema,
  persistenceScope: "global",
})

export const phaseOneAgentDefinitions = [
  socratesMainAgentDefinition,
  skillWriterAgentDefinition,
  globalMemoryAgentDefinition,
  chatCompressorAgentDefinition,
  memoryCompressorAgentDefinition,
] as const

export const phaseOneAgentDefinitionInventory = (): AgentDefinitionInventoryEntry[] =>
  phaseOneAgentDefinitions.map((definition) => describeAgentDefinition(definition as AgentDefinition<unknown, unknown>))
