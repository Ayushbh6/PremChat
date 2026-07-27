import { describe, expect, it } from "vitest"
import { selectExactMemoryCandidates } from "../retrieval/deterministicMemorySelection"

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
})
