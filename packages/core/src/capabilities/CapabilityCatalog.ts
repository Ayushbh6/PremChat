import { z } from "zod"
import { SocratesError } from "@socrates/shared"
import type {
  DynamicToolCapabilityRegistration,
  ModelToolDefinition,
} from "@socrates/contracts"
import {
  approvalDecideCommandSchema,
  chatConversationSubscribeCommandSchema,
  chatConversationUnsubscribeCommandSchema,
  chatMessageSendCommandSchema,
  chatTurnCancelCommandSchema,
  credentialInputSubmitCommandSchema,
  feedbackSubmitCommandSchema,
  terminalInputCommandSchema,
  terminalRenameCommandSchema,
  terminalResizeCommandSchema,
  terminalStopCommandSchema,
  v2ApprovalDecideCommandSchema,
  v2CredentialInputSubmitCommandSchema,
  v2FeedbackSubmitCommandSchema,
  v2FlowSubscribeCommandSchema,
  v2FlowUnsubscribeCommandSchema,
  v2FocusUpdateCommandSchema,
  v2MessageSendCommandSchema,
  v2RoutingClarificationRespondCommandSchema,
  v2TerminalInputCommandSchema,
  v2TerminalRenameCommandSchema,
  v2TerminalResizeCommandSchema,
  v2TerminalStopCommandSchema,
  v2TurnCancelCommandSchema,
} from "@socrates/contracts"
import { applyPatchTool } from "../tools/applyPatchTool"
import { bashTool } from "../tools/bashTool"
import { capabilityManagerTool } from "../tools/capabilityManagerTool"
import { contextDispositionTool } from "../tools/contextDispositionTool"
import { currentTimeTool } from "../tools/currentTimeTool"
import { editFilesTool } from "../tools/editFilesTool"
import { editTool } from "../tools/editTool"
import { frontierHandoverTool } from "../tools/frontierHandoverTool"
import { memoryNoteTool } from "../tools/memoryNoteTool"
import { memoryNotesTool } from "../tools/memoryNotesTool"
import { projectsTool } from "../tools/projectsTool"
import { readMemoryJournalTool } from "../tools/readMemoryJournalTool"
import { readTool } from "../tools/readTool"
import { searchTool } from "../tools/searchTool"
import { skillWriteTool } from "../tools/skillWriteTool"
import { globalTraceRetrieveTool, traceRetrieveTool } from "../tools/traceRetrieveTool"
import type { SocratesTool } from "../tools/types"
import { urlFetchTool } from "../tools/urlFetchTool"
import { waitTool } from "../tools/waitTool"
import type { RoleManifest } from "../agent/AgentDefinition"
import {
  defineCapability,
  describeCapability,
  type CapabilityDefinition,
  type CapabilityInventoryEntry,
  type ModelToolCapabilityDefinition,
} from "./CapabilityDefinition"
import { projectModelTool } from "./providerProjection"

type StaticToolSpec = Readonly<{
  id: string
  tool: SocratesTool<any, any>
  allowedRoles: readonly string[]
  owner: string
  implementationPath: string
  callers: readonly string[]
  tests: readonly string[]
  documentationPaths?: readonly string[]
  status?: CapabilityDefinition["source"]["status"]
}>

const MAIN = "socrates"
const MEMORY = "global_memory"
const SKILL_WRITER = "skill_writer"
const ALL_AGENT_ROLES = [
  MAIN,
  MEMORY,
  SKILL_WRITER,
  "title_generator",
  "soul_confirmation",
  "socrates_context_compactor",
  "memory_context_compactor",
  "context_anchor_repair",
] as const

const mainCallers = [
  "packages/core/src/agent/SocratesAgent.ts",
  "apps/server/src/ws/commandHandlers/chatMessageSend.ts",
  "apps/server/src/v2/runtime.ts",
] as const
const specialistCallers = [
  "apps/server/src/services/store/memoryAgentRunner.ts",
  "apps/server/src/services/store/skillWriterAgentRunner.ts",
] as const

