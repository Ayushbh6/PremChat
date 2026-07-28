import {
  toolExecutionResultSchema,
  type NormalizedToolCall,
  type ToolExecutionResult,
} from "@socrates/contracts"
import { SocratesError } from "@socrates/shared"
import type { StablePreludeToolRecord } from "./socratesMemorySupport"
import {
  mutationTargetFor,
  normalizedToolTargetKey,
  stableToolInputKey,
  toolCallTargetPreview,
} from "./socratesToolResultSupport"

export const isDynamicMcpToolName = (toolName: string): boolean => /^mcp__[a-z0-9_-]+__[a-zA-Z0-9_-]+$/.test(toolName)

export const isConfirmedToolErrorResult = (result: ToolExecutionResult): boolean =>
  result.ok === false && typeof result.error?.code === "string" && result.error.code.length > 0 && typeof result.error.message === "string" && result.error.message.length > 0

export const TOOL_DOCS_FAILURE_NUDGE = "Refer to tool_docs for tool usage before retrying this tool or choosing another tool."
export const MUTATION_SCHEMA_RECOVERY_HINT =
  'Runtime tool-schema recovery: the previous edit/apply_patch input was invalid. For a new file, call edit with exactly { "path": "relative/path.md", "content": "..." }. For a full rewrite of an existing file, use exactly { "path": "relative/path.md", "content": "...", "overwrite": true }. For a targeted replacement, use exactly { "path": "relative/path.md", "oldString": "...", "newString": "..." }. Do not mix content with oldString/newString, and do not set overwrite unless it is true.'
export const FAILED_MUTATION_FORCE_FINAL_THRESHOLD = 4
export const toolErrorResult = (toolCall: NormalizedToolCall, error: SocratesError): ToolExecutionResult =>
  toolExecutionResultSchema.parse({
    toolCallId: toolCall.toolCallId,
    providerToolCallId: toolCall.providerToolCallId,
    toolName: toolCall.toolName,
    ok: false,
    error: {
      code: error.code,
      message: `${error.message}\n\n${TOOL_DOCS_FAILURE_NUDGE}`,
      details: error.details,
    },
  })

export const interactiveTerminalAwaitingInput = (results: ToolExecutionResult[]): string | undefined => {
  for (const result of results) {
    if (!result.ok || result.toolName !== "bash" || !result.output || typeof result.output !== "object") {
      continue
    }
    const terminal = "terminal" in result.output ? result.output.terminal : undefined
    if (!terminal || typeof terminal !== "object") {
      continue
    }
    const name = "name" in terminal ? terminal.name : undefined
    const awaitingInput = "awaitingInput" in terminal ? terminal.awaitingInput : undefined
    if (awaitingInput === true && typeof name === "string" && name.trim()) {
      return name.trim()
    }
  }
  return undefined
}

export type LedgerRecordBatchInput = {
  toolCalls: NormalizedToolCall[]
  results: ToolExecutionResult[]
  estimatedTokens: number
  currentTurnTokenGrowth: number
}

export type MemorySaveLedgerBatchInput = {
  toolCalls: NormalizedToolCall[]
  results: ToolExecutionResult[]
}

export class ReconciliationVerificationLedger {
  private readonly targets = new Map<string, { label: string; mutated: boolean; verified: boolean }>()
  private readonly observed = new Map<string, { mutated: boolean; verified: boolean }>()
  private checkpointStarted = false

  beginCheckpoint(): void {
    this.checkpointStarted = true
    for (const [key, observed] of this.observed) {
      if (observed.mutated) {
        this.targets.set(key, { label: this.labelForKey(key), ...observed })
      }
    }
  }

  recordBatch(toolCalls: NormalizedToolCall[], results: ToolExecutionResult[]): void {
    const resultsById = new Map<string, ToolExecutionResult>()
    for (const result of results) {
      resultsById.set(result.toolCallId, result)
      if (result.providerToolCallId) resultsById.set(result.providerToolCallId, result)
    }
    for (const call of toolCalls) {
      const result = resultsById.get(call.toolCallId) ?? (call.providerToolCallId ? resultsById.get(call.providerToolCallId) : undefined)
      if (!result?.ok) continue
      const key = this.keyForCall(call)
      if (!key) continue
      const operation = toolOperation(call)
      const observed = this.observed.get(key) ?? { mutated: false, verified: false }
      if (operation === "edit" || operation === "patch_section") {
        observed.mutated = true
        observed.verified = false
      } else if (observed.mutated && isDocsReadOperation(operation)) {
        observed.verified = true
      }
      this.observed.set(key, observed)
      if (this.checkpointStarted && observed.mutated && !this.targets.has(key)) {
        this.targets.set(key, { label: this.labelForKey(key), ...observed })
      }
      const target = this.targets.get(key)
      if (target) Object.assign(target, observed)
    }
  }

