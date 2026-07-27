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
  describeAgentDefinition,
  type AgentDefinition,
  type AgentDefinitionInventoryEntry,
  type AgentStructuredOutputSchema,
} from "./AgentDefinition"

const structuredWorkerContext = {
  id: "structured-worker-context-v1",
  stages: ["stable_prompt", "exact_messages", "tool_definitions", "consent_gated_compaction"],
} as const

const interactiveAgentContext = {
  id: "interactive-agent-context-v1",
  stages: [
    "stable_prompt",
    "exact_messages",
    "runtime_context",
    "tool_definitions",
    "consent_gated_compaction",
  ],
} as const

const emptyRoleManifest = (id: string) => ({ id, modelTools: [] }) as const

export const titleGeneratorAgentDefinition = defineAgent<undefined, ConversationTitleAgentOutput>({
  id: "title-generator",
  role: "title_generator",
  modelRole: "title_generator",
  prompt: { id: "title-generator-v1", buildSystem: () => TITLE_GENERATOR_SYSTEM_PROMPT },
  completion: { mode: "structured", schema: conversationTitleAgentOutputSchema },
  roleManifest: emptyRoleManifest("title-generator-tools-v1"),
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
  roleManifest: emptyRoleManifest("soul-confirmation-tools-v1"),
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
    id: "socrates-main-tools-v1",
    modelTools: [
      "read",
      "search",
      "url_fetch",
      "edit",
      "apply_patch",
      "bash",
      "wait",
      "handover_to_frontier",
      "current_time",
      "trace_retrieve",
      "tool_docs",
      "skills",
      "skill_manager",
      "project_docs",
      "repo_docs",
      "soul",
      "user_profile",
      "list_project_resources",
      "mcp_registry",
      "memory_note",
      "context_disposition",
    ],
    dynamicToolPrefixes: ["mcp__"],
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
    id: "skill-writer-tools-v1",
    modelTools: [
      "current_time",
      "trace_retrieve",
      "skills",
      "user_profile",
      "soul",
      "project_docs",
      "repo_docs",
      "skill_write",
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
    id: "global-memory-tools-v1",
    modelTools: [
      "current_time",
      "trace_retrieve",
      "projects",
      "tool_docs",
      "skills",
      "memory_notes",
      "read_memory_journal",
      "soul",
      "user_profile",
      "edit_files",
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
  roleManifest: emptyRoleManifest(`${input.id}-tools-v1`),
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
