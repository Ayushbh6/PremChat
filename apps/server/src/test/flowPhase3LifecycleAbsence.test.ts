import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "../../../../")
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8")

describe("Flow convergence Phase 3 unified lifecycle authority", () => {
  it("routes both production views through exact goal history and exact selected memory", () => {
    expect(read("apps/server/src/ws/commandHandlers/chatMessageSend.ts")).toContain("prepareExactGoalHistory")
    expect(read("apps/server/src/ws/commandHandlers/chatMessageSend.ts")).toContain("selectExactMemoryCandidates")
    expect(read("apps/server/src/v2/runtime.ts")).toContain("buildFlowWorkingMessages")
    expect(read("apps/server/src/v2/runtime.ts")).toContain("selectExactMemoryCandidates")
    expect(read("apps/server/src/services/v2/flowWorkingContext.ts")).toContain("prepareExactGoalHistory")
    expect(read("apps/server/src/services/store.ts")).toContain("selectExactGoalHistory")
  })

  it("caps goal list pages at 25 and resolution cards at five", () => {
    const flowStore = read("apps/server/src/services/v2/flowStore.ts")
    expect(flowStore).toContain(".slice(0, 25)")
    expect(flowStore).toContain("V2_FLOW_GOAL_PAGE_SIZE")
    expect(read("packages/core/src/v2/goalLifecycle.ts")).toContain("Math.min(5")
    expect(read("apps/server/src/routes/v2FlowRoutes.ts")).toContain("v2ListGoalsResponseSchema")
    expect(read("apps/web/src/lib/v2/useV2FlowRuntime.ts")).toContain("loadEarlierGoals")
  })

  it("uses the same concurrent retrieval and same-Socrates resolution in both views", () => {
    const flow = read("apps/server/src/v2/goalLifecycleCoordinator.ts")
    const classic = read("apps/server/src/ws/classicGoalLifecycleCoordinator.ts")
    for (const coordinator of [flow, classic]) {
      expect(coordinator).toContain("retrieveTurnCandidates")
      expect(coordinator).toContain("resolveSocratesGoal")
      expect(coordinator).toContain("retrieveMemoryCandidates")
    }
    expect(flow).toContain("listGoalsForResolution")
    expect(flow).not.toContain("goals: snapshot.goals")
  })

  it("physically removes replaced router and model-visible search paths", () => {
    for (const file of [
      "packages/core/src/agent/GoalRouterAgent.ts",
      "packages/core/src/agent/MemoryRouterAgent.ts",
      "packages/core/src/prompts/goalRouterPrompt.ts",
      "packages/core/src/prompts/memoryRoutingPrompt.ts",
      "packages/core/src/tools/goalSearchTool.ts",
      "packages/core/src/tools/memorySearchTool.ts",
    ]) {
      expect(fs.existsSync(path.join(root, file))).toBe(false)
    }
    const toolContract = read("packages/contracts/src/tools.ts")
    expect(toolContract).not.toContain('"goal_search"')
    expect(toolContract).not.toContain('"memory_search"')

    const workerContract = read("packages/contracts/src/agentRuntime.ts")
    const settingsPanel = read("apps/web/src/components/settings/WorkerModelSettingsPanel.tsx")
    const agentDefinitions = read("packages/core/src/agent/agentDefinitions.ts")
    for (const retiredRole of ['"goal_router"', '"memory_router"']) {
      expect(workerContract).not.toContain(retiredRole)
      expect(settingsPanel).not.toContain(retiredRole)
      expect(agentDefinitions).not.toContain(retiredRole)
    }
  })
})
