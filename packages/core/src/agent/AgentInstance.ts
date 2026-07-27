import type { RuntimeConfig } from "@socrates/contracts"
import type {
  ModelMessage,
  ModelMessageContent,
  ModelProvider,
  ModelRequest,
  ModelUsage,
} from "@socrates/providers"
import { SocratesError } from "@socrates/shared"
import type { ContextCompressionRuntime } from "../context/contextCompression"
import type { ToolRegistry } from "../tools/registry"
import type { ToolExecutors } from "../tools/types"
import { assertRoleManifestMatchesTools, type AgentDefinition } from "./AgentDefinition"
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
  toolRegistry: ToolRegistry
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
  ) {}

  async run(input: AgentInstanceInput<TPromptContext>): Promise<AgentRuntimeResult<TOutput>> {
    if ((input.messages === undefined) === (input.userContent === undefined)) {
      throw new SocratesError(
        "agent_message_input_invalid",
        `Agent ${this.definition.id} requires exactly one of messages or userContent.`,
      )
    }
    assertRoleManifestMatchesRegistry(this.definition, input.toolRegistry)
    assertContextProfileSupportsRun(this.definition, input)
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
      toolRegistry: input.toolRegistry,
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

const assertContextProfileSupportsRun = <TPromptContext, TOutput>(
  definition: AgentDefinition<TPromptContext, TOutput>,
  input: Pick<AgentInstanceInput<TPromptContext>, "contextCompression" | "toolRegistry">,
): void => {
  const stages = definition.contextProfile.stages
  if (input.toolRegistry.list().length > 0 && !stages.includes("tool_definitions")) {
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

const assertRoleManifestMatchesRegistry = <TPromptContext, TOutput>(
  definition: AgentDefinition<TPromptContext, TOutput>,
  registry: ToolRegistry,
): void => {
  try {
    assertRoleManifestMatchesTools(
      definition,
      registry.list().map((tool) => tool.name),
    )
  } catch (error) {
    throw new SocratesError(
      "agent_role_manifest_mismatch",
      error instanceof Error ? error.message : String(error),
    )
  }
}