const staticToolSpecs: readonly StaticToolSpec[] = [
  toolSpec("tool.read", readTool, [MAIN, MEMORY, SKILL_WRITER], "apps/server", "apps/server/src/services/resources/socratesResourceService.ts", [...mainCallers, ...specialistCallers], ["packages/workspace/src/workspace.test.ts", "apps/server/src/services/resources/socratesResourceService.test.ts"], ["read_search.md", "memory_agent/read_search.md"]),
  toolSpec("tool.search", searchTool, [MAIN, MEMORY, SKILL_WRITER], "apps/server", "apps/server/src/services/resources/socratesResourceService.ts", [...mainCallers, ...specialistCallers], ["packages/workspace/src/workspace.test.ts", "apps/server/src/services/resources/socratesResourceService.test.ts"], ["read_search.md", "memory_agent/read_search.md"]),
  toolSpec("tool.url_fetch", urlFetchTool, [MAIN], "apps/server", "apps/server/src/ws/urlFetch.ts", mainCallers, ["apps/server/src/ws/urlFetch.test.ts"], ["url_fetch.md"]),
  toolSpec("tool.edit", editTool, [MAIN], "packages/workspace", "packages/workspace/src/tools/editTool.ts", mainCallers, ["packages/workspace/src/workspace.test.ts"], ["edit_apply_patch.md"]),
  toolSpec("tool.apply_patch", applyPatchTool, [MAIN], "packages/workspace", "packages/workspace/src/tools/patchHelpers.ts", mainCallers, ["packages/workspace/src/workspace.test.ts"], ["edit_apply_patch.md"]),
  toolSpec("tool.bash", bashTool, [MAIN], "packages/workspace", "packages/workspace/src/tools/bashTool.ts", mainCallers, ["packages/workspace/src/workspace.test.ts", "apps/server/src/test/v2TerminalRuntime.test.ts"], ["terminal.md"]),
  toolSpec("tool.wait", waitTool, [MAIN], "apps/server", "apps/server/src/services/store/agentTaskStore.ts", mainCallers, ["apps/server/src/services/store/agentTaskStore.test.ts"], ["terminal.md"]),
  toolSpec("tool.handover_to_frontier", frontierHandoverTool, [MAIN], "packages/core", "packages/core/src/agent/SocratesAgent.ts", mainCallers, ["packages/core/src/test/SocratesAgent.test.ts"], ["handover_to_frontier.md"]),
  toolSpec("tool.current_time", currentTimeTool, [MAIN, MEMORY, SKILL_WRITER], "apps/server", "apps/server/src/services/store/runtimeContext.ts", [...mainCallers, ...specialistCallers], ["packages/core/src/test/AgentRuntime.test.ts"], ["current_time.md", "memory_agent/current_time.md"]),
  toolSpec("tool.trace_retrieve.main", traceRetrieveTool, [MAIN], "apps/server", "apps/server/src/services/retrieval/unifiedMainTraceService.ts", mainCallers, ["apps/server/src/test/server.test.ts"], ["trace_retrieve.md"]),
  toolSpec("tool.trace_retrieve.global", globalTraceRetrieveTool, [MEMORY, SKILL_WRITER], "apps/server", "apps/server/src/services/store/memoryAgentToolExecutors.ts", specialistCallers, ["packages/core/src/test/memoryPrompt.test.ts"], ["memory_agent/trace_retrieve.md"]),
  toolSpec("tool.projects", projectsTool, [MEMORY], "apps/server", "apps/server/src/services/store/memoryAgentToolExecutors.ts", ["apps/server/src/services/store/memoryAgentRunner.ts"], ["packages/core/src/test/memoryPrompt.test.ts"], ["memory_agent/projects.md"]),
  toolSpec("tool.edit_files", editFilesTool, [MEMORY], "apps/server", "apps/server/src/services/store/memoryAgentToolExecutors.ts", ["apps/server/src/services/store/memoryAgentRunner.ts"], ["apps/server/src/services/store/memoryAgentJournal.test.ts"], ["memory_agent/edit_files.md"]),
  toolSpec("tool.capability_manager", capabilityManagerTool, [MAIN], "apps/server", "apps/server/src/services/mainToolExecutors.ts", mainCallers, ["apps/server/src/services/resources/socratesResourceService.test.ts"], ["capability_manager.md"]),
  toolSpec("tool.memory_note", memoryNoteTool, [MAIN], "apps/server", "apps/server/src/services/store/memoryAgentSignals.ts", mainCallers, ["apps/server/src/services/store/memoryAgentJournal.test.ts"], ["memory_note.md"]),
  toolSpec("tool.memory_notes", memoryNotesTool, [MEMORY], "apps/server", "apps/server/src/services/store/memoryAgentToolExecutors.ts", ["apps/server/src/services/store/memoryAgentRunner.ts"], ["apps/server/src/services/store/memoryAgentJournal.test.ts"], ["memory_agent/memory_notes.md"]),
  toolSpec("tool.read_memory_journal", readMemoryJournalTool, [MEMORY], "apps/server", "apps/server/src/services/store/memoryAgentJournal.ts", ["apps/server/src/services/store/memoryAgentRunner.ts"], ["apps/server/src/services/store/memoryAgentJournal.test.ts"], ["memory_agent/read_memory_journal.md"]),
  toolSpec("tool.skill_write", skillWriteTool, [SKILL_WRITER], "apps/server", "apps/server/src/services/store/skillWriterToolExecutors.ts", ["apps/server/src/services/store/skillWriterAgentRunner.ts"], ["apps/server/src/services/store/memorySkills.test.ts"]),
  toolSpec("tool.context_disposition", contextDispositionTool, [MAIN], "packages/core", "packages/core/src/context/toolOutputDisposition.ts", mainCallers, ["packages/core/src/test/toolOutputDisposition.test.ts"], ["context_disposition.md"]),
]

