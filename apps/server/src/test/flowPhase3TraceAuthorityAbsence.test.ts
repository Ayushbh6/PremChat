import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "../../../../")
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8")

describe("Flow convergence Phase 3 trace authority absence", () => {
  it("uses one shared main trace executor from both view adapters", () => {
    const classic = read("apps/server/src/ws/classicToolExecutors.ts")
    const flow = read("apps/server/src/v2/toolExecutors.ts")
    const shared = read("apps/server/src/services/mainToolExecutors.ts")
    expect(classic).toContain("createMainToolExecutors")
    expect(flow).toContain("createMainToolExecutors")
    expect(shared).toContain("retrieveUnifiedMainToolTraces")
  })

  it("removes the Flow-only trace adapter and lexical downgrade", () => {
    const flow = read("apps/server/src/v2/toolExecutors.ts")
    expect(flow).not.toContain("retrieveV2Trace")
    expect(read("apps/server/src/services/retrieval/retrievalStore.ts")).not.toContain("retrieveV2FlowTrace")
    expect(flow).not.toContain('mode: "lexical" as const')
    expect(flow).not.toContain("lastTraceTurnIds")
  })

  it("keeps model-facing main trace inputs semantic and id-free", () => {
    const tools = read("packages/contracts/src/tools.ts")
    const mainBlock = tools.slice(tools.indexOf("traceRetrieveMainScopeSchema"), tools.indexOf("traceRetrieveGlobalScopeSchema"))
    const inspectBlock = tools.slice(tools.indexOf("traceRetrieveMainInspectInputSchema"), tools.indexOf("traceRetrieveMainToolInputSchema"))
    expect(mainBlock).toContain('["presented_context", "current_goal", "project"]')
    expect(mainBlock).not.toContain("current_conversation")
    expect(inspectBlock).not.toContain("turnId")
    expect(read("apps/server/src/services/retrieval/unifiedMainTraceService.ts")).toContain("turnId: _turnId")
  })
})
