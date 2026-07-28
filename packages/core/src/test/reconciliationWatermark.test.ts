import type { NormalizedToolCall, ToolExecutionResult } from "@socrates/contracts"
import { describe, expect, it } from "vitest"
import {
  ReconciliationWatermarkController,
  buildSocratesReconciliationNotice,
} from "../agent/reconciliationWatermark"

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
  it("does not steer a short ordinary read-only task", () => {
    const controller = new ReconciliationWatermarkController()
    controller.recordBatch(
      [call("read_1", "read", { path: "README.md" })],
      [ok("read_1", "read", { content: "current" })],
    )
    expect(controller.takePendingReminder()).toBeUndefined()
  })

  it("delivers one compact result-local reminder for substantial work", () => {
    const controller = new ReconciliationWatermarkController()
    controller.recordBatch(
      [call("patch_1", "apply_patch", { path: "." })],
      [ok("patch_1", "apply_patch", { changedFiles: [{ path: "a.ts" }, { path: "b.ts" }] })],
    )
    const reminder = controller.takePendingReminder()
    expect(reminder).toMatchObject({ reason: "substantial_verified_mutation", evidenceFrom: 1, evidenceTo: 1 })
    expect(buildSocratesReconciliationNotice(reminder!)).toContain("inside this same loop")
    expect(controller.takePendingReminder()).toBeUndefined()
  })

  it("does not redeliver the reminder after wait/resume", () => {
    const first = new ReconciliationWatermarkController()
    first.recordBatch(
      [call("wait_1", "wait", { terminalNames: ["tests"] })],
      [ok("wait_1", "wait", { status: "waiting", terminalNames: ["tests"] })],
    )
    expect(first.takePendingReminder()?.reason).toBe("suspension_resume")
    const resumed = new ReconciliationWatermarkController({ state: first.state() })
    expect(resumed.takePendingReminder()).toBeUndefined()
  })

  it("clears the delivered boundary only when the foreground loop finalizes", () => {
    const controller = new ReconciliationWatermarkController()
    controller.recordBatch(
      [call("patch_1", "apply_patch", { path: "." })],
      [ok("patch_1", "apply_patch", { changedFiles: [{ path: "a" }, { path: "b" }] })],
    )
    controller.takePendingReminder()
    controller.completeFinalCheckpoint()
    expect(controller.state()).toMatchObject({
      lastReconciledEvidenceSequence: 1,
      lastObservedEvidenceSequence: 1,
    })
    expect(controller.state()).not.toHaveProperty("reminderDeliveredAtEvidenceSequence")
  })
})
