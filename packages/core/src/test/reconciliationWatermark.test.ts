import type { NormalizedToolCall, ToolExecutionResult } from "@socrates/contracts"
import { describe, expect, it } from "vitest"
import {
  ReconciliationWatermarkController,
  buildSocratesProgressReconciliationCheckpoint,
} from "../agent/reconciliationWatermark"
import { ReconciliationVerificationLedger } from "../agent/socratesTurnLedgers"

const call = (toolCallId: string, toolName: NormalizedToolCall["toolName"], input: Record<string, unknown>): NormalizedToolCall => ({
  toolCallId,
  toolName,
  input,
})
const ok = (toolCallId: string, toolName: ToolExecutionResult["toolName"], output: unknown): ToolExecutionResult => ({
  toolCallId,
  toolName,
  ok: true,
  output,
})

describe("reconciliation watermark", () => {
  it("leaves a short ordinary read-only task for the mandatory final checkpoint", () => {
    const now = Date.parse("2026-07-26T10:01:00.000Z")
    const controller = new ReconciliationWatermarkController({ startedAt: "2026-07-26T10:00:00.000Z", now: () => now })
    controller.recordBatch(
      [call("read_1", "read", { path: "README.md" })],
      [ok("read_1", "read", { content: "current" })],
    )
    expect(controller.beginPendingCheckpoint()).toBeUndefined()
    expect(controller.state()).toMatchObject({
      lastReconciledEvidenceSequence: 0,
      lastObservedEvidenceSequence: 1,
      lastVerifiedMutationBoundary: 0,
    })
  })

  it("checkpoints a substantial verified mutation batch exactly once", () => {
    const controller = new ReconciliationWatermarkController({ startedAt: "2026-07-26T10:00:00.000Z" })
    controller.recordBatch(
      [call("patch_1", "apply_patch", { path: "." })],
      [ok("patch_1", "apply_patch", { changedFiles: [{ path: "a.ts" }, { path: "b.ts" }] })],
    )
    expect(controller.beginPendingCheckpoint()).toMatchObject({
      reason: "substantial_verified_mutation",
      evidenceFrom: 1,
      evidenceTo: 1,
      lastVerifiedMutationBoundary: 1,
    })
    controller.completeCheckpoint()
    expect(controller.beginPendingCheckpoint()).toBeUndefined()
    expect(controller.state()).toMatchObject({
      lastReconciledEvidenceSequence: 1,
      lastObservedEvidenceSequence: 1,
    })
  })

  it("retains an unreconciled compaction boundary until the same task handles it", () => {
    const controller = new ReconciliationWatermarkController()
    controller.recordBatch(
      [call("read_1", "read", { path: "src/index.ts" })],
      [ok("read_1", "read", { content: "evidence" })],
    )
    controller.markCompactionBoundary()
    const checkpoint = controller.beginPendingCheckpoint()
    expect(checkpoint?.reason).toBe("context_compaction")
    expect(buildSocratesProgressReconciliationCheckpoint(checkpoint!)).toContain("Review only verified task evidence 1-1")
  })

  it("preserves a suspension trigger across a simulated four-hour resume", () => {
    let now = Date.parse("2026-07-26T10:00:00.000Z")
    const first = new ReconciliationWatermarkController({ now: () => now })
    first.recordBatch(
      [call("wait_1", "wait", { terminalNames: ["tests"] })],
      [ok("wait_1", "wait", { status: "waiting", terminalNames: ["tests"] })],
    )
    const persisted = first.state()
    now += 4 * 60 * 60 * 1_000
    const resumed = new ReconciliationWatermarkController({ state: persisted, now: () => now })
    expect(resumed.beginPendingCheckpoint()).toMatchObject({
      reason: "suspension_resume",
      evidenceFrom: 1,
      evidenceTo: 1,
    })
  })

  it("keeps semantic memory opt-outs authoritative in the progress prompt", () => {
    const controller = new ReconciliationWatermarkController()
    controller.recordBatch(
      [call("patch_1", "apply_patch", { path: "." })],
      [ok("patch_1", "apply_patch", { changedFiles: [{ path: "a" }, { path: "b" }] })],
    )
    const prompt = buildSocratesProgressReconciliationCheckpoint(controller.beginPendingCheckpoint()!)
    expect(prompt).toContain("genuine semantic instruction not to remember, save, or store")
    expect(prompt).toContain("There is no router, summarizer, or writer")
  })

  it("tracks governed document edits and exact post-write reads through the shared tools", () => {
    const ledger = new ReconciliationVerificationLedger()
    ledger.recordBatch(
      [call("edit_1", "edit", { path: "socrates://project/notes/active_context", edits: [{ oldString: "old", newString: "new" }] })],
      [ok("edit_1", "edit", { changedFiles: [{ path: "socrates://project/notes/active_context" }] })],
    )
    ledger.beginCheckpoint()
    expect(ledger.pendingSummary()).toContain("notes/active_context (needs post-write read)")

    ledger.recordBatch(
      [call("read_1", "read", { path: "socrates://project/notes/active_context" })],
      [ok("read_1", "read", { content: "new" })],
    )
    expect(ledger.hasPending()).toBe(false)
  })
})
