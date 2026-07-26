import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "../../../../")
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8")

describe("Flow convergence Phase 6 architecture absence", () => {
  it("keeps Classic and Flow as thin adapters over one main executor authority", () => {
    const classic = read("apps/server/src/ws/classicToolExecutors.ts")
    const flow = read("apps/server/src/v2/toolExecutors.ts")
    const shared = read("apps/server/src/services/mainToolExecutors.ts")
    expect(classic).toContain("createMainToolExecutors")
    expect(flow).toContain("createMainToolExecutors")
    expect(shared).toContain("retrieveUnifiedMainToolTraces")
    for (const adapter of [classic, flow]) {
      expect(adapter).not.toContain("createDefaultToolRegistry")
      expect(adapter).not.toContain("new AgentRuntime")
      expect(adapter).not.toContain("generateStructured")
      expect(adapter).not.toContain("streamText")
    }
  })

  it("keeps context, trace, and finalization in focused shared services", () => {
    const classicRuntime = read("apps/server/src/ws/commandHandlers/chatMessageSend.ts")
    const flowRuntime = read("apps/server/src/v2/runtime.ts")
    const flowStore = read("apps/server/src/services/v2/flowStore.ts")
    expect(classicRuntime.split("\n").length).toBeLessThanOrEqual(1_000)
    expect(flowRuntime.split("\n").length).toBeLessThanOrEqual(1_000)
    expect(flowRuntime).toContain("buildFlowWorkingMessages")
    expect(flowStore).toContain("persistGoalFinalization")
    expect(read("apps/server/src/services/store.ts")).toContain("retrieveUnifiedMainToolTracesFromAuthority")
  })

  it("requires validated normal finalization and commits answer plus goal atomically", () => {
    const classic = read("apps/server/src/ws/commandHandlers/chatMessageSend.ts")
    const flow = read("apps/server/src/v2/runtime.ts")
    const flowStore = read("apps/server/src/services/v2/flowStore.ts")
    expect(classic).toContain("if (!finalResult)")
    expect(classic).toContain("completeAgentTurnAtomically")
    expect(classic).toContain("afterPersist")
    expect(flow).toContain("if (!finalResult)")
    expect(flow).toContain("this.deps.store.completeTurn")
    const completion = flowStore.slice(flowStore.indexOf("  completeTurn(input:"), flowStore.indexOf("  failTurn(input:"))
    expect(completion).toContain("this.handle.sqlite.transaction")
    expect(completion).toContain("this.finalizeGoal")
  })

  it("does not copy cross-view Q&A while projecting canonical work", () => {
    const canonical = read("apps/server/src/services/workState/canonicalWorkStore.ts")
    const projection = canonical.slice(
      canonical.indexOf("  projectGoalToConversation("),
      canonical.indexOf("  getTaskBySource("),
    )
    expect(projection).not.toContain(".insert(messages)")
    expect(projection).not.toContain(".insert(v2Messages)")
    expect(projection).toContain("conversationTaskProjections")
  })

  it("keeps model-facing routing bounded and free of opaque goal/task ids", () => {
    const prompt = read("packages/core/src/prompts/goalRouterPrompt.ts")
    const coordinator = read("apps/server/src/v2/goalRoutingCoordinator.ts")
    const flowStore = read("apps/server/src/services/v2/flowStore.ts")
    expect(prompt).toContain("Return their numbers, never internal ids")
    expect(prompt).not.toContain("goalId: turn.goalId")
    expect(prompt).not.toContain("taskId")
    expect(coordinator).toContain("listGoalsForRouter")
    expect(coordinator).not.toContain("goals: snapshot.goals")
    expect(flowStore).toContain(".slice(0, 25)")
    expect(flowStore).not.toContain(".slice(0, 100)")
  })

  it("has no Flow trace downgrade or unbounded view-specific history path", () => {
    const flowTools = read("apps/server/src/v2/toolExecutors.ts")
    const flowContext = read("apps/server/src/services/v2/flowWorkingContext.ts")
    expect(flowTools).not.toContain("retrieveV2Trace")
    expect(flowTools).not.toContain('mode: "lexical" as const')
    expect(flowContext).toContain("prepareBoundedGoalHistory")
    expect(flowContext).not.toContain("slice(-")
  })
})
