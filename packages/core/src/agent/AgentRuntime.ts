import type { FilesystemAuthorizationSnapshot, RuntimeConfig } from "@socrates/contracts"
import type {
  ModelEvent,
  ModelMessage,
  ModelMessageContent,
  ModelMessagePart,
  ModelProvider,
  ModelRequest,
  ModelUsage,
} from "@socrates/providers"
import { createId, SocratesError } from "@socrates/shared"
import type { ContextCompressionRuntime } from "../context/contextCompression"
import type { CapabilitySet } from "../capabilities/CapabilityCatalog"
import type { ToolExecutors } from "../tools/types"
import type { AgentStructuredOutputSchema } from "./AgentDefinition"
import { ContextPipeline, type AgentContextPipeline } from "./ContextPipeline"

type AgentRuntimeBaseInput = {
  provider: ModelProvider
  providerId: RuntimeConfig["providerId"]
  modelId: string
  runtimeConfig: RuntimeConfig
  system: string
  userContent?: ModelMessageContent
  messages?: ModelMessage[]
  capabilitySet: CapabilitySet
  toolExecutors: ToolExecutors | Record<string, never>
  maxToolCalls: number
  projectId: string
  conversationId: string
  sessionId: string
  turnId: string
  workspacePath: string
  filesystemAuthorization?: FilesystemAuthorizationSnapshot
  cacheKey?: string
  providerRouting?: ModelRequest["providerRouting"]
  abortSignal?: AbortSignal
  contextCompression?: ContextCompressionRuntime
  onModelEvent?: (event: ModelEvent) => void
  onUsage?: (usage: ModelUsage) => void
  onToolResult?: (result: { toolCallId: string; toolName: string; input: unknown; output: unknown }) => void
  createModelCall?: (input: {
    messages: ModelMessage[]
    estimatedTokens: number
    tokenCount: Awaited<ReturnType<ModelProvider["countTokens"]>>
    tools: ReturnType<CapabilitySet["modelDefinitions"]>
    attempt: number
  }) => string | undefined
}

export type AgentRuntimeStructuredInput<TOutput> = AgentRuntimeBaseInput & {
  completion: {
    mode: "structured" | "streaming_tools_structured_final"
    schema: AgentStructuredOutputSchema<TOutput>
    maxOutputRepairAttempts?: number
  }
}

export type AgentRuntimeTextInput = AgentRuntimeBaseInput & {
  completion: {
    mode: "text"
    validate?: (text: string) => string
  }
}

export type AgentRuntimeModelStepInput = {
  provider: ModelProvider
  providerId: RuntimeConfig["providerId"]
  modelId: string
  runtimeConfig: RuntimeConfig
  system: string
  messages: ModelMessage[]
  tools: ReturnType<CapabilitySet["modelDefinitions"]>
  structuredOutputSchema?: unknown
  sessionId?: string
  cacheKey?: string
  modelCallId?: string
  providerRouting?: ModelRequest["providerRouting"]
  abortSignal?: AbortSignal
}

export type AgentRuntimeStructuredResult<TOutput> = {
  mode: "structured" | "streaming_tools_structured_final"
  output: TOutput
  toolCalls: number
  usages: ModelUsage[]
}

export type AgentRuntimeTextResult = {
  mode: "text"
  output: string
  toolCalls: number
  usages: ModelUsage[]
}

export type AgentRuntimeResult<TOutput> = AgentRuntimeTextResult | AgentRuntimeStructuredResult<TOutput>

type NativeToolCall = {
  toolCallId: string
  toolName: string
  input: unknown
  providerMetadata?: Record<string, Record<string, unknown>>
}

type RuntimeLoopState = {
  messages: ModelMessage[]
  usages: ModelUsage[]
  usedToolCalls: number
}

export class AgentRuntime {
  constructor(private readonly contextPipeline: AgentContextPipeline = new ContextPipeline()) {}

  run(input: AgentRuntimeModelStepInput): AsyncIterable<ModelEvent>
  async run(input: AgentRuntimeTextInput): Promise<AgentRuntimeTextResult>
  async run<TOutput>(input: AgentRuntimeStructuredInput<TOutput>): Promise<AgentRuntimeStructuredResult<TOutput>>
  run<TOutput>(
    input: AgentRuntimeModelStepInput | AgentRuntimeTextInput | AgentRuntimeStructuredInput<TOutput>,
  ): AsyncIterable<ModelEvent> | Promise<AgentRuntimeTextResult | AgentRuntimeStructuredResult<TOutput>> {
    if (!("completion" in input)) return runModelStep(input)
    return this.runCompletion(input)
  }

