import { describe, expect, it, vi } from "vitest"
import { refineTurnMemoryCandidates, retrieveTurnCandidates } from "./turnCandidateRetrieval"

describe("retrieveTurnCandidates", () => {
  it("starts goal, memory, and capability retrieval before any resolves", async () => {
    const started: string[] = []
    let releaseGoal: (value: { results: Array<{ resultNumber: number; goalId: string; title: string; content: string; occurredAt: string }>; totalMatches: number }) => void = () => undefined
    let releaseMemory: (value: { results: []; totalMatches: number }) => void = () => undefined
    let releaseCapabilities: (value: { results: []; totalMatches: number }) => void = () => undefined
    const resultPromise = retrieveTurnCandidates({
      retrieveGoals: () => new Promise((resolve) => {
        started.push("goal")
        releaseGoal = resolve
      }),
      retrieveMemory: () => new Promise((resolve) => {
        started.push("memory")
        releaseMemory = resolve
      }),
      retrieveCapabilities: () => new Promise((resolve) => {
        started.push("capability")
        releaseCapabilities = resolve
      }),
    })
    await Promise.resolve()
    expect(started).toEqual(["goal", "memory", "capability"])
    releaseCapabilities({ results: [], totalMatches: 0 })
    releaseMemory({ results: [], totalMatches: 0 })
    releaseGoal({
      results: [{ resultNumber: 1, goalId: "goal-1", title: "Goal 1", content: "Goal: Goal 1", occurredAt: "2026-01-01T00:00:00.000Z" }],
      totalMatches: 1,
    })
    await expect(resultPromise).resolves.toMatchObject({
      goalCandidates: [{ goalId: "goal-1" }],
      status: { goalCandidates: "completed", memoryCandidates: "completed", capabilityCandidates: "completed", warnings: [] },
    })
  })

  it("returns typed honest receipts when retrieval fails", async () => {
    const result = await retrieveTurnCandidates({
      retrieveGoals: async () => { throw new Error("goal index unavailable") },
      retrieveMemory: async () => { throw new Error("memory index unavailable") },
      retrieveCapabilities: async () => { throw new Error("capability index unavailable") },
    })
    expect(result.goalCandidates).toEqual([])
    expect(result.memoryCandidates).toEqual([])
    expect(result.status.goalCandidates).toBe("failed")
    expect(result.status.memoryCandidates).toBe("failed")
    expect(result.status.capabilityCandidates).toBe("failed")
    expect(result.status.warnings).toHaveLength(3)
  })

  it("still starts memory retrieval when the goal adapter throws synchronously", async () => {
    let memoryStarted = false
    const result = await retrieveTurnCandidates({
      retrieveGoals: () => { throw new Error("synchronous goal adapter failure") },
      retrieveMemory: async () => {
        memoryStarted = true
        return { results: [], totalMatches: 0 }
      },
      retrieveCapabilities: async () => ({ results: [], totalMatches: 0 }),
    })
    expect(memoryStarted).toBe(true)
    expect(result.status).toMatchObject({ goalCandidates: "failed", memoryCandidates: "completed" })
  })

  it("runs one bound-goal refinement after a goal switch and reranks the merged pages", async () => {
    let calls = 0
    const result = await refineTurnMemoryCandidates({
      userMessage: "continue authentication rollout",
      previousGoalId: "goal-dashboard",
      boundGoal: { goalId: "goal-auth", title: "Authentication rollout", state: "foreground", note: "resume token migration" },
      memoryCandidates: [{
        resultNumber: 1,
        content: "dashboard color preference",
        surface: "project_memory",
        fileName: "MEMORY.md",
        sectionId: "project_preferences",
        sectionHeading: "Preferences",
        scope: "project",
      }],
      status: { goalCandidates: "completed", memoryCandidates: "completed", capabilityCandidates: "completed", warnings: [] },
      retrieveMemory: async (query) => {
        calls += 1
        expect(query.query).toContain("Goal: Authentication rollout")
        return {
          results: [{
            resultNumber: 1,
            content: "authentication rollout requires token migration",
            surface: "repo_docs",
            fileName: "REPO_RULES.md",
            sectionId: "workflows",
            sectionHeading: "Workflows",
            scope: "project",
          }],
          totalMatches: 1,
        }
      },
    })
    expect(calls).toBe(1)
    expect(result.refinement).toBe("completed")
    expect(result.memoryCandidates[0]?.content).toContain("token migration")
  })

  it("does not add a second retrieval when the current goal already has eligible memory", async () => {
    const retrieveMemory = vi.fn()
    const result = await refineTurnMemoryCandidates({
      userMessage: "continue the current goal",
      previousGoalId: "goal-current",
      boundGoal: { goalId: "goal-current", title: "Current goal", state: "foreground", note: "active" },
      memoryCandidates: [{
        resultNumber: 1,
        content: "current goal implementation notes",
        surface: "project_notes",
        fileName: "PROJECT_NOTES.md",
        sectionId: "active_context",
        sectionHeading: "Active context",
        scope: "project",
      }],
      status: { goalCandidates: "completed", memoryCandidates: "completed", capabilityCandidates: "completed", warnings: [] },
      retrieveMemory,
    })
    expect(retrieveMemory).not.toHaveBeenCalled()
    expect(result.refinement).toBe("not_needed")
  })

  it("retains first-pass candidates and reports a failed conditional refinement honestly", async () => {
    const initial = [{
      resultNumber: 1,
      content: "existing exact memory",
      surface: "project_memory" as const,
      fileName: "MEMORY.md" as const,
      sectionId: "durable_decisions" as const,
      sectionHeading: "Decisions",
      scope: "project" as const,
    }]
    const result = await refineTurnMemoryCandidates({
      userMessage: "resume the older goal",
      previousGoalId: "goal-current",
      boundGoal: { goalId: "goal-older", title: "Older goal", state: "foreground", note: "resumed" },
      memoryCandidates: initial,
      status: { goalCandidates: "completed", memoryCandidates: "completed", capabilityCandidates: "completed", warnings: [] },
      retrieveMemory: async () => { throw new Error("index unavailable") },
    })
    expect(result.memoryCandidates).toEqual(initial)
    expect(result.refinement).toBe("failed")
    expect(result.status.warnings).toEqual(["Goal-aware memory refinement failed; the initial exact candidates were retained."])
  })
})
