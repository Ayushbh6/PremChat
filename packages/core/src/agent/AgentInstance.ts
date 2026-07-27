import type { RuntimeConfig } from "@socrates/contracts"
import type {
  ModelMessage,
  ModelMessageContent,
  ModelProvider,
  ModelRequest,
  ModelUsage,
} from "@socrates/providers"
import { SocratesError } from "@socrates/shared"
import { capabilityCatalog, type CapabilityCatalog } from "../capabilities/CapabilityCatalog"
import type { ContextCompressionRuntime } from "../context/contextCompression"
import type { ToolExecutors } from "../tools/types"
import { assertRoleManifestMatchesCapabilities, type AgentDefinition } from "./AgentDefinition"
import {
  AgentRuntime,
  type AgentRuntimeResult,
} from "./AgentRuntime"

type AgentInstanceMessageInput =
  | { userContent: ModelMessageContent; messages?: never }
  | { messages: ModelMessage[]; userContent?: never }

export type AgentInstanceInput<TPromptContext> = {
  provider: ModelProvider
  providerId: RuntimeConfig["providerId"]
  modelId: string
  runtimeConfig: RuntimeConfig
  promptContext: TPromptContext
  toolExecutors: ToolExecutors | Record<string, never>
  projectId: string
  conversationId: string
  sessionId: string
  turnId: string
  workspacePath: string
  cacheKey?: string
  providerRouting?: ModelRequest["providerRouting"]
  abortSignal?: AbortSignal
  contextCompression?: ContextCompressionRuntime
  maxOutputRepairAttempts?: number
  onModelEvent?: Parameters<AgentRuntime["run"]>[0]["onModelEvent"]
  onUsage?: (usage: ModelUsage) => void
  onToolResult?: (result: { toolCallId: string; toolName: string; input: unknown; output: unknown }) => void
  createModelCall?: Parameters<AgentRuntime["run"]>[0]["createModelCall"]
} & AgentInstanceMessageInput

export class AgentInstance<TPromptContext, TOutput> {
  constructor(
    readonly definition: AgentDefinition<TPromptContext, TOutput>,
    private readonly runtime: AgentRuntime = new AgentRuntime(),
    private readonly catalog: CapabilityCatalog = capabilityCatalog,
  ) {}

  async run(input: AgentInstanceInput<TPromptContext>): Promise<AgentRuntimeResult<TOutput>> {
    if ((input.messages === undefined) === (input.userContent === undefined)) {
      throw new SocratesError(
        "agent_message_input_invalid",
        `Agent ${this.definition.id} requires exactly one of messages or userContent.`,
      )
    }
    const capabilitySet = this.catalog.resolve(this.definition.roleManifest)
    assertRoleManifestMatchesCapabilities(
      this.definition,
      capabilitySet.capabilities.map((capability) => capability.id),
    )
    assertContextProfileMatchesCapabilities(this.definition, capabilitySet)
    assertContextProfileSupportsRun(this.definition, input, capabilitySet)
    const system = this.definition.prompt.buildSystem(input.promptContext)
    if (!system.trim()) {
      throw new SocratesError("agent_prompt_empty", `Agent ${this.definition.id} produced an empty system prompt.`)
    }
    const runtimeInput = {
      provider: input.provider,
      providerId: input.providerId,
      modelId: input.modelId,
      runtimeConfig: input.runtimeConfig,
      system,
      ...(input.userContent !== undefined ? { userContent: input.userContent } : {}),
      ...(input.messages ? { messages: input.messages } : {}),
      capabilitySet,
      toolExecutors: input.toolExecutors,
      maxToolCalls: this.definition.limits.maxToolCalls,
      projectId: input.projectId,
      conversationId: input.conversationId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      workspacePath: input.workspacePath,
      ...(input.cacheKey ? { cacheKey: input.cacheKey } : {}),
      ...(input.providerRouting ? { providerRouting: input.providerRouting } : {}),
      ...(input.contextCompression ? { contextCompression: input.contextCompression } : {}),
      ...(input.onModelEvent ? { onModelEvent: input.onModelEvent } : {}),
      ...(input.onUsage ? { onUsage: input.onUsage } : {}),
      ...(input.onToolResult ? { onToolResult: input.onToolResult } : {}),
      ...(input.createModelCall ? { createModelCall: input.createModelCall } : {}),
    }
    const completion = this.definition.completion
    if (completion.mode === "text") {
      if (input.maxOutputRepairAttempts !== undefined) {
        throw new SocratesError("agent_repair_budget_invalid", `Text agent ${this.definition.id} cannot set a structured-output repair budget.`)
      }
      return runWithAgentDeadline(this.definition, input.abortSignal, (abortSignal) => this.runtime.run({
        ...runtimeInput,
        ...(abortSignal ? { abortSignal } : {}),
        completion: {
          mode: "text",
          ...(completion.validate ? { validate: completion.validate } : {}),
        },
      }))
    }
    const definitionRepairAttempts = this.definition.limits.maxOutputRepairAttempts ?? 1
    if (
      input.maxOutputRepairAttempts !== undefined
      && (!Number.isInteger(input.maxOutputRepairAttempts)
        || input.maxOutputRepairAttempts < 0
        || input.maxOutputRepairAttempts > definitionRepairAttempts)
    ) {
      throw new SocratesError(
        "agent_repair_budget_invalid",
        `Agent ${this.definition.id} repair budget must be between 0 and ${definitionRepairAttempts}.`,
      )
    }
    const configuredRepairAttempts = input.maxOutputRepairAttempts ?? definitionRepairAttempts
    return runWithAgentDeadline(this.definition, input.abortSignal, (abortSignal) => this.runtime.run<TOutput>({
      ...runtimeInput,
      ...(abortSignal ? { abortSignal } : {}),
      completion: {
        mode: completion.mode,
        schema: completion.schema,
        ...(configuredRepairAttempts !== undefined ? { maxOutputRepairAttempts: configuredRepairAttempts } : {}),
      },
    }))
  }
}

