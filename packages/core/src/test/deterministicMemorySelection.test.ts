import { describe, expect, it } from "vitest"
import { rankExactMemoryCandidates, selectExactMemoryCandidates } from "../retrieval/deterministicMemorySelection"
import { buildGoalAwareMemoryQuery } from "../retrieval/memoryRetrievalQuery"

describe("selectExactMemoryCandidates", () => {
  it("filters already-attached/backend-only sections, deduplicates, and preserves exact content", () => {
    const exact = `exact-${"x".repeat(12_000)}`
    const base = { resultNumber: 1, sectionHeading: "Decision", scope: "project" as const }
    const selected = selectExactMemoryCandidates({
      userMessage: "continue retrieval convergence",
      goal: { goalId: "g1", title: "Retrieval convergence", state: "foreground", note: "active" },
      candidates: [
        { ...base, content: "duplicate stable rule", surface: "project_memory", fileName: "MEMORY.md", sectionId: "always_apply_rules" },
        { ...base, resultNumber: 2, content: "backend ledger", surface: "project_notes", fileName: "PROJECT_NOTES.md", sectionId: "state_ledger" },
        { ...base, resultNumber: 3, content: exact, surface: "project_memory", fileName: "MEMORY.md", sectionId: "durable_decisions" },
        { ...base, resultNumber: 4, content: "later duplicate", surface: "project_memory", fileName: "MEMORY.md", sectionId: "durable_decisions" },
      ],
    })
    expect(selected).toEqual([{ surface: "project_memory", reference: "MEMORY.md/durable_decisions", scope: "project", content: exact }])
  })

  it("reranks merged pages against the bound goal while keeping source diversity", () => {
    const base = { sectionHeading: "Context", scope: "project" as const }
    const ranked = rankExactMemoryCandidates({
      userMessage: "continue the authentication rollout",
      goal: { goalId: "g2", title: "Authentication rollout", state: "foreground", note: "active" },
      candidates: [
        { ...base, resultNumber: 1, content: "unrelated dashboard colors", surface: "project_memory", fileName: "MEMORY.md", sectionId: "project_preferences" },
        { ...base, resultNumber: 1, content: "authentication rollout requires token migration", surface: "repo_docs", fileName: "REPO_RULES.md", sectionId: "workflows" },
        { ...base, resultNumber: 2, content: "authentication rollout owner preference", surface: "user_profile", fileName: "user_profile.md", sectionId: "work_and_projects", scope: "global" },
      ],
      limit: 2,
    })
    expect(ranked.map((candidate) => candidate.surface)).toEqual(["repo_docs", "user_profile"])
  })

  it("builds a goal-aware search projection without replacing the exact sources", () => {
    const query = buildGoalAwareMemoryQuery({
      userMessage: `continue implementation ${"detail ".repeat(300)}`,
      goal: {
        goalId: "g1",
        title: "Unified lifecycle",
        objective: "Converge Classic and Flow",
        note: "The exact capsule remains separately attached.",
      },
      phase: "bound",
    })
    expect(query.length).toBeLessThanOrEqual(1_000)
    expect(query).toContain("Goal: Unified lifecycle")
    expect(query).toContain("Objective: Converge Classic and Flow")
  })
})
