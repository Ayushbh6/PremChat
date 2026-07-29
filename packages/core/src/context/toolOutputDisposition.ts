import {
  contextDispositionToolOutputSchema,
  type ContextDispositionToolInput,
  type ContextDispositionToolOutput,
  type NormalizedToolCall,
  type ProviderId,
} from "@socrates/contracts"
import type { ModelMessage, ModelMessagePart } from "@socrates/providers"
import { appendResultLocalNotice, removeResultLocalNotice } from "./resultLocalNotices"

export const TOOL_OUTPUT_RELEASE_TRIGGER_TOKENS = 3_000

type ToolResultPart = Extract<ModelMessagePart, { type: "tool-result" }>

type Candidate = {
  result: string
  toolCallId: string
  toolName: string
  target: string
  estimatedTokens: number
  part: ToolResultPart
}

export type ContextResultAssignment = Readonly<{ result: string; toolCallId: string }>

export class ToolOutputDispositionLedger {
  private readonly candidates = new Map<string, Candidate>()
  private nextResultNumber = 1

  constructor(_messages?: ModelMessage[]) {}

  recordBatch(input: {
    message: ModelMessage
    toolCalls: NormalizedToolCall[]
    rawResults?: Array<{ toolCallId: string; providerToolCallId?: string | undefined; output?: unknown; ok: boolean }>
    providerId: ProviderId
    modelId: string
  }): ContextResultAssignment[] {
    if (input.message.role !== "tool" || !Array.isArray(input.message.content)) return []
    const callsById = new Map<string, NormalizedToolCall>()
    for (const call of input.toolCalls) {
      callsById.set(call.toolCallId, call)
      if (call.providerToolCallId) callsById.set(call.providerToolCallId, call)
    }
    const rawById = new Map<string, unknown>()
    for (const result of input.rawResults ?? []) {
      if (!result.ok) continue
      rawById.set(result.toolCallId, result.output)
      if (result.providerToolCallId) rawById.set(result.providerToolCallId, result.output)
    }
    const assignments: ContextResultAssignment[] = []
    for (const part of input.message.content) {
      if (part.type !== "tool-result" || part.toolName === "context_disposition" || !isSuccessfulToolOutput(part.output)) continue
      const estimatedTokens = estimateToolOutputTokens(safeStringify(rawById.get(part.toolCallId) ?? part.output))
      if (estimatedTokens <= TOOL_OUTPUT_RELEASE_TRIGGER_TOKENS) continue
      const result = `R${this.nextResultNumber}`
      this.nextResultNumber += 1
      const call = callsById.get(part.toolCallId)
      const candidate: Candidate = {
        result,
        toolCallId: call?.toolCallId ?? part.toolCallId,
        toolName: part.toolName,
        target: targetFor(part.toolName, call?.input),
        estimatedTokens,
        part,
      }
      this.candidates.set(result, candidate)
      assignments.push({ result, toolCallId: candidate.toolCallId })
      appendResultLocalNotice(part, {
        kind: "large_result_release",
        key: result,
        text: renderReminder(candidate),
      })
    }
    return assignments
  }

  apply(input: ContextDispositionToolInput, piggybacked: boolean): ContextDispositionToolOutput {
    const released: string[] = []
    const ignored: string[] = []
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
      removeResultLocalNotice(candidate.part, "large_result_release", candidate.result)
    }
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

}

const renderReminder = (candidate: Candidate): string =>
  `Large temporary result ${candidate.result}: ${candidate.target}, ~${candidate.estimatedTokens} tokens. After extracting what you need, release ${candidate.result} alongside your next normal tool call. If still needed or answering now, do nothing.`

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

// Disposition is a lightweight steering threshold, not context-window accounting.
// A UTF-8 byte estimate avoids running the full model tokenizer after every tool batch.
const estimateToolOutputTokens = (value: string): number =>
  Math.ceil(new TextEncoder().encode(value).byteLength / 4)