const toolDocumentationGuidance: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "tool.read": [
    "Use read/search for workspace files and governed socrates:// resources. Search socrates://capabilities before claiming a skill or MCP capability is unavailable.",
  ],
  "tool.edit": [
    "Read an existing target first. Targeted edits use one edits array; every match is resolved against the same original content, overlaps fail, and the write is atomic.",
    "The model never supplies dryRun. Approval previews are an internal runtime concern. Re-read a changed target when later work depends on its exact new contents.",
  ],
  "tool.apply_patch": [
    "Use the structured Begin Patch format for multi-file or multi-hunk work. The model never supplies dryRun; approval preview and verified application are internal runtime phases.",
  ],
  "tool.bash": [
    "The model-facing operations are exactly run, start, inspect, stop, and list. Use human-readable Terminal names; runtime ids and output cursors are internal.",
  ],
  "tool.capability_manager": [
    "Automatic retrieval and socrates://capabilities search handle discovery. Use this manager only to check or mutate skills and MCP configuration; mutations require approval.",
  ],
  "tool.trace_retrieve.main": [
    "Use this capability for prior conversation and evidence investigation when earlier visible work can affect the current answer.",
    "Use `mode: \"lexical\"` for concise literal retrieval, semantic for conceptual recall, combined for both, and audit only for runtime evidence.",
    "Main Socrates searches the active project only; cross-project selectors are unavailable.",
  ],
  "tool.trace_retrieve.global": [
    "The Global Memory Agent has cross-project scope, while retaining the same canonical Q&A, inspect, and audit evidence contracts.",
    "Legacy `exact`, trace handles, entry-type selectors, and hidden query normalization are not part of this contract.",
  ],
  "tool.memory_notes": [
    "Before durable action, inspect the exact full Q&A parent and evaluate the complete source user message; a note or excerpt is not sufficient authority.",
    "Interpret intent semantically when checking memory opt-out language; quoted examples and hypotheticals are not themselves opt-outs.",
    "When checking an opt-out, ordinary workspace-artifact restrictions do not suppress memory unless the user also scopes the restriction to Socrates memory, `.socrates`, internal state, or all changes.",
  ],
  "tool.edit_files": [
    "For `target: \"skill\"`, create a user-visible skill proposal only after exact evidence is inspected; the Skill Writer performs the final approved `SKILL.md` write.",
  ],
})

const specialToolDefinitionFiles: Readonly<Record<string, string>> = Object.freeze({
  apply_patch: "applyPatchTool.ts",
  handover_to_frontier: "frontierHandoverTool.ts",
  current_time: "currentTimeTool.ts",
  trace_retrieve: "traceRetrieveTool.ts",
  capability_manager: "capabilityManagerTool.ts",
  memory_note: "memoryNoteTool.ts",
  memory_notes: "memoryNotesTool.ts",
  read_memory_journal: "readMemoryJournalTool.ts",
  skill_write: "skillWriteTool.ts",
  context_disposition: "contextDispositionTool.ts",
})

const staticToolCapabilities = staticToolSpecs.map((spec) => defineStaticToolCapability(spec))