  private async runCompletion<TOutput>(
    input: AgentRuntimeTextInput | AgentRuntimeStructuredInput<TOutput>,
  ): Promise<AgentRuntimeTextResult | AgentRuntimeStructuredResult<TOutput>> {
    const state = await runToolLoop(input, this.contextPipeline)
    if (input.completion.mode === "text") {
      const output = await generateTextFinal(input as AgentRuntimeTextInput, state, this.contextPipeline)
      return { mode: "text", output, toolCalls: state.usedToolCalls, usages: state.usages }
    }
    const structuredInput = input as AgentRuntimeStructuredInput<TOutput>
    const output = await generateStructuredFinal(structuredInput, state, this.contextPipeline)
    return { mode: structuredInput.completion.mode, output, toolCalls: state.usedToolCalls, usages: state.usages }
  }
}

const runModelStep = async function* (input: AgentRuntimeModelStepInput): AsyncIterable<ModelEvent> {
  for await (const event of input.provider.stream({
    providerId: input.providerId,
    modelId: input.modelId,
    system: input.system,
    messages: input.messages,
    runtimeConfig: input.runtimeConfig,
    tools: input.tools,
    ...(input.structuredOutputSchema === undefined ? {} : { structuredOutputSchema: input.structuredOutputSchema }),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.cacheKey ? { cacheKey: input.cacheKey } : {}),
    ...(input.modelCallId ? { modelCallId: input.modelCallId } : {}),
    ...(input.providerRouting ? { providerRouting: input.providerRouting } : {}),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  })) {
    if (event.type === "model.failed") throw event.error
    yield event
  }
}

const runToolLoop = async <TOutput>(
  input: AgentRuntimeTextInput | AgentRuntimeStructuredInput<TOutput>,
  contextPipeline: AgentContextPipeline,
): Promise<RuntimeLoopState> => {
  let messages: ModelMessage[] = input.messages
    ? [...input.messages]
    : [{ role: "user", content: input.userContent ?? "" }]
  const usages: ModelUsage[] = []
  let usedToolCalls = 0

  while (usedToolCalls < input.maxToolCalls) {
    const assistantParts: ModelMessagePart[] = []
    const toolCalls: NativeToolCall[] = []
    let answerText = ""
    const tools = input.capabilitySet.modelDefinitions()
    const prepared = await contextPipeline.prepare({
      provider: input.provider,
      providerId: input.providerId,
      modelId: input.modelId,
      runtimeConfig: input.runtimeConfig,
      system: input.system,
      messages,
      tools,
      ...(input.contextCompression ? { compression: input.contextCompression } : {}),
    })
    messages = prepared.messages
    for await (const event of streamModel(input, messages, tools)) {
      if (event.type === "model.answer.delta") answerText += event.text
      if (event.type === "model.tool_call.completed") {
        toolCalls.push({
          toolCallId: event.toolCall.toolCallId,
          toolName: event.toolCall.toolName,
          input: event.toolCall.input ?? {},
          ...(event.toolCall.providerMetadata ? { providerMetadata: event.toolCall.providerMetadata } : {}),
        })
      }
    }
    if (toolCalls.length === 0) break
    if (answerText.trim()) assistantParts.push({ type: "text", text: answerText })
    const allowed = toolCalls.slice(0, input.maxToolCalls - usedToolCalls)
    assistantParts.push(...allowed.map(toAssistantToolPart))
    const results = []
    for (const toolCall of allowed) {
      const result = await executeScopedTool(input, toolCall)
      results.push(result)
      input.onToolResult?.({ ...result, input: toolCall.input })
      usedToolCalls += 1
    }
    messages.push({ role: "assistant", content: assistantParts })
    messages.push({
      role: "tool",
      content: results.map((result) => ({
        type: "tool-result",
        toolCallId: result.toolCallId,
        toolName: result.toolName,
        output: result.output,
      })),
    })
  }
  return { messages, usages, usedToolCalls }

  async function* streamModel(
    runtimeInput: AgentRuntimeTextInput | AgentRuntimeStructuredInput<TOutput>,
    currentMessages: ModelMessage[],
    tools: ReturnType<CapabilitySet["modelDefinitions"]>,
  ): AsyncIterable<ModelEvent> {
    for await (const event of runtimeInput.provider.stream({
      providerId: runtimeInput.providerId,
      modelId: runtimeInput.modelId,
      system: runtimeInput.system,
      messages: currentMessages,
      runtimeConfig: runtimeInput.runtimeConfig,
      tools,
      modelCallId: createId("mcall"),
      sessionId: runtimeInput.sessionId,
      ...(runtimeInput.cacheKey ? { cacheKey: runtimeInput.cacheKey } : {}),
      ...(runtimeInput.providerRouting ? { providerRouting: runtimeInput.providerRouting } : {}),
      ...(runtimeInput.abortSignal ? { abortSignal: runtimeInput.abortSignal } : {}),
    })) {
      runtimeInput.onModelEvent?.(event)
      if (event.type === "model.usage") {
        usages.push(event.usage)
        runtimeInput.onUsage?.(event.usage)
      }
      if (event.type === "model.failed") throw event.error
      yield event
    }
  }
}