const CONTEXT_STAGE_CAPABILITY_IDS = {
  stable_prompt: "context.stable_prompt",
  exact_messages: "context.exact_messages",
  runtime_context: "context.runtime_state",
  tool_definitions: "context.tool_definitions",
  consent_gated_compaction: "context.user_approved_compaction",
} as const

const assertContextProfileMatchesCapabilities = <TPromptContext, TOutput>(
  definition: AgentDefinition<TPromptContext, TOutput>,
  capabilitySet: import("../capabilities/CapabilityCatalog").CapabilitySet,
): void => {
  const attachedIds = new Set(capabilitySet.capabilities.map((capability) => capability.id))
  for (const stage of definition.contextProfile.stages) {
    const capabilityId = CONTEXT_STAGE_CAPABILITY_IDS[stage]
    if (!attachedIds.has(capabilityId)) {
      throw new SocratesError(
        "agent_context_capability_missing",
        `Agent ${definition.id} context stage ${stage} is missing catalog capability ${capabilityId}.`,
      )
    }
  }
}

const assertContextProfileSupportsRun = <TPromptContext, TOutput>(
  definition: AgentDefinition<TPromptContext, TOutput>,
  input: Pick<AgentInstanceInput<TPromptContext>, "contextCompression">,
  capabilitySet: import("../capabilities/CapabilityCatalog").CapabilitySet,
): void => {
  const stages = definition.contextProfile.stages
  if (capabilitySet.list().length > 0 && !stages.includes("tool_definitions")) {
    throw new SocratesError(
      "agent_context_profile_mismatch",
      `Agent ${definition.id} has model tools but context profile ${definition.contextProfile.id} omits tool_definitions.`,
    )
  }
  if (input.contextCompression?.enabled && !stages.includes("consent_gated_compaction")) {
    throw new SocratesError(
      "agent_context_profile_mismatch",
      `Agent ${definition.id} enabled compaction but context profile ${definition.contextProfile.id} omits consent_gated_compaction.`,
    )
  }
}

const runWithAgentDeadline = async <TResult>(
  definition: Readonly<{ id: string; limits: Readonly<{ timeoutMs?: number }> }>,
  upstreamSignal: AbortSignal | undefined,
  run: (abortSignal: AbortSignal | undefined) => Promise<TResult>,
): Promise<TResult> => {
  const timeoutMs = definition.limits.timeoutMs
  if (timeoutMs === undefined) return run(upstreamSignal)

  const controller = new AbortController()
  const forwardAbort = () => controller.abort(upstreamSignal?.reason)
  if (upstreamSignal?.aborted) forwardAbort()
  else upstreamSignal?.addEventListener("abort", forwardAbort, { once: true })

  let rejectTimeout: (error: SocratesError) => void = () => undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject
  })
  const handle = setTimeout(() => {
    const error = new SocratesError(
      "agent_timeout",
      `Agent ${definition.id} exceeded its declared ${timeoutMs}ms timeout.`,
      { recoverable: true },
    )
    controller.abort(error)
    rejectTimeout(error)
  }, timeoutMs)

  try {
    return await Promise.race([run(controller.signal), timeout])
  } finally {
    clearTimeout(handle)
    upstreamSignal?.removeEventListener("abort", forwardAbort)
  }
}
