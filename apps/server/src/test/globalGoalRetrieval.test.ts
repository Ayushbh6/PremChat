import { describe, expect, it, vi } from "vitest"
import { SocratesStore } from "../services/store"

describe("global goal candidate retrieval", () => {
  it("merges project indexes deterministically, deduplicates goals, and retains successful projects", async () => {
    const retrieveGoalCandidates = vi.fn(async (projectId: string) => {
      if (projectId === "proj_failed") throw new Error("index rebuilding")
      if (projectId === "proj_one") return {
        results: [
          { resultNumber: 1, goalId: "goal_one", title: "One", content: "one", occurredAt: "2026-07-01T00:00:00.000Z" },
          { resultNumber: 2, goalId: "goal_shared", title: "Shared old", content: "shared old", occurredAt: "2026-07-02T00:00:00.000Z" },
        ],
        totalMatches: 2,
      }
      return {
        results: [
          { resultNumber: 1, goalId: "goal_shared", title: "Shared", content: "shared", occurredAt: "2026-07-04T00:00:00.000Z" },
          { resultNumber: 2, goalId: "goal_two", title: "Two", content: "two", occurredAt: "2026-07-03T00:00:00.000Z" },
          { resultNumber: 3, goalId: "goal_three", title: "Three", content: "three", occurredAt: "2026-06-30T00:00:00.000Z" },
        ],
        totalMatches: 3,
      }
    })
    const store = Object.create(SocratesStore.prototype) as SocratesStore
    Object.defineProperty(store, "retrieval", { value: { retrieveGoalCandidates } })

    const result = await store.retrieveGlobalGoalCandidates(["proj_one", "proj_failed", "proj_two"], "shared work", 3)

    expect(result.results.map((candidate) => candidate.goalId)).toEqual(["goal_shared", "goal_one", "goal_two"])
    expect(result.results.map((candidate) => candidate.resultNumber)).toEqual([1, 2, 3])
    expect(result.totalMatches).toBe(4)
    expect(retrieveGoalCandidates).toHaveBeenCalledTimes(3)
  })
})