const serviceCapabilities: CapabilityDefinition[] = [
  serviceCapability("retrieval.goal_candidates", "automatic_retrieval", "Retrieve ranked goal candidates while always retaining the current goal.", "retrieval.goal_candidates", [MAIN], ["goal", "runtime"], "apps/server/src/services/turn/turnCandidateRetrieval.ts", "canonical"),
  serviceCapability("retrieval.memory_candidates", "automatic_retrieval", "Retrieve authorized exact-memory candidates in parallel with goal candidates and perform one conditional bound-goal refinement through the same service.", "retrieval.memory_candidates", [MAIN], ["goal", "runtime"], "apps/server/src/services/turn/turnCandidateRetrieval.ts", "canonical"),
  serviceCapability("retrieval.capability_candidates", "automatic_retrieval", "Retrieve ranked installed skill and MCP capability candidates in parallel with goal and memory candidates.", "retrieval.capability_candidates", [MAIN], ["project", "global", "runtime"], "apps/server/src/services/turn/turnCandidateRetrieval.ts", "canonical"),
  serviceCapability("authority.memory_selection", "deterministic_authority", "Select exact authorized memory after goal binding without a model router.", "memory.select_exact", [MAIN], ["goal", "runtime"], "packages/core/src/retrieval/deterministicMemorySelection.ts", "canonical"),
  serviceCapability("authority.goal_ledger", "deterministic_authority", "Own canonical goal pointers, lifecycle state, task counts, and capsule references.", "goal_ledger.transaction", [MAIN], ["goal", "project"], "apps/server/src/services/v2/flowStore.ts", "migration_compatibility"),
  serviceCapability("authority.finalization", "deterministic_authority", "Validate and atomically persist the answer, task, bound goal, capsule, usage, and audit state before publication.", "finalization.atomic_commit", [MAIN], ["turn", "goal"], "apps/server/src/services/turn/validatedTurnFinalization.ts", "canonical"),
  serviceCapability("context.stable_prompt", "context_stage", "Attach stable prompt and standing rules before dynamic turn context.", "context.stable_prompt", ALL_AGENT_ROLES, ["turn"], "packages/core/src/agent/ContextPipeline.ts", "canonical"),
  serviceCapability("context.exact_messages", "context_stage", "Attach selected canonical user and assistant messages without clipping or rewriting them.", "context.exact_messages", ALL_AGENT_ROLES, ["turn", "goal"], "packages/core/src/agent/ContextPipeline.ts", "canonical"),
  serviceCapability("context.runtime_state", "context_stage", "Attach typed runtime, approval, Terminal, wait, and continuation state.", "context.runtime_state", [MAIN, SKILL_WRITER], ["turn", "runtime"], "packages/core/src/agent/ContextPipeline.ts", "canonical"),
  serviceCapability("context.tool_definitions", "context_stage", "Attach only the model tools resolved for the active role through this catalog.", "context.tool_definitions", ALL_AGENT_ROLES, ["turn", "provider"], "packages/core/src/agent/ContextPipeline.ts", "canonical"),
  serviceCapability("context.automatic_compaction", "context_stage", "Automatically replace only the oldest completed-turn model projection at 170k while retaining exact provenance and a recent whole-turn suffix.", "context.compact_oldest_head", ALL_AGENT_ROLES, ["turn", "conversation", "global"], "packages/core/src/context/contextCompression.ts", "canonical"),
  serviceCapability("worker.global_memory", "structured_worker", "Curate durable global memory asynchronously from completed exact evidence.", "agent.global_memory", [MEMORY], ["global"], "apps/server/src/services/store/memoryAgentRunner.ts", "canonical"),
  serviceCapability("worker.skill_writer", "structured_worker", "Create or update an approved skill through the shared agent runtime.", "agent.skill_writer", [SKILL_WRITER], ["project", "global"], "apps/server/src/services/store/skillWriterAgentRunner.ts", "canonical"),
  serviceCapability("worker.title_generator", "structured_worker", "Generate a Classic migration-surface conversation title through the shared runtime.", "agent.title_generator", ["title_generator"], ["conversation"], "packages/core/src/agent/TitleGeneratorAgent.ts", "migration_compatibility"),
  serviceCapability("worker.soul_confirmation", "structured_worker", "Validate a proposed identity update through the shared runtime and confirmation policy.", "agent.soul_confirmation", ["soul_confirmation"], ["global"], "packages/core/src/agent/SoulConfirmationAgent.ts", "canonical"),
  serviceCapability("worker.context_compactor", "structured_worker", "Produce the provenance-linked automatic oldest-head context derivative through the shared runtime.", "agent.context_compactor", ["socrates_context_compactor", "memory_context_compactor", "context_anchor_repair"], ["conversation", "global"], "packages/core/src/agent/CompressorAgent.ts", "canonical"),
  serviceCapability("runtime.structured_repair", "deterministic_authority", "Permit one declared structured-output repair and otherwise return a typed failure.", "agent_runtime.structured_repair", [MAIN, MEMORY, "title_generator", "soul_confirmation", "socrates_context_compactor", "memory_context_compactor", "context_anchor_repair"], ["provider", "runtime"], "packages/core/src/agent/AgentRuntime.ts", "canonical"),
  serviceCapability("runtime.frontier_handover", "deterministic_authority", "Transfer one approved task to the configured Frontier model without parallel agent dialogue.", "agent_runtime.frontier_handover", [MAIN], ["turn", "provider"], "packages/core/src/agent/SocratesAgent.ts", "canonical"),
]

