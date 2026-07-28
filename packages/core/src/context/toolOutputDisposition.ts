import {
  contextDispositionToolOutputSchema,
  type ContextDispositionToolInput,
  type ContextDispositionToolOutput,
  type NormalizedToolCall,
  type ProviderId,
} from "@socrates/contracts"
import { estimateTextTokens, type ModelMessage, type ModelMessagePart } from "@socrates/providers"

export const TOOL_OUTPUT_RELEASE_TRIGGER_TOKENS = 3_000

const REMINDER_OPEN = "<socrates_large_temporary_results>"
const REMINDER_CLOSE = "</socrates_large_temporary_results>"

type ToolResultPart = Extract<ModelMessagePart, { type: "tool-result" }>

type ReminderBatch = {
  message: ModelMessage
  handles: string[]
}

type Candidate = {
  result: string
  toolName: string
  target: string
  estimatedTokens: number
  part: ToolResultPart
  batch: ReminderBatch
}

export class ToolOutputDispositionLedger {
  private readonly candidates = new Map<string, Candidate>()
  private nextResultNumber = 1

  constructor(private readonly messages: ModelMessage[]) {}

  recordBatch(input: {
    message: ModelMessage
    toolCalls: NormalizedToolCall[]
    providerId: ProviderId
    modelId: string
  }): void {
    if (input.message.role !== "tool" || !Array.isArray(input.message.content)) return
    const callsById = new Map<string, NormalizedToolCall>()
    for (const call of input.toolCalls) {
      callsById.set(call.toolCallId, call)
      if (call.providerToolCallId) callsById.set(call.providerToolCallId, call)
    }
    const batch: ReminderBatch = { message: { role: "developer", content: "" }, handles: [] }
    for (const part of input.message.content) {
      if (part.type !== "tool-result" || part.toolName === "context_disposition" || !isSuccessfulToolOutput(part.output)) continue
      const estimatedTokens = estimateTextTokens(safeStringify(part.output), {
        providerId: input.providerId,
        modelId: input.modelId,
        applySafetyMargin: false,
      }).inputTokens
      if (estimatedTokens <= TOOL_OUTPUT_RELEASE_TRIGGER_TOKENS) continue
      const result = `R${this.nextResultNumber}`
      this.nextResultNumber += 1
      const call = callsById.get(part.toolCallId)
      const candidate: Candidate = {
        result,
        toolName: part.toolName,
        target: targetFor(part.toolName, call?.input),
        estimatedTokens,
        part,
        batch,
      }
      batch.handles.push(result)
      this.candidates.set(result, candidate)
    }
    if (batch.handles.length === 0) return
    batch.message.content = renderReminder(batch.handles.map((handle) => this.candidates.get(handle)!))
    this.messages.push(batch.message)
  }

  apply(input: ContextDispositionToolInput, piggybacked: boolean): ContextDispositionToolOutput {
    const released: string[] = []
    const ignored: string[] = []
    const touchedBatches = new Set<ReminderBatch>()
    for (const result of input.release) {
      const candidate = this.candidates.get(result)
      if (!candidate) {
        ignored.push(result)
        continue
      }
      replaceToolResultOutput(candidate.part, {
        contextDisposition: "released",
        result: candidate.result,
        toolName: candidate.toolName,
        target: candidate.target,
        exactEvidence: "The exact tool output remains immutable in the current-turn audit.",
        retrievalHint: retrievalHint(candidate.toolName),
      })
      this.candidates.delete(candidate.result)
      released.push(candidate.result)
      touchedBatches.add(candidate.batch)
    }
    for (const batch of touchedBatches) this.refreshReminder(batch)
    const dispositionSummary = released.length === 0
      ? "No current-turn tool outputs were released."
      : `Released ${released.length} current-turn tool-result projection${released.length === 1 ? "" : "s"}.`
    return contextDispositionToolOutputSchema.parse({
      released,
      ignored,
      piggybacked,
      summary: piggybacked
        ? dispositionSummary
        : `${dispositionSummary} This control was called without a normal tool and used an avoidable model response.`,
    })
  }

  pendingResults(): string[] {
    return [...this.candidates.keys()]
  }

  private refreshReminder(batch: ReminderBatch): void {
    const active = batch.handles.flatMap((handle) => {
      const candidate = this.candidates.get(handle)
      return candidate ? [candidate] : []
    })
    if (active.length > 0) {
      batch.message.content = renderReminder(active)
      return
    }
    const index = this.messages.indexOf(batch.message)
    if (index >= 0) this.messages.splice(index, 1)
  }
}

const renderReminder = (candidates: Candidate[]): string => [
  REMINDER_OPEN,
  ...candidates.map((candidate) =>
    `Large temporary result ${candidate.result}: ${candidate.target}, ~${candidate.estimatedTokens} tokens. After extracting what you need, release ${candidate.result} alongside your next normal tool call. If still needed or answering now, do nothing.`),
  REMINDER_CLOSE,
].join("\n")

const targetFor = (toolName: string, input: unknown): string => {
  const record = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : undefined
  for (const key of ["path", "url", "query", "name", "command", "operation"] as const) {
    const value = record?.[key]
    if (typeof value === "string" && value.trim()) return `${toolName} ${clip(value, 80)}`
  }
  return toolName
}

const clip = (value: string, limit: number): string => {
  const compact = value.replace(/\s+/g, " ").trim()
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 3)}...`
}

const isSuccessfulToolOutput = (value: unknown): boolean =>
  typeof value === "object" && value !== null && !Array.isArray(value) && (value as { ok?: unknown }).ok === true

const replaceToolResultOutput = (part: ToolResultPart, replacement: unknown): void => {
  if (typeof part.output === "object" && part.output !== null && !Array.isArray(part.output)) {
    part.output = { ...(part.output as Record<string, unknown>), output: replacement }
    return
  }
  part.output = replacement
}

const retrievalHint = (toolName: string): string =>
  `Rerun a narrower ${toolName} call during this turn or use trace_retrieve audit after the turn.`

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
