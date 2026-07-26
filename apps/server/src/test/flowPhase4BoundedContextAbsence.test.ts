import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "../../../../")
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8")

describe("Flow convergence Phase 4 bounded-context authority", () => {
  it("routes both production views through the shared bounded goal-history selector", () => {
    expect(read("apps/server/src/ws/commandHandlers/chatMessageSend.ts")).toContain("prepareBoundedGoalHistory")
    expect(read("apps/server/src/v2/runtime.ts")).toContain("buildFlowWorkingMessages")
    expect(read("apps/server/src/services/v2/flowWorkingContext.ts")).toContain("prepareBoundedGoalHistory")
    expect(read("apps/server/src/services/store.ts")).toContain("selectBoundedGoalHistory")
  })

  it("caps model-facing routing candidates and UI goal pages at 25", () => {
    const flowStore = read("apps/server/src/services/v2/flowStore.ts")
    expect(flowStore).toContain(".slice(0, 25)")
    expect(flowStore).toContain("V2_FLOW_GOAL_PAGE_SIZE")
    expect(read("apps/server/src/routes/v2FlowRoutes.ts")).toContain("v2ListGoalsResponseSchema")
    expect(read("apps/web/src/lib/v2/useV2FlowRuntime.ts")).toContain("loadEarlierGoals")
  })

  it("does not inject a full unbounded goal ledger into the Flow Goal Router", () => {
    const coordinator = read("apps/server/src/v2/goalRoutingCoordinator.ts")
    expect(coordinator).toContain("listGoalsForRouter")
    expect(coordinator).not.toContain("goals: snapshot.goals")
    expect(coordinator).not.toContain("capsules: snapshot.latestCapsules")
  })
})