const typedUserCommandCapabilities: CapabilityDefinition[] = [
  userCommandCapability("command.classic.chat.message.send", "chat.message.send", chatMessageSendCommandSchema, "apps/server/src/ws/commandHandlers/chatMessageSend.ts"),
  userCommandCapability("command.classic.chat.turn.cancel", "chat.turn.cancel", chatTurnCancelCommandSchema, "apps/server/src/ws/commandHandlers/chatTurnCancel.ts"),
  userCommandCapability("command.classic.chat.conversation.subscribe", "chat.conversation.subscribe", chatConversationSubscribeCommandSchema, "apps/server/src/ws/commandDispatcher.ts"),
  userCommandCapability("command.classic.chat.conversation.unsubscribe", "chat.conversation.unsubscribe", chatConversationUnsubscribeCommandSchema, "apps/server/src/ws/commandDispatcher.ts"),
  userCommandCapability("command.classic.approval.decide", "approval.decide", approvalDecideCommandSchema, "apps/server/src/ws/commandHandlers/approvalDecide.ts"),
  userCommandCapability("command.classic.credential.input.submit", "credential.input.submit", credentialInputSubmitCommandSchema, "apps/server/src/ws/commandHandlers/credentialInputSubmit.ts"),
  userCommandCapability("command.classic.terminal.stop", "terminal.stop", terminalStopCommandSchema, "apps/server/src/ws/conversationTerminals.ts"),
  userCommandCapability("command.classic.terminal.input", "terminal.input", terminalInputCommandSchema, "apps/server/src/ws/conversationTerminals.ts"),
  userCommandCapability("command.classic.terminal.resize", "terminal.resize", terminalResizeCommandSchema, "apps/server/src/ws/conversationTerminals.ts"),
  userCommandCapability("command.classic.terminal.rename", "terminal.rename", terminalRenameCommandSchema, "apps/server/src/ws/conversationTerminals.ts"),
  userCommandCapability("command.classic.feedback.submit", "feedback.submit", feedbackSubmitCommandSchema, "apps/server/src/ws/commandHandlers/feedbackSubmit.ts"),
  userCommandCapability("command.flow.subscribe", "v2.flow.subscribe", v2FlowSubscribeCommandSchema, "apps/server/src/v2/runtime.ts"),
  userCommandCapability("command.flow.unsubscribe", "v2.flow.unsubscribe", v2FlowUnsubscribeCommandSchema, "apps/server/src/v2/runtime.ts"),
  userCommandCapability("command.flow.message.send", "v2.message.send", v2MessageSendCommandSchema, "apps/server/src/v2/runtime.ts"),
  userCommandCapability("command.flow.routing.clarification.respond", "v2.routing.clarification.respond", v2RoutingClarificationRespondCommandSchema, "apps/server/src/v2/runtime.ts"),
  userCommandCapability("command.flow.focus.update", "v2.focus.update", v2FocusUpdateCommandSchema, "apps/server/src/v2/runtime.ts"),
  userCommandCapability("command.flow.turn.cancel", "v2.turn.cancel", v2TurnCancelCommandSchema, "apps/server/src/v2/runtime.ts"),
  userCommandCapability("command.flow.approval.decide", "v2.approval.decide", v2ApprovalDecideCommandSchema, "apps/server/src/v2/runtime.ts"),
  userCommandCapability("command.flow.feedback.submit", "v2.feedback.submit", v2FeedbackSubmitCommandSchema, "apps/server/src/v2/runtime.ts"),
  userCommandCapability("command.flow.credential.input.submit", "v2.credential.input.submit", v2CredentialInputSubmitCommandSchema, "apps/server/src/v2/runtime.ts"),
  userCommandCapability("command.flow.terminal.stop", "v2.terminal.stop", v2TerminalStopCommandSchema, "apps/server/src/v2/runtime.ts"),
  userCommandCapability("command.flow.terminal.input", "v2.terminal.input", v2TerminalInputCommandSchema, "apps/server/src/v2/runtime.ts"),
  userCommandCapability("command.flow.terminal.resize", "v2.terminal.resize", v2TerminalResizeCommandSchema, "apps/server/src/v2/runtime.ts"),
  userCommandCapability("command.flow.terminal.rename", "v2.terminal.rename", v2TerminalRenameCommandSchema, "apps/server/src/v2/runtime.ts"),
]

