import {
  chatCompactionSchema,
  memoryCompactionSchema,
  type ChatCompaction,
  type MemoryCompaction,
  type RuntimeConfig,
} from "@socrates/contracts"
import type { ModelProvider, ModelUsage } from "@socrates/providers"
import type { ProviderAuthMode, ProviderId, ThinkingEffort } from "@socrates/contracts"
import { SocratesError } from "@socrates/shared"
import { AgentInstance } from "./AgentInstance"
import type { AgentDefinition } from "./AgentDefinition"
import type { AgentRuntimeStructuredResult } from "./AgentRuntime"
import {
  chatCompressorAgentDefinition,
  memoryCompressorAgentDefinition,
  type DynamicSystemPromptContext,
} from "./agentDefinitions"

export type CompressorAgentMode = "chat" | "memory"

export type CompressorAgentModel = {
  providerId: ProviderId
  authMode?: ProviderAuthMode
  modelId: string
  thinkingEnabled?: boolean
  thinkingEffort?: ThinkingEffort
}

export type CompressorAgentRunInput = {
  provider: ModelProvider
  mode: CompressorAgentMode
  primary: CompressorAgentModel
  fallback?: CompressorAgentModel
  fallbacks?: CompressorAgentModel[]
  system: string
  userContent: string
  projectId: string
  conversationId: string
  sessionId: string
  turnId: string
  workspacePath: string
  allowedTurnNumbers?: number[]
}

export type CompressorAgentResult =
  | {
      mode: "chat"
      output: ChatCompaction
      providerId: ProviderId
      modelId: string
      usage?: ModelUsage
      repairedAnchors: boolean
      attempts: number
    }
  | {
      mode: "memory"
      output: MemoryCompaction
      providerId: ProviderId
      modelId: string
      usage?: ModelUsage
      repairedAnchors: boolean
      attempts: number
    }

export class CompressorAgent {
  async run(input: CompressorAgentRunInput): Promise<CompressorAgentResult> {
    if (!input.provider.generateStructured) {
      throw new SocratesError("compressor_structured_generation_unavailable", "Compressor requires provider.generateStructured().", {
        recoverable: true,
      })
    }

    const candidates = uniqueByModel([
      input.primary,
      ...(input.fallback ? [input.fallback] : []),
      ...(input.fallbacks ?? []),
    ])
    let lastError: unknown
    let totalAttempts = 0

    for (const [candidateIndex, candidate] of candidates.entries()) {
      const outputRepairAttempts = candidateIndex === 0 ? 1 : 0
      totalAttempts += 1
      try {
        return await this.runOnce(input, candidate, totalAttempts, outputRepairAttempts)
      } catch (error) {
        lastError = error
      }
      if (candidateIndex === 0 && shouldRetryPrimaryOutsideStructuredRepair(lastError)) {
        totalAttempts += 1
        try {
          return await this.runOnce(input, candidate, totalAttempts, 0)
        } catch (error) {
          lastError = error
        }
      }
    }

    throw normalizeCompressorError(lastError)
  }

  private async runOnce(
    input: CompressorAgentRunInput,
    model: CompressorAgentModel,
    attemptNumber: number,
    maxOutputRepairAttempts: number,
  ): Promise<CompressorAgentResult> {
    const schema = schemaForMode(input.mode)
    const definition = (input.mode === "chat"
      ? chatCompressorAgentDefinition
      : memoryCompressorAgentDefinition) as AgentDefinition<DynamicSystemPromptContext, unknown>
    const generated = await this.runStructured(
      input,
      model,
      definition,
      input.system,
      input.userContent,
      maxOutputRepairAttempts,
    )

    const strict = schema.safeParse(generated.output)
    if (!strict.success) {
      throw new SocratesError("compressor_schema_validation_failed", "Compressor output did not match the required schema.", {
        details: strict.error.flatten(),
        recoverable: true,
      })
    }
    assertAnchorTurnsAllowed(strict.data as { anchors: string[] }, input.allowedTurnNumbers)
    const output = enforceDeterministicCarryover(input.mode, strict.data, input.userContent, schema)
    const usage = mergeUsages(generated.usages)

    return {
      mode: input.mode,
      output: output as never,
      providerId: model.providerId,
      modelId: model.modelId,
      ...(usage ? { usage } : {}),
      repairedAnchors: false,
      attempts: attemptNumber,
    } as CompressorAgentResult
  }

