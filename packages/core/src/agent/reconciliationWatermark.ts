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
  reminderDeliveredAtEvidenceSequence?: number
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
      const docsRead = call.toolName === "read" && isGovernedDocumentPath(toolPath(call))
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
      evidence: this.evidence.slice(-4),
    }
    return this.checkpoint
  }

  takePendingReminder(): ReconciliationCheckpoint | undefined {
    if (
      this.stateValue.reminderDeliveredAtEvidenceSequence !== undefined
      && this.stateValue.reminderDeliveredAtEvidenceSequence > this.stateValue.lastReconciledEvidenceSequence
    ) {
      return undefined
    }
    const checkpoint = this.beginPendingCheckpoint()
    if (!checkpoint) return undefined
    const { pendingCheckpointReason: _pendingCheckpointReason, ...state } = this.stateValue
    this.stateValue = {
      ...state,
      reminderDeliveredAtEvidenceSequence: checkpoint.evidenceTo,
    }
    this.checkpoint = undefined
    return checkpoint
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
    if (this.evidence.length > 8) this.evidence.splice(0, this.evidence.length - 8)
  }
}

export const buildSocratesReconciliationNotice = (checkpoint: ReconciliationCheckpoint): string =>
  `Substantial work reached a durable-state boundary (${checkpoint.reason}, evidence ${checkpoint.evidenceFrom}-${checkpoint.evidenceTo}). Before the final answer, reconcile inside this same loop only important goal/scope changes, future-dependent decisions, verified milestones, blockers, handoff/restart state, or proven stale doctrine in the appropriate .socrates resource; skip ceremonial reads or writes.`

const toolPath = (call: NormalizedToolCall): string | undefined => {
  if (!call.input || typeof call.input !== "object" || Array.isArray(call.input)) return undefined
  const path = (call.input as Record<string, unknown>).path
  return typeof path === "string" ? path : undefined
}

const isGovernedDocumentPath = (path: string | undefined): boolean =>
  typeof path === "string" && (
    path === "socrates://project/memory" ||
    path.startsWith("socrates://project/memory/") ||
    path === "socrates://project/notes" ||
    path.startsWith("socrates://project/notes/") ||
    path === "socrates://project/repo-docs" ||
    path.startsWith("socrates://project/repo-docs/")
  )

const mutationWeightFor = (call: NormalizedToolCall, result: ToolExecutionResult): number => {
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
