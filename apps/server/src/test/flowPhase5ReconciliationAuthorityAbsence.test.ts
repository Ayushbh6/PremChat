import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "../../../../")
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8")

describe("Flow convergence Phase 5 reconciliation authority", () => {
  it("keeps reconciliation inside the foreground loop as one result-local notice", () => {
    const agent = read("packages/core/src/agent/SocratesAgent.ts")
    expect(agent).toContain("ReconciliationWatermarkController")
    expect(agent).toContain("buildSocratesReconciliationNotice")
    expect(agent).toContain('kind: "socrates_reconciliation"')
    expect(agent).not.toContain("socrates_reconciliation_checkpoint")
    expect(agent).not.toContain("socrates_final_answer_checkpoint")
    expect(agent).not.toContain("ReconciliationRouter")
    expect(agent).not.toContain("ReconciliationWriter")
  })

  it("persists one canonical task watermark from both view adapters", () => {
    const classic = read("apps/server/src/ws/commandHandlers/chatMessageSend.ts")
    const flow = read("apps/server/src/v2/runtime.ts")
    expect(classic).toContain('getTaskReconciliationWatermark("classic"')
    expect(classic).toContain('saveTaskReconciliationWatermark("classic"')
    expect(flow).toContain('getTaskReconciliationWatermark("v2_flow"')
    expect(flow).toContain('saveTaskReconciliationWatermark("v2_flow"')
    expect(read("apps/server/src/services/workState/canonicalWorkStore.ts")).toContain("reconciliationWatermark")
  })

  it("keeps progress evidence bounded and reconciliation conditional", () => {
    const checkpoint = read("packages/core/src/agent/reconciliationWatermark.ts")
    expect(checkpoint).toContain("this.evidence.slice(-4)")
    expect(checkpoint).toContain("mutationWeight >= 2")
    expect(checkpoint).toContain("RECONCILIATION_ACTIVITY_EVIDENCE_LIMIT")
    expect(checkpoint).toContain("skip ceremonial reads or writes")
    expect(checkpoint).not.toContain("generateStructured")
  })
})