  private runStructured<TOutput>(
    input: CompressorAgentRunInput,
    model: CompressorAgentModel,
    definition: AgentDefinition<DynamicSystemPromptContext, TOutput>,
    system: string,
    userContent: string,
    maxOutputRepairAttempts: number,
  ): Promise<AgentRuntimeStructuredResult<TOutput>> {
    return new AgentInstance(definition).run({
      provider: input.provider,
      providerId: model.providerId,
      modelId: model.modelId,
      runtimeConfig: compressorRuntimeConfig(model),
      promptContext: { system },
      userContent,
      toolExecutors: {},
      maxOutputRepairAttempts,
      projectId: input.projectId,
      conversationId: input.conversationId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      workspacePath: input.workspacePath,
    }).then((result) => {
      if (result.mode === "text") {
        throw new SocratesError("agent_completion_mode_mismatch", "Compressor returned text instead of its structured contract.")
      }
      return result
    })
  }
}

const enforceDeterministicCarryover = <TOutput>(
  mode: CompressorAgentMode,
  output: TOutput,
  userContent: string,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: unknown; error?: { flatten: () => unknown } } },
): TOutput => {
  if (
    mode !== "chat" ||
    !output ||
    typeof output !== "object" ||
    !("criticalContext" in output) ||
    !("relevantFiles" in output) ||
    !("toolState" in output) ||
    !("blocked" in output)
  ) return output
  const record = output as TOutput & { criticalContext: string[]; relevantFiles: string[]; toolState: string[]; blocked: string[] }
  const paths = Array.from(userContent.matchAll(/\.socrates\/attachments\/[A-Za-z0-9._/-]+/g))
    .map((match) => match[0].replace(/[.,;:]+$/, ""))
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 8)
  const missing = paths.filter((attachmentPath) => !record.relevantFiles.some((line) => line.includes(attachmentPath)))
  const carriedCommands = Array.from(userContent.matchAll(/Exact historical command:\s*((?:pnpm|npm|yarn|bun|git)\s+[^\n`]{1,300})/g))
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value))
  const detectedCommands = Array.from(userContent.matchAll(/\b(?:pnpm|npm|yarn|bun|git)\s+[^\n`]{1,300}?(?=\s+and the file\b|[.;](?:\s|$)|\r?\n|$)/g))
    .map((match) => match[0].trim())
  const commands = [...carriedCommands, ...detectedCommands]
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 8)
  const missingCommands = commands.filter((command) => !record.toolState.some((line) => line.includes(command)))
  const unresolvedInstructions = userContent
    .split(/\r?\n/)
    .map((line) => line.replace(/^User:\s*/i, "").trim())
    .filter((line) => /\bunresolved task\b|\bdo not mark (?:it )?completed\b/i.test(line))
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 8)
  const missingUnresolved = unresolvedInstructions.filter((instruction) => !record.blocked.some((line) => line.includes(instruction)))
  const exactIdentifiers = extractExactIdentifiers(userContent)
  const missingIdentifiers = exactIdentifiers.filter(({ identifier }) => !containsExactIdentifier(record, identifier))
  if (missing.length === 0 && missingCommands.length === 0 && missingUnresolved.length === 0 && missingIdentifiers.length === 0) return output
  const candidate = {
    ...record,
    criticalContext: [
      ...record.criticalContext,
      ...missingIdentifiers.map(({ sourceText }) => `Exact preserved source text: ${sourceText}`),
    ],
    relevantFiles: [
      ...record.relevantFiles,
      ...missing.map((attachmentPath) => `${attachmentPath}: conversation source attachment; inspect with read or search before relying on it.`),
    ],
    toolState: [
      ...record.toolState,
      ...missingCommands.map((command) => `Exact historical command: ${command}`),
    ],
    blocked: [
      ...record.blocked,
      ...missingUnresolved.map((instruction) => `Explicit unresolved user instruction: ${instruction}`),
    ],
  }
  const parsed = schema.safeParse(candidate)
  if (!parsed.success) {
    throw new SocratesError("compressor_deterministic_carryover_failed", "Required exact source artifacts could not fit the compaction schema.", {
      details: { validation: parsed.error?.flatten() },
      recoverable: true,
    })
  }
  return parsed.data as TOutput
}

const extractExactIdentifiers = (source: string): Array<{ identifier: string; sourceText: string }> => {
  const uppercaseSnakeOrKebab = source.match(/\b[A-Z][A-Z0-9]*(?:[_-][A-Z0-9]+){2,}\b/g) ?? []
  const shortVerificationCodes = source.match(/\b[A-Z]{2,}[A-Z0-9]*-\d{2,}\b/g) ?? []
  const prefixedOpaqueIds = source.match(/\b[a-z][a-z0-9]{1,20}_[0-9a-f]{12,}\b/g) ?? []
  return [...uppercaseSnakeOrKebab, ...shortVerificationCodes, ...prefixedOpaqueIds]
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 24)
    .map((identifier) => ({ identifier, sourceText: exactSourceSentence(source, identifier) }))
}

