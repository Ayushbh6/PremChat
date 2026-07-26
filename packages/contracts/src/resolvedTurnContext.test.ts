import { describe, expect, it } from "vitest"
import { resolvedTurnContextSchema, resolvedTurnContextSeedSchema } from "./resolvedTurnContext"

const seed = {
  project: { name: "Socrates", description: "One runtime, two views." },
  goal: { title: "Converge Flow", objective: "Use one lifecycle.", state: "foreground", progress: "Phase 2 is active.", openDecisions: [], blockers: [] },
  task: { ordinal: 3, request: "Continue the convergence work." },
  history: [{ role: "user" as const, content: "Continue." }],
}

describe("resolved turn context contracts", () => {
  it("accepts a bounded human-readable seed and resolved memory", () => {
    expect(resolvedTurnContextSeedSchema.parse(seed)).toEqual(seed)
    expect(resolvedTurnContextSchema.parse({
      ...seed,
      memory: [{ surface: "project_docs", reference: "FLOW_NORTH_STAR.md", content: "Classic and Flow share one runtime." }],
    }).memory).toHaveLength(1)
  })

  it("rejects oversized history and opaque extra authority fields", () => {
    expect(resolvedTurnContextSeedSchema.safeParse({ ...seed, history: Array.from({ length: 11 }, () => seed.history[0]) }).success).toBe(false)
    expect(resolvedTurnContextSeedSchema.safeParse({ ...seed, goalId: "v2goal_internal" }).success).toBe(false)
  })
})