const generateTextFinal = async (
  input: AgentRuntimeTextInput,
  state: RuntimeLoopState,
  contextPipeline: AgentContextPipeline,
): Promise<string> => {
  const messages = [...state.messages, {
    role: "developer" as const,
    content: "Finish now. Return only the final text requested by the system contract. Do not call tools.",
  }]
  const prepared = await contextPipeline.prepare({
    provider: input.provider,
    providerId: input.providerId,
    modelId: input.modelId,
    runtimeConfig: input.runtimeConfig,
    system: input.system,
    messages,
    ...(input.contextCompression ? { compression: input.contextCompression } : {}),
  })
  let text = ""
  for await (const event of input.provider.stream({
    providerId: input.providerId,
    modelId: input.modelId,
    system: input.system,
    messages: prepared.messages,
    runtimeConfig: input.runtimeConfig,
    tools: [],
    modelCallId: createId("mcall"),
    sessionId: input.sessionId,
    ...(input.cacheKey ? { cacheKey: `${input.cacheKey}:text-final` } : {}),
    ...(input.providerRouting ? { providerRouting: input.providerRouting } : {}),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  })) {
    input.onModelEvent?.(event)
    if (event.type === "model.answer.delta") text += event.text
    if (event.type === "model.usage") {
      state.usages.push(event.usage)
      input.onUsage?.(event.usage)
    }
    if (event.type === "model.failed") throw event.error
  }
  const output = text.trim()
  if (!output) throw new SocratesError("agent_text_output_empty", "Agent completed without returning text.", { recoverable: true })
  return input.completion.validate ? input.completion.validate(output) : output
}

const generateStructuredFinal = async <TOutput>(
  input: AgentRuntimeStructuredInput<TOutput>,
  state: RuntimeLoopState,
  contextPipeline: AgentContextPipeline,
): Promise<TOutput> => {
  if (!input.provider.generateStructured) {
    throw new SocratesError("structured_generation_unavailable", "This agent requires provider structured generation.", { recoverable: true })
  }
  const messages: ModelMessage[] = [...state.messages, {
    role: "developer",
    content: "Finish now. Return only the strict structured result requested by the system contract. Do not call tools.",
  }]
  let lastValidation: unknown
  let lastOutput: unknown
  const maxOutputRepairAttempts = input.completion.maxOutputRepairAttempts ?? 1
  for (let attempt = 0; attempt <= maxOutputRepairAttempts; attempt += 1) {
    const prepared = await contextPipeline.prepare({
      provider: input.provider,
      providerId: input.providerId,
      modelId: input.modelId,
      runtimeConfig: input.runtimeConfig,
      system: input.system,
      messages,
      ...(input.contextCompression ? { compression: input.contextCompression } : {}),
    })
    const modelCallId = input.createModelCall?.({
      messages: prepared.messages,
      estimatedTokens: prepared.estimatedTokens,
      tokenCount: prepared.tokenCount,
      tools: [],
      attempt: attempt + 1,
    }) ?? createId("mcall")
    input.onModelEvent?.({ type: "model.started", modelCallId })
    let generated
    try {
      generated = await input.provider.generateStructured<TOutput>({
        providerId: input.providerId,
        modelId: input.modelId,
        system: input.system,
        messages: prepared.messages,
        runtimeConfig: input.runtimeConfig,
        schema: input.completion.schema,
        modelCallId,
        sessionId: input.sessionId,
        ...(input.cacheKey ? { cacheKey: `${input.cacheKey}:structured-final:${attempt + 1}` } : {}),
        ...(input.providerRouting ? { providerRouting: input.providerRouting } : {}),
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      })
    } catch (error) {
      input.onModelEvent?.({ type: "model.failed", error: error instanceof Error ? error : new Error(String(error)), modelCallId })
      if (attempt < maxOutputRepairAttempts && isRepairableStructuredGenerationError(error)) {
        lastValidation = structuredGenerationErrorSummary(error)
        messages.push({
          role: "developer",
          content: "Your previous structured result could not be parsed. Retry once and return only the complete strict JSON object required by the system contract, with no prose or Markdown fences.",
        })
        continue
      }
      throw error
    }
    if (generated.usage) {
      state.usages.push(generated.usage)
      input.onUsage?.(generated.usage)
      input.onModelEvent?.({ type: "model.usage", usage: generated.usage, modelCallId })
    }
    const parsed = input.completion.schema.safeParse(generated.output)
    input.onModelEvent?.({
      type: "model.completed",
      ...(generated.usage ? { usage: generated.usage } : {}),
      finishReason: "structured",
      modelCallId,
    })
    if (parsed.success) return parsed.data
    lastValidation = parsed.error.flatten()
    lastOutput = generated.output
    if (attempt < maxOutputRepairAttempts) {
      messages.push({ role: "assistant", content: boundedJson(generated.output, 4_000) })
      messages.push({
        role: "developer",
        content: `Your structured result failed validation. Correct only the reported fields and return the complete strict object again. Validation: ${boundedJson(lastValidation, 4_000)}`,
      })
    }
  }
  throw new SocratesError(
    "structured_agent_output_invalid",
    `Structured agent output did not match its schema after ${maxOutputRepairAttempts} bounded repair attempt${maxOutputRepairAttempts === 1 ? "" : "s"}.`,
    {
      details: { validation: boundedJson(lastValidation, 4_000), outputPreview: boundedJson(lastOutput, 2_000) },
      recoverable: true,
    },
  )
}