export class CapabilitySet {
  private readonly byModelName: Map<string, ModelToolCapabilityDefinition>

  constructor(readonly capabilities: readonly CapabilityDefinition[]) {
    const modelTools = capabilities.filter(isModelToolCapability)
    this.byModelName = new Map()
    for (const capability of modelTools) {
      const existing = this.byModelName.get(capability.tool.name)
      if (existing) {
        throw new Error(`Role capability set exposes duplicate model tool ${capability.tool.name}: ${existing.id}, ${capability.id}.`)
      }
      this.byModelName.set(capability.tool.name, capability)
    }
  }

  list(): ModelToolCapabilityDefinition[] {
    return this.capabilities.filter(isModelToolCapability)
  }

  modelDefinitions(): ModelToolDefinition[] {
    return this.list().map((capability) => capability.providerProjection)
  }

  get(name: string): SocratesTool<any, any> | undefined {
    return this.byModelName.get(name)?.tool
  }

  getCapability(name: string): ModelToolCapabilityDefinition | undefined {
    return this.byModelName.get(name)
  }
}

export class CapabilityCatalog {
  private readonly byId: Map<string, CapabilityDefinition>

  constructor(readonly capabilities: readonly CapabilityDefinition[] = canonicalCapabilities) {
    this.byId = new Map()
    for (const capability of capabilities) {
      if (this.byId.has(capability.id)) throw new Error(`Duplicate capability id: ${capability.id}.`)
      this.byId.set(capability.id, capability)
    }
  }

  list(): CapabilityDefinition[] {
    return [...this.capabilities]
  }

  inventory(): CapabilityInventoryEntry[] {
    return this.list().map(describeCapability)
  }

  runtimeInventory(
    manifest: RoleManifest,
    runtimeRegistrations: readonly DynamicToolCapabilityRegistration[] = [],
  ): CapabilityInventoryEntry[] {
    return this.resolve(manifest, runtimeRegistrations).capabilities.map(describeCapability)
  }

  resolve(
    manifest: RoleManifest,
    runtimeRegistrations: readonly DynamicToolCapabilityRegistration[] = [],
  ): CapabilitySet {
    const selected = manifest.capabilityIds.map((id) => {
      const capability = this.byId.get(id)
      if (!capability) throw new SocratesError("agent_role_manifest_mismatch", `RoleManifest ${manifest.id} references unknown capability ${id}.`)
      if (!capability.allowedRoles.includes(manifest.role)) {
        throw new SocratesError("agent_role_manifest_mismatch", `Capability ${id} does not allow role ${manifest.role}.`)
      }
      return capability
    })
    const dynamic = runtimeRegistrations.map((registration) => {
      const allowed = manifest.dynamicCapabilityPrefixes?.some((prefix) => registration.id.startsWith(prefix)) ?? false
      if (!allowed) throw new SocratesError("agent_role_manifest_mismatch", `RoleManifest ${manifest.id} does not allow runtime capability ${registration.id}.`)
      return dynamicToolCapability(registration, manifest.role)
    })
    return new CapabilitySet([...selected, ...dynamic])
  }
}

