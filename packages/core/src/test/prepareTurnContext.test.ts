import { describe, expect, it } from "vitest"
import { createResolvedTurnContextSeed, prepareTurnContext, renderResolvedTurnContext } from "../agent/prepareTurnContext"
import type { MemoryLoopToolRecord } from "../agent/socratesMemorySupport"

describe("prepareTurnContext", () => {
  it("resolves one immutable human-readable context after memory retrieval", () => {
    const seed = createResolvedTurnContextSeed({
      presentation: { kind: "classic", aperture: "selected_conversation" },
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
    expect(rendered).toContain("CURRENT VIEW\nClassic")
    expect(rendered).toContain("selected a conversation")
    expect(rendered).toContain("current_goal for older work")
    expect(rendered).toContain("CURRENT TASK - 4")
    expect(rendered).toContain("Classic and Flow are views of one runtime.")
    expect(rendered).not.toContain("v2goal_private")
    expect(rendered).not.toContain("goalId")
  })

  it("caps visible history at ten items and derives safe legacy defaults", () => {
    const seed = createResolvedTurnContextSeed({
      presentation: { kind: "flow", aperture: "selected_goal" },
      goal: { goalId: "private", title: "Legacy task", state: "active", note: "In progress." },
      messages: Array.from({ length: 14 }, (_, index) => ({ role: index % 2 ? "assistant" as const : "user" as const, content: `message-${index}` })),
    })
    expect(seed.history).toHaveLength(10)
    expect(seed.history[0]?.content).toBe("message-4")
    expect(seed.task.ordinal).toBe(1)
    expect(seed.task.request).toBe("message-12")
    expect(renderResolvedTurnContext(prepareTurnContext(seed))).toContain("CURRENT VIEW\nFlow")
    expect(renderResolvedTurnContext(prepareTurnContext(seed))).toContain("absence here does not prove")
  })

  it("keeps Classic and Flow specialization bounded to the presentation block", () => {
    const common = {
      projectName: "Socrates",
      goal: { goalId: "private", title: "Shared work", state: "active" as const, note: "In progress." },
      messages: [{ role: "user" as const, content: "Continue the shared task." }],
    }
    const classic = renderResolvedTurnContext(prepareTurnContext(createResolvedTurnContextSeed({
      ...common,
      presentation: { kind: "classic", aperture: "selected_conversation" },
    })))
    const flow = renderResolvedTurnContext(prepareTurnContext(createResolvedTurnContextSeed({
      ...common,
      presentation: { kind: "flow", aperture: "selected_goal" },
    })))

    const sharedStart = "PROJECT\nSocrates"
    expect(classic.slice(classic.indexOf(sharedStart))).toBe(flow.slice(flow.indexOf(sharedStart)))
    expect(classic.indexOf(sharedStart)).toBeLessThan(1_200)
    expect(flow.indexOf(sharedStart)).toBeLessThan(1_200)
  })
})
