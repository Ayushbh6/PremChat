import type { NormalizedToolCall, ToolExecutionResult } from "@socrates/contracts"

export const RECONCILIATION_LONG_TASK_MS = 20 * 60 * 1_000
export const RECONCILIATION_ACTIVITY_EVIDENCE_LIMIT = 16

export type ReconciliationCheckpointReason =
  | "substantial_verified_mutation"
  | "milestone_completion"
  | "suspension_resume"
  | "context_compaction"
  | "long_task_activity"
  | "documented_state_contradiction"

export type ReconciliationWatermarkState = Readonly<{
  lastReconciledEvidenceSequence: number
  lastObservedEvidenceSequence: number
  lastCheckpointAt: string
  lastVerifiedMutationBoundary: number
  pendingCheckpointReason?: ReconciliationCheckpointReason
}>

export type ReconciliationCheckpoint = Readonly<{
  reason: ReconciliationCheckpointReason
  evidenceFrom: number
  evidenceTo: number
  lastVerifiedMutationBoundary: number
  evidence: readonly string[]
}>

export class ReconciliationWatermarkController {
  private stateValue: ReconciliationWatermarkState
  private readonly now: () => number
  private readonly evidence: string[] = []
  private checkpoint: ReconciliationCheckpoint | undefined
  private sawDocsReadSinceWatermark = false

  constructor(input: Readonly<{
    state?: ReconciliationWatermarkState
    startedAt?: string
    now?: () => number
  }> = {}) {
    this.now = input.now ?? Date.now
    const initialTime = input.startedAt ?? new Date(this.now()).toISOString()
    this.stateValue = input.state ?? {
      lastReconciledEvidenceSequence: 0,
      lastObservedEvidenceSequence: 0,
      lastCheckpointAt: initialTime,
      lastVerifiedMutationBoundary: 0,
    }
  }

  state(): ReconciliationWatermarkState {
    return { ...this.stateValue }
  }

  activeCheckpoint(): ReconciliationCheckpoint | undefined {
    return this.checkpoint
  }

  recordBatch(toolCalls: readonly NormalizedToolCall[], results: readonly ToolExecutionResult[]): void {
    const resultsById = new Map<string, ToolExecutionResult>()
    for (const result of results) {
      resultsById.set(result.toolCallId, result)
      if (result.providerToolCallId) resultsById.set(result.providerToolCallId, result)
    }
    let mutationWeight = 0
    let milestoneCompleted = false
    let nonDocsEvidence = false
    for (const call of toolCalls) {
      const result = resultsById.get(call.toolCallId) ?? (call.providerToolCallId ? resultsById.get(call.providerToolCallId) : undefined)
      if (!result?.ok) continue
      const sequence = this.stateValue.lastObservedEvidenceSequence + 1
      this.stateValue = { ...this.stateValue, lastObservedEvidenceSequence: sequence }
      const operation = toolOperation(call)
      const docsRead = (call.toolName === "project_docs" || call.toolName === "repo_docs") && isReadOperation(operation)
      this.sawDocsReadSinceWatermark ||= docsRead
      nonDocsEvidence ||= !docsRead && call.toolName !== "context_disposition"
      const mutation = mutationWeightFor(call, result)
      if (mutation > 0) {
        mutationWeight += mutation
        this.stateValue = { ...this.stateValue, lastVerifiedMutationBoundary: sequence }
      }
      milestoneCompleted ||= verifiedMilestone(call, result)
      this.pushEvidence(`${sequence}. ${humanEvidenceLabel(call, mutation > 0)}`)
      if (isWaitingResult(call, result)) this.markSuspension()
    }
    if (this.checkpoint) return
    if (mutationWeight >= 2) {
      this.setPending("substantial_verified_mutation")
    } else if (this.sawDocsReadSinceWatermark && nonDocsEvidence && this.unreconciledCount() >= 6) {
      this.setPending("documented_state_contradiction")
    } else if (milestoneCompleted && (this.unreconciledCount() >= 6 || this.elapsedSinceCheckpoint() >= 5 * 60 * 1_000)) {
      this.setPending("milestone_completion")
    } else if (this.unreconciledCount() >= RECONCILIATION_ACTIVITY_EVIDENCE_LIMIT || this.elapsedSinceCheckpoint() >= RECONCILIATION_LONG_TASK_MS) {
      this.setPending("long_task_activity")
    }
  }

  markCompactionBoundary(): void {
    if (!this.checkpoint && this.unreconciledCount() > 0) this.setPending("context_compaction")
  }

  markSuspension(): void {
    if (!this.checkpoint && this.unreconciledCount() > 0) this.setPending("suspension_resume")
  }

  beginPendingCheckpoint(): ReconciliationCheckpoint | undefined {
    if (this.checkpoint || !this.stateValue.pendingCheckpointReason || this.unreconciledCount() === 0) return undefined
    this.checkpoint = {
      reason: this.stateValue.pendingCheckpointReason,
      evidenceFrom: this.stateValue.lastReconciledEvidenceSequence + 1,
      evidenceTo: this.stateValue.lastObservedEvidenceSequence,
      lastVerifiedMutationBoundary: this.stateValue.lastVerifiedMutationBoundary,
      evidence: this.evidence.slice(-8),
    }
    return this.checkpoint
  }

  completeCheckpoint(): void {
    if (!this.checkpoint) return
    this.completeCurrentBoundary()
  }

  completeFinalCheckpoint(): void {
    this.completeCurrentBoundary()
  }

