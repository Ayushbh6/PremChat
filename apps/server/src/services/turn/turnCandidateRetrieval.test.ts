import { describe, expect, it } from "vitest"
import { retrieveTurnCandidates } from "./turnCandidateRetrieval"

describe("retrieveTurnCandidates", () => {
  it("starts goal and memory retrieval before either one resolves", async () => {
    const started: string[] = []
    let releaseGoal: (value: { results: Array<{ resultNumber: number; goalId: string; title: string; content: string; occurredAt: string }>; totalMatches: number }) => void = () => undefined
    let releaseMemory: (value: { results: []; totalMatches: number }) => void = () => undefined
    const resultPromise = retrieveTurnCandidates({
      retrieveGoals: () => new Promise((resolve) => {
        started.push("goal")
        releaseGoal = resolve
      }),
      retrieveMemory: () => new Promise((resolve) => {
        started.push("memory")
        releaseMemory = resolve
      }),
    })
    await Promise.resolve()
    expect(started).toEqual(["goal", "memory"])
    releaseMemory({ results: [], totalMatches: 0 })
    releaseGoal({
      results: [{ resultNumber: 1, goalId: "goal-1", title: "Goal 1", content: "Goal: Goal 1", occurredAt: "2026-01-01T00:00:00.000Z" }],
      totalMatches: 1,
    })
    await expect(resultPromise).resolves.toMatchObject({
      goalCandidates: [{ goalId: "goal-1" }],
      status: { goalCandidates: "completed", memoryCandidates: "completed", warnings: [] },
    })
  })

  it("returns typed honest receipts when retrieval fails", async () => {
    const result = await retrieveTurnCandidates({
      retrieveGoals: async () => { throw new Error("goal index unavailable") },
      retrieveMemory: async () => { throw new Error("memory index unavailable") },
    })
    expect(result.goalCandidates).toEqual([])
    expect(result.memoryCandidates).toEqual([])
    expect(result.status.goalCandidates).toBe("failed")
    expect(result.status.memoryCandidates).toBe("failed")
    expect(result.status.warnings).toHaveLength(2)
  })

  it("still starts memory retrieval when the goal adapter throws synchronously", async () => {
    let memoryStarted = false
    const result = await retrieveTurnCandidates({
      retrieveGoals: () => { throw new Error("synchronous goal adapter failure") },
      retrieveMemory: async () => {
        memoryStarted = true
        return { results: [], totalMatches: 0 }
      },
    })
    expect(memoryStarted).toBe(true)
    expect(result.status).toMatchObject({ goalCandidates: "failed", memoryCandidates: "completed" })
  })
})