  hasPending(): boolean {
    return [...this.targets.values()].some((target) => !target.mutated || !target.verified)
  }

  pendingSummary(): string {
    return [...this.targets.values()]
      .filter((target) => !target.mutated || !target.verified)
      .map((target) => `${target.label} (${target.mutated ? "needs post-write read" : "needs mutation and post-write read"})`)
      .join(", ")
  }

  private keyForCall(call: NormalizedToolCall): string | undefined {
    if (!call.input || typeof call.input !== "object" || Array.isArray(call.input)) return undefined
    const input = call.input as Record<string, unknown>
    const sectionId = typeof input.sectionId === "string" ? input.sectionId : undefined
    if (!sectionId) return undefined
    if (call.toolName === "project_docs") {
      const area = input.area === "notes" ? "notes" : input.area === "memory" ? "memory" : undefined
      return area ? `project:${area}:${sectionId}` : undefined
    }
    if (call.toolName === "repo_docs" && typeof input.path === "string") return `repo:${input.path}:${sectionId}`
    return undefined
  }

  private labelForKey(key: string): string {
    const parts = key.split(":")
    return parts.slice(1).join("/")
  }
}

export class TurnMemorySaveLedger {
  private readonly entries: string[] = []
  private readonly seen = new Set<string>()
  private renderedEntryCount = 0

  recordBatch(input: MemorySaveLedgerBatchInput): void {
    const callsById = new Map<string, NormalizedToolCall>()
    for (const toolCall of input.toolCalls) {
      callsById.set(toolCall.toolCallId, toolCall)
      if (toolCall.providerToolCallId) {
        callsById.set(toolCall.providerToolCallId, toolCall)
      }
    }
    for (const result of input.results) {
      const toolCall = callsById.get(result.toolCallId) ?? (result.providerToolCallId ? callsById.get(result.providerToolCallId) : undefined)
      this.recordResult(result, toolCall?.input)
    }
  }

  recordStablePreludeRecords(records: StablePreludeToolRecord[]): void {
    for (const record of records) {
      this.recordResult(record.result, record.input)
    }
  }

  flushDeveloperMessage(): string | undefined {
    if (this.entries.length === this.renderedEntryCount) {
      return undefined
    }
    this.renderedEntryCount = this.entries.length
    return [
      "<socrates_memory_save_ledger>",
      "Memory notes already submitted in this user turn:",
      ...this.entries.map((entry) => `- ${entry}`),
      "Rules: prefer no further memory_note calls unless a new candidate is materially different. The backend hard-caps distinct created notes at two per user turn, and normalized repeats return already_recorded.",
      "</socrates_memory_save_ledger>",
    ].join("\n")
  }

  private recordResult(result: ToolExecutionResult, input: unknown): void {
    if (result.toolName !== "memory_note") {
      return
    }
    const key = `${result.toolCallId}:${result.ok ? "ok" : "failed"}`
    if (this.seen.has(key)) {
      return
    }
    this.seen.add(key)
    if (!result.ok) {
      this.pushEntry(`failed ${result.error?.code ?? "error"}${result.error?.message ? `: ${clipInline(result.error.message, 180)}` : ""}${memoryNoteInputPreview(input)}`)
      return
    }
    const output = result.output && typeof result.output === "object" && !Array.isArray(result.output) ? result.output as Record<string, unknown> : {}
    const noteNumber = typeof output.noteNumber === "number" ? output.noteNumber : undefined
    const status = typeof output.status === "string" ? output.status : "open"
    const saveResult = output.result === "already_recorded" ? "already_recorded" : "created"
    this.pushEntry(`${noteNumber ? `#${noteNumber}` : "note"} ${saveResult} status=${status}${memoryNoteInputPreview(input)}`)
  }

  private pushEntry(entry: string): void {
    this.entries.push(entry)
    if (this.entries.length > 6) {
      this.entries.splice(0, this.entries.length - 6)
    }
  }
}

export const toolOperation = (toolCall: NormalizedToolCall | undefined): string | undefined => {
  const input = toolCall?.input && typeof toolCall.input === "object" && !Array.isArray(toolCall.input) ? toolCall.input as Record<string, unknown> : undefined
  return typeof input?.operation === "string" ? input.operation : undefined
}

export const isDocsReadOperation = (operation: string | undefined): boolean =>
  operation === undefined || operation === "read" || operation === "search" || operation === "read_index" || operation === "read_section"

export const memoryNoteInputPreview = (input: unknown): string => {
  const record = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : undefined
  return typeof record?.note === "string" && record.note.trim() ? `: ${clipInline(record.note, 180)}` : ""
}

export const clipInline = (value: string, limit: number): string => {
  const compact = value.replace(/\s+/g, " ").trim()
  return compact.length > limit ? `${compact.slice(0, Math.max(0, limit - 3))}...` : compact
}

export class TurnActionLedger {
  private readonly exactInputCounts = new Map<string, number>()
  private readonly targetCounts = new Map<string, number>()
  private readonly failedMutationCounts = new Map<string, number>()
  private readonly warnedTargets = new Set<string>()
  private readonly entries: string[] = []
  private forceFinalReason: string | undefined

