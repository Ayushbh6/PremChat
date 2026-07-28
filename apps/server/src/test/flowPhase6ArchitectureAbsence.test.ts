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
    expect(classicRuntime.split("\n").length).toBeLessThanOrEqual(1_020)
    expect(flowRuntime.split("\n").length).toBeLessThanOrEqual(1_000)
    expect(flowRuntime).toContain("buildFlowWorkingMessages")
    expect(flowStore).toContain("persistGoalFinalization")
    expect(read("apps/server/src/services/store.ts")).toContain("retrieveUnifiedMainToolTracesFromAuthority")
  })

  it("physically removes the superseded Flow context classifier authority", () => {
    for (const file of [
      "packages/core/src/v2/contextPolicy.ts",
      "packages/core/src/v2/contextBudget.ts",
      "packages/core/src/v2/contextAssembly.ts",
    ]) {
      expect(fs.existsSync(path.join(root, file))).toBe(false)
    }
    const flowStore = read("apps/server/src/services/v2/flowStore.ts")
    const v2Contracts = read("packages/contracts/src/v2Flow.ts")
    expect(flowStore).toContain("getExactEvidenceProjections")
    expect(flowStore).not.toContain("persistContextDispositions")
    expect(flowStore).not.toContain("getActiveCoreContextState")
    expect(flowStore).not.toContain("loadCoreContextState")
    expect(flowStore).not.toContain("Review unresolved evidence")
    expect(flowStore).not.toContain("Classify ${item.handle}")
    expect(v2Contracts).not.toContain("v2ContextDispositionSchema")
    expect(v2Contracts).not.toContain("v2.context.disposition.updated")
    expect(v2Contracts).not.toContain("V2_CONTEXT_UNRESOLVED_MAX_ITEMS")
  })

  it("keeps one release-only active-turn mechanism and automatic oldest-head compaction", () => {
    const toolContract = read("packages/contracts/src/tools.ts")
    const disposition = read("packages/core/src/context/toolOutputDisposition.ts")
    const compressorPrompt = read("packages/core/src/prompts/socratesCompressorPrompt.ts")
    const compression = read("packages/core/src/context/contextCompression.ts")
    expect(toolContract).toContain('release: z.array(contextResultHandleSchema)')
    expect(disposition).toContain("Large temporary result")
    expect(disposition).not.toContain('disposition === "distill"')
    expect(disposition).not.toContain('disposition === "unresolved"')
    expect(compressorPrompt).not.toContain("Current Turn Tool Digest")
    expect(compression).toContain("CONTEXT_MODEL_DISPATCH_CEILING_TOKENS = 170_000")
    expect(compression).toContain("recentTailTargetTokens: 70_000")
  })

  it("requires validated normal finalization and commits answer plus goal atomically", () => {
    const classic = read("apps/server/src/ws/commandHandlers/chatMessageSend.ts")
    const flow = read("apps/server/src/v2/runtime.ts")
    const flowStore = read("apps/server/src/services/v2/flowStore.ts")
    const finalization = read("apps/server/src/services/turn/validatedTurnFinalization.ts")
    expect(classic).toContain("if (!finalResult)")
    expect(classic).toContain("commitValidatedTurn")
    expect(classic).toContain("persistBoundGoalAndCapsule")
    expect(flow).toContain("if (!finalResult)")
    expect(flow).toContain("this.deps.store.commitValidatedTurn")
    const completion = flowStore.slice(flowStore.indexOf("  commitValidatedTurn(input:"), flowStore.indexOf("  failTurn(input:"))
    expect(completion).toContain("commitValidatedTurnFinalization")
    expect(completion).toContain("this.finalizeGoal")
    expect(finalization).toContain("handle.sqlite.transaction")
    expect(finalization).toContain("persistAnswerAndTask")
    expect(finalization).toContain("persistBoundGoalAndCapsule")
    expect(finalization).toContain("persistUsageAndAudit")
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

  it("keeps same-Socrates goal resolution bounded and free of opaque goal/task ids", () => {
    const prompt = read("packages/core/src/prompts/socratesGoalResolutionPrompt.ts")
    const coordinator = read("apps/server/src/v2/goalLifecycleCoordinator.ts")
    const flowStore = read("apps/server/src/services/v2/flowStore.ts")
    expect(prompt).toContain("Candidate numbers are human references")
    expect(prompt).not.toContain("goalId: turn.goalId")
    expect(prompt).not.toContain("taskId")
    expect(coordinator).toContain("listGoalsForResolution")
    expect(coordinator).not.toContain("goals: snapshot.goals")
    expect(flowStore).toContain(".slice(0, 25)")
    expect(flowStore).not.toContain(".slice(0, 100)")
  })

  it("has no Flow trace downgrade or unbounded view-specific history path", () => {
    const flowTools = read("apps/server/src/v2/toolExecutors.ts")
    const flowContext = read("apps/server/src/services/v2/flowWorkingContext.ts")
    expect(flowTools).not.toContain("retrieveV2Trace")
    expect(flowTools).not.toContain('mode: "lexical" as const')
    expect(flowContext).toContain("prepareExactGoalHistory")
    expect(flowContext).not.toContain("slice(-")
  })
})
