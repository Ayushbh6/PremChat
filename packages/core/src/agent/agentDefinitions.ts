import {
  anchorRepairSchema,
  chatCompactionDraftSchema,
  conversationTitleAgentOutputSchema,
  memoryAgentJournalOutputSchema,
  memoryCompactionDraftSchema,
  socratesFinalAnswerSchema,
  soulConfirmationAgentOutputSchema,
  type ConversationTitleAgentOutput,
  type MemoryAgentJournalOutput,
  type SocratesFinalAnswer,
  type SoulConfirmationAgentOutput,
} from "@socrates/contracts"
import type { z } from "zod"
import { TITLE_GENERATOR_SYSTEM_PROMPT } from "../prompts/titleGeneratorPrompt"
import { SOUL_CONFIRMATION_AGENT_SYSTEM_PROMPT } from "../prompts/soulConfirmationPrompt"
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

export const titleGeneratorAgentDefinition = defineAgent<undefined, ConversationTitleAgentOutput>({
  id: "title-generator",
  role: "title_generator",
  modelRole: "title_generator",
  prompt: { id: "title-generator-v1", buildSystem: () => TITLE_GENERATOR_SYSTEM_PROMPT },
  completion: { mode: "structured", schema: conversationTitleAgentOutputSchema },
  roleManifest: {
    id: "title-generator-capabilities-v2",
    role: "title_generator",
    capabilityIds: ["worker.title_generator", ...structuredContextCapabilities, "runtime.structured_repair"],
  },
  contextProfile: structuredWorkerContext,
  limits: { maxToolCalls: 0, maxOutputRepairAttempts: 1 },
  persistenceScope: "conversation",
})

export const soulConfirmationAgentDefinition = defineAgent<undefined, SoulConfirmationAgentOutput>({
  id: "soul-confirmation",
  role: "soul_confirmation",
  modelRole: "global_memory",
  prompt: { id: "soul-confirmation-v1", buildSystem: () => SOUL_CONFIRMATION_AGENT_SYSTEM_PROMPT },
  completion: { mode: "structured", schema: soulConfirmationAgentOutputSchema },
  roleManifest: {
    id: "soul-confirmation-capabilities-v2",
    role: "soul_confirmation",
    capabilityIds: ["worker.soul_confirmation", ...structuredContextCapabilities, "runtime.structured_repair"],
  },
  contextProfile: structuredWorkerContext,
  limits: { maxToolCalls: 0, maxOutputRepairAttempts: 1 },
  persistenceScope: "global",
})

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
      "tool.tool_docs",
      "tool.skills.manage",
      "tool.skill_manager",
      "tool.project_docs",
      "tool.repo_docs",
      "tool.soul",
      "tool.user_profile",
      "tool.list_project_resources",
      "tool.mcp_registry",
      "tool.memory_note",
      "tool.context_disposition",
      "retrieval.goal_candidates",
      "retrieval.memory_candidates",
      "authority.memory_selection",
      "authority.goal_ledger",
      "authority.finalization",
      ...interactiveContextCapabilities,
      "runtime.structured_repair",
      "runtime.frontier_handover",
    ],
    dynamicCapabilityPrefixes: ["dynamic.mcp."],
  },
  contextProfile: interactiveAgentContext,
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
      "tool.skills.read",
      "tool.user_profile",
      "tool.soul",
      "tool.project_docs",
      "tool.repo_docs",
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
      "tool.current_time",
      "tool.trace_retrieve.global",
      "tool.projects",
      "tool.tool_docs",
      "tool.skills.read",
      "tool.memory_notes",
      "tool.read_memory_journal",
      "tool.soul",
      "tool.user_profile",
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

export const chatCompressorAgentDefinition = createCompressorDefinition<z.infer<typeof chatCompactionDraftSchema>>({
  id: "socrates-context-compactor",
  role: "socrates_context_compactor",
  promptId: "socrates-context-compactor-v1",
  schema: chatCompactionDraftSchema,
  persistenceScope: "conversation",
})

export const memoryCompressorAgentDefinition = createCompressorDefinition<z.infer<typeof memoryCompactionDraftSchema>>({
  id: "memory-context-compactor",
  role: "memory_context_compactor",
  promptId: "memory-context-compactor-v1",
  schema: memoryCompactionDraftSchema,
  persistenceScope: "global",
})

export const anchorRepairAgentDefinition = createCompressorDefinition({
  id: "context-anchor-repair",
  role: "context_anchor_repair",
  promptId: "context-anchor-repair-v1",
  schema: anchorRepairSchema,
  persistenceScope: "none",
})

export const phaseOneAgentDefinitions = [
  socratesMainAgentDefinition,
  skillWriterAgentDefinition,
  titleGeneratorAgentDefinition,
  soulConfirmationAgentDefinition,
  globalMemoryAgentDefinition,
  chatCompressorAgentDefinition,
  memoryCompressorAgentDefinition,
  anchorRepairAgentDefinition,
] as const

export const phaseOneAgentDefinitionInventory = (): AgentDefinitionInventoryEntry[] =>
  phaseOneAgentDefinitions.map((definition) => describeAgentDefinition(definition as AgentDefinition<unknown, unknown>))