  recordBatch(input: LedgerRecordBatchInput): { summary: string; warnings: string[]; forceFinalReason?: string } {
    const callsById = new Map<string, NormalizedToolCall>()
    for (const toolCall of input.toolCalls) {
      callsById.set(toolCall.toolCallId, toolCall)
      if (toolCall.providerToolCallId) {
        callsById.set(toolCall.providerToolCallId, toolCall)
      }
      const exactKey = stableToolInputKey(toolCall.toolName, toolCall.input)
      const exactCount = (this.exactInputCounts.get(exactKey) ?? 0) + 1
      this.exactInputCounts.set(exactKey, exactCount)
      if (exactCount >= 4) {
        this.forceFinalReason ??= `same exact ${toolCall.toolName} input was requested ${exactCount} times in this turn.`
      }
      const targetKey = normalizedToolTargetKey(toolCall)
      if (targetKey) {
        const targetCount = (this.targetCounts.get(targetKey) ?? 0) + 1
        this.targetCounts.set(targetKey, targetCount)
        if (targetCount >= 4) {
          this.forceFinalReason ??= `same normalized tool target was repeated ${targetCount} times (${targetKey}).`
        }
      }
    }

    const warnings: string[] = []
    for (const result of input.results) {
      const toolCall = callsById.get(result.toolCallId) ?? (result.providerToolCallId ? callsById.get(result.providerToolCallId) : undefined)
      this.pushEntry(`${result.ok ? "ok" : "failed"} ${result.toolName}${toolCall ? ` ${toolCallTargetPreview(toolCall)}` : ""}`)
      const targetKey = toolCall ? normalizedToolTargetKey(toolCall) : undefined
      const targetCount = targetKey ? (this.targetCounts.get(targetKey) ?? 0) : 0
      if (targetKey && targetCount >= 2 && !this.warnedTargets.has(targetKey)) {
        this.warnedTargets.add(targetKey)
        warnings.push(`Runtime action ledger: ${targetKey} has already been inspected or attempted ${targetCount} times this turn. Use the evidence already gathered, inspect a different target, or answer with the remaining uncertainty.`)
      }
      if (!result.ok && toolCall && (toolCall.toolName === "edit" || toolCall.toolName === "apply_patch")) {
        const failedKey = `${toolCall.toolName}:${mutationTargetFor(toolCall)}:${result.error?.code ?? "error"}`
        const failedCount = (this.failedMutationCounts.get(failedKey) ?? 0) + 1
        this.failedMutationCounts.set(failedKey, failedCount)
        if (result.error?.code === "invalid_tool_input" && failedCount < FAILED_MUTATION_FORCE_FINAL_THRESHOLD) {
          warnings.push(MUTATION_SCHEMA_RECOVERY_HINT)
        } else if (failedCount >= FAILED_MUTATION_FORCE_FINAL_THRESHOLD) {
          this.forceFinalReason ??= `${toolCall.toolName} failed ${failedCount} times for ${mutationTargetFor(toolCall)} with ${result.error?.code ?? "an error"}.`
        }
      }
    }

    return {
      summary: this.summary(input),
      warnings,
      ...(this.forceFinalReason ? { forceFinalReason: this.forceFinalReason } : {}),
    }
  }

  private pushEntry(entry: string): void {
    this.entries.push(entry)
    if (this.entries.length > 12) {
      this.entries.splice(0, this.entries.length - 12)
    }
  }

  private summary(input: LedgerRecordBatchInput): string {
    return [
      "Runtime action ledger for this turn:",
      `- Current request estimate: ${input.estimatedTokens} tokens; current-turn growth: ${input.currentTurnTokenGrowth} tokens.`,
      `- Recent actions: ${this.entries.length > 0 ? this.entries.join("; ") : "none"}.`,
      "- Do not repeat the same target unless the previous result was insufficient for a specific reason. Prefer answering from gathered evidence once enough is known.",
    ].join("\n")
  }
}
