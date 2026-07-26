import { describe, expect, it } from "vitest"
import { BOUNDED_GOAL_HISTORY_MAX_RECENT_MESSAGES, selectBoundedGoalHistory } from "../context/boundedGoalHistory"

describe("bounded goal history", () => {
  it("keeps the current task exact, a small recent tail, and three older retrieval excerpts", () => {
    const messages = Array.from({ length: 40 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `history-${index}`,
    }))
    messages.push({ role: "user", content: "CURRENT-REQUEST-EXACT" })
    const selected = selectBoundedGoalHistory(messages, Array.from({ length: 5 }, (_, index) => ({
      resultNumber: index + 1,
      conversationTitle: "Goal history",
      turnNumber: index + 1,
      occurredAt: "2026-07-26T00:00:00.000Z",
      content: `older-${index}`,
    })))
    expect(selected.at(-1)?.content).toBe("CURRENT-REQUEST-EXACT")
    expect(selected.filter((message) => message.role !== "developer")).toHaveLength(BOUNDED_GOAL_HISTORY_MAX_RECENT_MESSAGES + 1)
    expect(String(selected[0]?.content)).toContain("older-2")
    expect(String(selected[0]?.content)).not.toContain("older-3")
  })

  it("does not drop an oversized current continuation chain", () => {
    const selected = selectBoundedGoalHistory([
      { role: "user", content: "current" },
      { role: "assistant", content: "x".repeat(70_000) },
      { role: "tool", content: "verified tool result" },
    ])
    expect(selected).toHaveLength(3)
    expect(selected[2]?.content).toBe("verified tool result")
  })
})
