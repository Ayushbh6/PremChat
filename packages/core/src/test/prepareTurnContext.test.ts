import { describe, expect, it } from "vitest"
import { createResolvedTurnContextSeed, prepareTurnContext, renderResolvedTurnContext } from "../agent/prepareTurnContext"

describe("prepareTurnContext", () => {
  it("preserves the task, latest exact exchange, and selected memory byte for byte", () => {
    const exactUser = `user-${"u".repeat(20_000)}`
    const exactAssistant = `assistant-${"a".repeat(20_000)}`
    const exactTask = `  task-${"t".repeat(24_000)}\n`
    const exactMemory = `memory-${"m".repeat(18_000)}`
    const seed = createResolvedTurnContextSeed({
      goal: {
        goalId: "private",
        title: "Converge Flow",
        objective: "Use one lifecycle in every presentation.",
        state: "foreground",
        note: "Candidate retrieval and binding succeeded.",
        taskOrdinal: 4,
        taskRequest: exactTask,
      },
      messages: [
        { role: "user", content: exactUser },
        { role: "assistant", content: exactAssistant },
        { role: "user", content: exactTask },
      ],
      retrieval: { goalCandidates: "completed", memoryCandidates: "completed", warnings: [] },
    })
    const resolved = prepareTurnContext(seed, [{
      surface: "project_memory",
      reference: "MEMORY.md/durable_decisions",
      scope: "project",
      content: exactMemory,
    }])
    const rendered = renderResolvedTurnContext(resolved)

    expect(Object.isFrozen(resolved)).toBe(true)
    expect(resolved.task.request).toBe(exactTask)
    expect(resolved.latestExchange).toEqual({ user: exactUser, assistant: exactAssistant })
    expect(resolved.memory[0]?.content).toBe(exactMemory)
    expect(rendered).toContain(exactUser)
    expect(rendered).toContain(exactAssistant)
    expect(rendered).toContain(exactTask)
    expect(rendered).toContain(exactMemory)
    expect(rendered).not.toContain("CURRENT VIEW")
    expect(rendered).not.toContain("v2goal")
  })

  it("reports retrieval failure honestly without inventing memory", () => {
    const seed = createResolvedTurnContextSeed({
      goal: { goalId: "private", title: "Shared work", state: "foreground", note: "In progress." },
      messages: [{ role: "user", content: "Continue." }],
      retrieval: {
        goalCandidates: "failed",
        memoryCandidates: "failed",
        warnings: ["Older goal retrieval failed; the current goal was retained independently.", "Memory retrieval failed; no retrieved memory was attached."],
      },
    })
    const rendered = renderResolvedTurnContext(prepareTurnContext(seed))
    expect(rendered).toContain("Older goal retrieval failed")
    expect(rendered).toContain("Memory retrieval failed")
    expect(rendered).not.toContain("CURRENT VIEW")
  })
})