export const canonicalCapabilities = Object.freeze([
  ...staticToolCapabilities,
  ...serviceCapabilities,
  ...typedUserCommandCapabilities,
])
export const capabilityCatalog = new CapabilityCatalog()
export const emptyCapabilitySet = new CapabilitySet([])
export const capabilityInventory = (): CapabilityInventoryEntry[] => capabilityCatalog.inventory()
function defineStaticToolCapability(spec: StaticToolSpec): ModelToolCapabilityDefinition {
  return defineCapability({
  id: spec.id,
  description: spec.tool.description,
  kind: "model_tool",
  allowedRoles: spec.allowedRoles,
  runtimeScopes: runtimeScopesForTool(spec.tool),
  executorBinding: spec.tool.name,
  policy: policyForTool(spec.tool),
  persistence: {
    evidence: "tool_events",
    usage: "model_call",
    errors: "typed_and_persisted",
    audit: "full",
  },
  documentation: {
    title: spec.tool.displayName ?? spec.tool.name,
    guidance: [spec.tool.description, ...(toolDocumentationGuidance[spec.id] ?? [])],
    ...(spec.documentationPaths ? { outputPaths: spec.documentationPaths } : {}),
  },
  source: {
    owner: spec.owner,
    definitionPath: toolDefinitionPath(spec.tool),
    implementationPath: spec.implementationPath,
    callers: spec.callers,
    tests: spec.tests,
    status: spec.status ?? "canonical",
  },
  tool: spec.tool,
  providerProjection: projectModelTool(spec.tool),
  })
}

const dynamicToolCapability = (
  registration: DynamicToolCapabilityRegistration,
  role: string,
): ModelToolCapabilityDefinition => {
  const tool: SocratesTool<any, any> = {
    name: registration.name,
    description: registration.description,
    inputSchema: registration.inputSchema,
    resultSchema: registration.resultSchema,
    permission: "execute",
    executeLane: "parallel",
    category: "mcp",
    decidePolicy: () => ({ type: "auto" }),
    execute: async (input, context) => {
      if (!context.executors.mcp_dynamic) throw new Error("Dynamic MCP executor is unavailable.")
      return context.executors.mcp_dynamic({ dynamicName: registration.name, input }, context)
    },
    resultPreview: (output) => safeJson(output),
    summary: () => `Completed ${registration.name}.`,
  }
  return defineCapability({
    id: registration.id,
    description: registration.description,
    kind: "dynamic_tool",
    allowedRoles: [role],
    runtimeScopes: ["turn", registration.source.scope],
    executorBinding: "mcp_dynamic",
    policy: {
      approval: "runtime_policy",
      sandbox: "selected_resources",
      concurrency: "parallel",
      retry: "model_correction",
      timeout: "runtime_default",
      idempotency: "conditional",
    },
    persistence: {
      evidence: "tool_events",
      usage: "model_call",
      errors: "typed_and_persisted",
      audit: "full",
    },
    source: {
      owner: "packages/mcp",
      definitionPath: "packages/mcp/src/index.ts",
      implementationPath: "packages/mcp/src/index.ts",
      callers: ["packages/core/src/agent/SocratesAgent.ts"],
      tests: ["packages/mcp/src/index.test.ts", "packages/core/src/test/SocratesAgent.test.ts"],
      status: "canonical",
    },
    tool,
    providerProjection: {
      name: registration.name,
      description: registration.description,
      inputSchema: registration.inputSchema,
      resultSchema: registration.resultSchema,
      providerInputSchema: registration.providerInputSchema,
    },
  })
}

function toolSpec(
  id: string,
  tool: SocratesTool<any, any>,
  allowedRoles: readonly string[],
  owner: string,
  implementationPath: string,
  callers: readonly string[],
  tests: readonly string[],
  documentationPaths?: readonly string[],
  status?: StaticToolSpec["status"],
): StaticToolSpec {
  return {
    id,
    tool,
    allowedRoles,
    owner,
    implementationPath,
    callers,
    tests,
    ...(documentationPaths ? { documentationPaths } : {}),
    ...(status ? { status } : {}),
  }
}

