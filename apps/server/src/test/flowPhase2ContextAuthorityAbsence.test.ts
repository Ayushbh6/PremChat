import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "../../../../")
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8")

describe("Flow convergence Phase 2 authority absence", () => {
  it("removes the Flow-only active-goal prompt authority", () => {
    const runtime = read("apps/server/src/v2/runtime.ts")
    expect(runtime).not.toContain("<socrates_v2_flow_context>")
    expect(runtime).not.toContain("<active_goal id=")
    expect(runtime).not.toContain("<goal_capsule version=")
  })

  it("constructs the same resolved context seed in both production routes", () => {
    const classic = read("apps/server/src/ws/commandHandlers/chatMessageSend.ts")
    const flow = read("apps/server/src/v2/runtime.ts")
    expect(classic).toContain("resolvedTurnContextSeed: createResolvedTurnContextSeed")
    expect(flow).toContain("resolvedTurnContextSeed: createResolvedTurnContextSeed")
    expect(classic).not.toContain("presentation:")
    expect(flow).not.toContain("presentation:")
  })

  it("does not retain the legacy active-goal developer message", () => {
    const lifecycle = read("packages/core/src/agent/SocratesTurnLifecycle.ts")
    const support = read("packages/core/src/agent/socratesMemorySupport.ts")
    expect(lifecycle).not.toContain("renderActiveGoalDeveloperMessage")
    expect(support).not.toContain("socrates_active_goal")
  })
})