const isRepairableStructuredGenerationError = (error: unknown): boolean => {
  if (!(error instanceof SocratesError)) return false
  if (["deepseek_structured_output_invalid", "ollama_structured_output_invalid"].includes(error.code)) return true
  if (error.code !== "model_provider_error" || !error.details || typeof error.details !== "object" || Array.isArray(error.details)) return false
  return (error.details as Record<string, unknown>).name === "AI_NoObjectGeneratedError"
}

const structuredGenerationErrorSummary = (error: unknown): unknown => error instanceof SocratesError
  ? { code: error.code, message: error.message, details: error.details }
  : { message: error instanceof Error ? error.message : String(error) }

const executeScopedTool = async <TOutput>(
  input: AgentRuntimeTextInput | AgentRuntimeStructuredInput<TOutput>,
  toolCall: NativeToolCall,
): Promise<{ toolCallId: string; toolName: string; output: unknown }> => {
  const tool = input.capabilitySet.get(toolCall.toolName)
  if (!tool) {
    return {
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      output: { error: { code: "tool_not_found", message: "Tool is not registered." } },
    }
  }
  const parsed = tool.inputSchema.safeParse(toolCall.input)
  if (!parsed.success) {
    return {
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      output: { error: { code: "invalid_tool_input", message: "Correct the tool input and retry.", details: parsed.error.flatten() } },
    }
  }
  try {
    const output = await tool.execute(parsed.data, {
      projectId: input.projectId,
      conversationId: input.conversationId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      workspacePath: input.workspacePath,
      ...(input.filesystemAuthorization ? { filesystemAuthorization: input.filesystemAuthorization } : {}),
      runtimeConfig: input.runtimeConfig,
      executors: input.toolExecutors as ToolExecutors,
      requestApproval: async () => ({
        decision: "rejected",
        reason: "This backend agent may only use its explicitly scoped automatic tools.",
      }),
      onOutput: () => undefined,
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    })
    const validated = tool.resultSchema.safeParse(output)
    return {
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      output: validated.success
        ? validated.data
        : { error: { code: "invalid_tool_output", message: "Tool output failed validation." } },
    }
  } catch (error) {
    return {
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      output: {
        error: {
          code: "tool_failed",
          message: error instanceof Error ? error.message : String(error),
          recoverable: true,
        },
      },
    }
  }
}

const toAssistantToolPart = (toolCall: NativeToolCall): ModelMessagePart => ({
  type: "tool-call",
  toolCallId: toolCall.toolCallId,
  toolName: toolCall.toolName,
  input: toolCall.input,
  ...(toolCall.providerMetadata ? { providerMetadata: toolCall.providerMetadata } : {}),
})

const boundedJson = (value: unknown, limit: number): string => {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    serialized = String(value)
  }
  return serialized.length > limit ? `${serialized.slice(0, limit)}...` : serialized
}
