import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "../../../../")
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8")

describe("Flow convergence Phase 5 reconciliation authority", () => {
  it("injects progress and final reconciliation into the same Socrates agent loop", () => {
    const agent = read("packages/core/src/agent/SocratesAgent.ts")
    expect(agent).toContain("ReconciliationWatermarkController")
    expect(agent).toContain("buildSocratesProgressReconciliationCheckpoint")
    expect(agent).toContain("buildSocratesReconciliationCheckpoint")
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

  it("keeps progress evidence bounded and semantic opt-outs explicit", () => {
    const checkpoint = read("packages/core/src/agent/reconciliationWatermark.ts")
    expect(checkpoint).toContain("this.evidence.slice(-8)")
    expect(checkpoint).toContain("Tool volume and lines changed are signals only")
    expect(checkpoint).toContain("genuine semantic instruction not to remember")
    expect(checkpoint).not.toContain("generateStructured")
  })
})