  private completeCurrentBoundary(): void {
    this.stateValue = {
      lastReconciledEvidenceSequence: this.stateValue.lastObservedEvidenceSequence,
      lastObservedEvidenceSequence: this.stateValue.lastObservedEvidenceSequence,
      lastCheckpointAt: new Date(this.now()).toISOString(),
      lastVerifiedMutationBoundary: this.stateValue.lastVerifiedMutationBoundary,
    }
    this.checkpoint = undefined
    this.evidence.length = 0
    this.sawDocsReadSinceWatermark = false
  }

  private unreconciledCount(): number {
    return this.stateValue.lastObservedEvidenceSequence - this.stateValue.lastReconciledEvidenceSequence
  }

  private elapsedSinceCheckpoint(): number {
    const checkpointTime = Date.parse(this.stateValue.lastCheckpointAt)
    return Number.isFinite(checkpointTime) ? Math.max(0, this.now() - checkpointTime) : 0
  }

  private setPending(reason: ReconciliationCheckpointReason): void {
    this.stateValue = { ...this.stateValue, pendingCheckpointReason: this.stateValue.pendingCheckpointReason ?? reason }
  }

  private pushEvidence(summary: string): void {
    this.evidence.push(summary.slice(0, 240))
    if (this.evidence.length > 12) this.evidence.splice(0, this.evidence.length - 12)
  }
}

export const buildSocratesProgressReconciliationCheckpoint = (checkpoint: ReconciliationCheckpoint): string => [
  "<socrates_progress_reconciliation_checkpoint>",
  "This is a meaningful progress checkpoint inside the current task. Do not answer the user in this response.",
  `Trigger: ${checkpoint.reason}. Review only verified task evidence ${checkpoint.evidenceFrom}-${checkpoint.evidenceTo}; the previous watermark is already reconciled.`,
  `Last verified mutation boundary: ${checkpoint.lastVerifiedMutationBoundary}.`,
  "Decide whether durable state changed: a material goal or scope change, a future-dependent decision, a verified build or test milestone, a blocker or incomplete handoff, or the restart state. Tool volume and lines changed are signals only; they never prove a docs write is needed.",
  "If reconciliation is needed, read the exact project_docs or repo_docs section, make the smallest canonical replacement, and re-read it to verify the stale claim is gone. Never append a parallel authority path.",
  "If nothing durable changed, make no docs mutation. A genuine semantic instruction not to remember, save, or store the covered content remains authoritative.",
  "Use only normal main Socrates tools. There is no router, summarizer, or writer for this checkpoint. When finished, return no user-facing answer; continue the same task.",
  ...(checkpoint.evidence.length ? ["Checkpoint evidence index:", ...checkpoint.evidence] : []),
  "</socrates_progress_reconciliation_checkpoint>",
].join("\n")

const toolOperation = (call: NormalizedToolCall): string | undefined => {
  if (!call.input || typeof call.input !== "object" || Array.isArray(call.input)) return undefined
  const operation = (call.input as Record<string, unknown>).operation
  return typeof operation === "string" ? operation : undefined
}

const isReadOperation = (operation: string | undefined): boolean =>
  operation === "read" || operation === "search" || operation === "read_index" || operation === "read_section"

const mutationWeightFor = (call: NormalizedToolCall, result: ToolExecutionResult): number => {
  if (call.toolName === "project_docs" || call.toolName === "repo_docs") {
    return toolOperation(call) === "edit" || toolOperation(call) === "patch_section" ? 1 : 0
  }
  if (call.toolName !== "edit" && call.toolName !== "apply_patch") return 0
  const output = result.output && typeof result.output === "object" && !Array.isArray(result.output)
    ? result.output as Record<string, unknown>
    : {}
  if (output.dryRun === true || output.changed === false) return 0
  const changedFiles = Array.isArray(output.changedFiles) ? output.changedFiles.length : 0
  return Math.max(1, changedFiles)
}

const verifiedMilestone = (call: NormalizedToolCall, result: ToolExecutionResult): boolean => {
  if (call.toolName !== "bash") return false
  const input = call.input && typeof call.input === "object" && !Array.isArray(call.input) ? call.input as Record<string, unknown> : {}
  const command = typeof input.command === "string" ? input.command : typeof input.cmd === "string" ? input.cmd : ""
  const output = result.output && typeof result.output === "object" && !Array.isArray(result.output) ? result.output as Record<string, unknown> : {}
  const exitCode = typeof output.exitCode === "number" ? output.exitCode : typeof output.exit_code === "number" ? output.exit_code : undefined
  return exitCode === 0 && /(?:^|\s)(?:test|typecheck|build|lint|check)(?:\s|$)|vitest|playwright/i.test(command)
}

const isWaitingResult = (call: NormalizedToolCall, result: ToolExecutionResult): boolean => {
  if (call.toolName !== "wait" || !result.output || typeof result.output !== "object" || Array.isArray(result.output)) return false
  return (result.output as Record<string, unknown>).status === "waiting"
}

const humanEvidenceLabel = (call: NormalizedToolCall, mutation: boolean): string => {
  const input = call.input && typeof call.input === "object" && !Array.isArray(call.input) ? call.input as Record<string, unknown> : {}
  const target = [input.path, input.area, input.sectionId, input.operation].find((value) => typeof value === "string")
  return `${mutation ? "verified mutation" : "verified evidence"}: ${call.toolName}${typeof target === "string" ? ` ${target}` : ""}`
}