const exactSourceSentence = (source: string, identifier: string): string => {
  const identifierIndex = source.indexOf(identifier)
  if (identifierIndex < 0) return identifier
  const boundedStart = Math.max(0, identifierIndex - 240)
  const before = source.slice(boundedStart, identifierIndex)
  const boundaryOffset = Math.max(before.lastIndexOf("\n"), before.lastIndexOf(". "), before.lastIndexOf("? "), before.lastIndexOf("! "))
  const start = boundaryOffset >= 0 ? boundedStart + boundaryOffset + 1 : boundedStart
  const boundedEnd = Math.min(source.length, identifierIndex + identifier.length + 240)
  const after = source.slice(identifierIndex + identifier.length, boundedEnd)
  const nextBoundaries = [after.indexOf("\n"), after.indexOf(". "), after.indexOf("? "), after.indexOf("! ")].filter((index) => index >= 0)
  const end = nextBoundaries.length > 0 ? identifierIndex + identifier.length + Math.min(...nextBoundaries) + 1 : boundedEnd
  return source.slice(start, end).replace(/\s+/g, " ").trim()
}

const containsExactIdentifier = (summary: Record<string, unknown>, identifier: string): boolean =>
  Object.values(summary).some((field) =>
    typeof field === "string"
      ? field.includes(identifier)
      : Array.isArray(field) && field.some((item) => typeof item === "string" && item.includes(identifier)),
  )

const assertAnchorTurnsAllowed = (output: { anchors: string[] }, allowedTurnNumbers?: number[]): void => {
  if (!allowedTurnNumbers) return
  const allowed = new Set(allowedTurnNumbers)
  const invalid = output.anchors.filter((anchor) => {
    const match = /^Turn (\d+):/.exec(anchor)
    return !match || !allowed.has(Number(match[1]))
  })
  if (invalid.length > 0) {
    throw new SocratesError("compressor_anchor_turn_not_in_input", "Compressor anchors referenced turns that were not present in its input.", {
      details: { invalid, allowedTurnNumbers },
      recoverable: true,
    })
  }
}

const schemaForMode = (mode: CompressorAgentMode) =>
  mode === "chat" ? chatCompactionSchema : memoryCompactionSchema

const compressorRuntimeConfig = (model: CompressorAgentModel): RuntimeConfig => ({
  providerId: model.providerId,
  authMode: model.authMode ?? "api_key",
  modelId: model.modelId,
  thinkingEnabled: model.thinkingEnabled ?? false,
  ...(model.thinkingEffort ? { thinkingEffort: model.thinkingEffort } : model.thinkingEnabled ? {} : { thinkingEffort: "none" as const }),
  approvalMode: "read_only_auto" as const,
  sandboxMode: "read_only" as const,
})

const mergeUsage = (first?: ModelUsage, second?: ModelUsage): ModelUsage | undefined => {
  if (!first) {
    return second
  }
  if (!second) {
    return first
  }
  const merged: ModelUsage = { ...first }
  assignSum(merged, "inputTokens", first.inputTokens, second.inputTokens)
  assignSum(merged, "outputTokens", first.outputTokens, second.outputTokens)
  assignSum(merged, "reasoningTokens", first.reasoningTokens, second.reasoningTokens)
  assignSum(merged, "cachedInputTokens", first.cachedInputTokens, second.cachedInputTokens)
  assignSum(merged, "cacheWriteTokens", first.cacheWriteTokens, second.cacheWriteTokens)
  assignSum(merged, "uncachedInputTokens", first.uncachedInputTokens, second.uncachedInputTokens)
  assignSum(merged, "totalTokens", first.totalTokens, second.totalTokens)
  assignSum(merged, "costUsd", first.costUsd, second.costUsd)
  return merged
}

const mergeUsages = (usages: ModelUsage[]): ModelUsage | undefined => usages.reduce<ModelUsage | undefined>(mergeUsage, undefined)

const sumDefined = (first?: number, second?: number): number | undefined =>
  first === undefined && second === undefined ? undefined : (first ?? 0) + (second ?? 0)

const assignSum = (usage: ModelUsage, key: keyof Pick<ModelUsage, "inputTokens" | "outputTokens" | "reasoningTokens" | "cachedInputTokens" | "cacheWriteTokens" | "uncachedInputTokens" | "totalTokens" | "costUsd">, first?: number, second?: number): void => {
  const value = sumDefined(first, second)
  if (value !== undefined) {
    usage[key] = value
  }
}

const uniqueByModel = <T extends CompressorAgentModel>(items: T[]): T[] => {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.providerId}:${item.authMode ?? "api_key"}:${item.modelId}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

const normalizeCompressorError = (error: unknown): Error =>
  error instanceof Error
    ? error
    : new SocratesError("compressor_failed", "Compressor failed.", {
        details: { error },
        recoverable: true,
      })

const shouldRetryPrimaryOutsideStructuredRepair = (error: unknown): boolean =>
  !(error instanceof SocratesError && error.code === "structured_agent_output_invalid")
