import { describe, expect, it } from "vitest"
import { createResolvedTurnContextSeed, prepareTurnContext, renderResolvedTurnContext } from "../agent/prepareTurnContext"
import type { MemoryLoopToolRecord } from "../agent/socratesMemorySupport"

describe("prepareTurnContext", () => {
  it("resolves one immutable human-readable context after memory retrieval", () => {
    const seed = createResolvedTurnContextSeed({
      projectName: "Socrates",
      projectDescription: "A local-first coding agent.",
      goal: {
        goalId: "v2goal_private",
        title: "Converge Flow",
        objective: "Use one lifecycle in both views.",
        state: "foreground",
        note: "The goal is routed and bound.",
        taskOrdinal: 4,
        taskRequest: "Implement the shared context.",
        transition: {
          previousGoalTitle: "Freeze the design",
          relationship: "Implementation follows the approved design.",
          verifiedOutcome: "The lifecycle contract was committed.",
        },
      },
      messages: [
        { role: "user", content: "Freeze the design." },
        { role: "assistant", content: "The lifecycle contract is committed." },
        { role: "user", content: "Implement the shared context." },
      ],
    })
    const record: MemoryLoopToolRecord = {
      toolName: "project_docs",
      input: { operation: "read", path: "FLOW_NORTH_STAR.md" },
      events: [],
      result: {
        ok: true,
        toolCallId: "test_call",
        toolName: "project_docs",
        output: { section: { content: "Classic and Flow are views of one runtime." } },
      },
    }

    const resolved = prepareTurnContext(seed, [record])
    const rendered = renderResolvedTurnContext(resolved)

    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved.goal)).toBe(true)
    expect(resolved.memory).toHaveLength(1)
    expect(rendered).toContain("CURRENT TASK - 4")
    expect(rendered).toContain("Classic and Flow are views of one runtime.")
    expect(rendered).not.toContain("v2goal_private")
    expect(rendered).not.toContain("goalId")
  })

  it("caps visible history at ten items and derives safe legacy defaults", () => {
    const seed = createResolvedTurnContextSeed({
      goal: { goalId: "private", title: "Legacy task", state: "active", note: "In progress." },
      messages: Array.from({ length: 14 }, (_, index) => ({ role: index % 2 ? "assistant" as const : "user" as const, content: `message-${index}` })),
    })
    expect(seed.history).toHaveLength(10)
    expect(seed.history[0]?.content).toBe("message-4")
    expect(seed.task.ordinal).toBe(1)
    expect(seed.task.request).toBe("message-12")
  })
})