function serviceCapability(
  id: string,
  kind: Exclude<CapabilityDefinition["kind"], "model_tool" | "dynamic_tool" | "typed_user_command">,
  description: string,
  executorBinding: string,
  allowedRoles: readonly string[],
  runtimeScopes: CapabilityDefinition["runtimeScopes"],
  implementationPath: string,
  status: CapabilityDefinition["source"]["status"],
): CapabilityDefinition {
  return defineCapability({
    id,
    kind,
    description,
    allowedRoles,
    runtimeScopes,
    executorBinding,
    inputSchema: z.object({}).strict(),
    resultSchema: z.unknown(),
    policy: {
      approval: "not_applicable",
      sandbox: "backend_authority",
      concurrency: "single_flight",
      retry: kind === "structured_worker" ? "bounded_once" : "runtime_owned",
      timeout: kind === "structured_worker" ? "provider_default" : "runtime_default",
      idempotency: kind === "automatic_retrieval" || kind === "context_stage" ? "idempotent" : "conditional",
    },
    persistence: {
      evidence: kind === "context_stage" ? "none" : "lifecycle_receipt",
      usage: kind === "structured_worker" ? "usage_event" : "none",
      errors: "typed_and_persisted",
      audit: "summary",
    },
    source: {
      owner: implementationPath.split("/").slice(0, 2).join("/"),
      definitionPath: "packages/core/src/capabilities/CapabilityCatalog.ts",
      implementationPath,
      callers: [implementationPath],
      tests: testsForService(kind),
      status,
    },
  })
}

function userCommandCapability(
  id: string,
  commandType: string,
  inputSchema: z.ZodTypeAny,
  implementationPath: string,
): CapabilityDefinition {
  const flow = commandType.startsWith("v2.")
  const readOnly = commandType.endsWith("subscribe") || commandType.endsWith("unsubscribe")
  return defineCapability({
    id,
    kind: "typed_user_command",
    description: `Validate and dispatch the ${commandType} user command.`,
    allowedRoles: [flow ? "flow_runtime" : "classic_runtime"],
    runtimeScopes: ["runtime", commandType.includes("conversation") || flow ? "goal" : "conversation"],
    executorBinding: commandType,
    inputSchema,
    resultSchema: z.unknown(),
    policy: {
      approval: "not_applicable",
      sandbox: "backend_authority",
      concurrency: commandType.includes("message.send") ? "single_flight" : "serialized",
      retry: "none",
      timeout: "runtime_default",
      idempotency: readOnly ? "idempotent" : "conditional",
    },
    persistence: {
      evidence: readOnly ? "none" : "lifecycle_receipt",
      usage: "none",
      errors: "typed_and_persisted",
      audit: readOnly ? "none" : "summary",
    },
    source: {
      owner: "apps/server",
      definitionPath: flow ? "packages/contracts/src/v2Flow.ts" : "packages/contracts/src/websocket.ts",
      implementationPath,
      callers: [flow ? "apps/server/src/v2/runtime.ts" : "apps/server/src/ws/commandDispatcher.ts"],
      tests: [flow ? "apps/server/src/test/v2FlowRuntime.test.ts" : "apps/server/src/test/server.test.ts", "packages/contracts/src/contracts.test.ts"],
      status: flow ? "canonical" : "migration_compatibility",
    },
  })
}

function policyForTool(tool: SocratesTool<any, any>) {
  return {
    approval: tool.permission === "read" ? "automatic" as const : "runtime_policy" as const,
    sandbox: tool.category === "file" || tool.category === "patch" || tool.category === "shell"
      ? "workspace" as const
      : "backend_authority" as const,
    concurrency: tool.executeLane === "parallel" ? "parallel" as const : "serialized" as const,
    retry: "model_correction" as const,
    timeout: "runtime_default" as const,
    idempotency: tool.permission === "read" ? "idempotent" as const : "conditional" as const,
  }
}

function runtimeScopesForTool(tool: SocratesTool<any, any>) {
  return tool.name === "user_profile" || tool.name === "soul" ? ["turn", "global"] as const : ["turn", "project"] as const
}

function toolDefinitionPath(tool: SocratesTool<any, any>): string {
  const fileName = specialToolDefinitionFiles[tool.name]
    ?? `${tool.name.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())}Tool.ts`
  return `packages/core/src/tools/${fileName}`
}

function testsForService(kind: CapabilityDefinition["kind"]): readonly string[] {
  return kind === "structured_worker"
    ? ["packages/core/src/test/AgentInstance.test.ts", "packages/core/src/test/AgentRuntime.test.ts"]
    : kind === "context_stage"
      ? ["packages/core/src/test/prepareTurnContext.test.ts", "packages/core/src/test/contextCompression.test.ts"]
      : ["apps/server/src/test/v2FlowRuntime.test.ts"]
}

function isModelToolCapability(capability: CapabilityDefinition): capability is ModelToolCapabilityDefinition {
  return capability.kind === "model_tool" || capability.kind === "dynamic_tool"
}

const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
