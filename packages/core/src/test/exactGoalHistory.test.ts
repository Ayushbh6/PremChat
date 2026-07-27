import { describe, expect, it } from "vitest"
import { EXACT_GOAL_HISTORY_MAX_RECENT_MESSAGES, selectExactGoalHistory } from "../context/exactGoalHistory"

describe("selectExactGoalHistory", () => {
  it("selects complete recent messages and complete retrieved parents without clipping", () => {
    const exactRecent = `recent-${"r".repeat(20_000)}`
    const exactOlder = `older-${"o".repeat(25_000)}`
    const messages = [
      { role: "user" as const, content: exactRecent },
      { role: "assistant" as const, content: "done" },
      { role: "user" as const, content: "continue" },
    ]
    const selected = selectExactGoalHistory(messages, [{
      resultNumber: 1,
      conversationTitle: "Earlier work",
      turnNumber: 2,
      occurredAt: "2026-07-27T00:00:00.000Z",
      content: exactOlder,
    }])
    expect(selected[0]?.content).toContain(exactOlder)
    expect(selected.some((message) => message.content === exactRecent)).toBe(true)
    expect(selected.at(-1)?.content).toBe("continue")
  })

  it("uses exact item selection rather than a character budget", () => {
    const messages = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `${index}-${"x".repeat(8_000)}`,
    }))
    messages.push({ role: "user", content: "current" })
    const selected = selectExactGoalHistory(messages)
    expect(selected).toHaveLength(EXACT_GOAL_HISTORY_MAX_RECENT_MESSAGES + 1)
    expect(selected.at(-1)?.content).toBe("current")
    expect(selected.every((message) => typeof message.content === "string" && !message.content.endsWith("…"))).toBe(true)
  })
})
