import type { Message } from "@socrates/contracts"
import { describe, expect, it } from "vitest"
import { flowQueriesForGoal, flowQueryCountsByGoal } from "./flowNavigation"

const message = (id: string, turnId: string, role: Message["role"], content = id): Message => ({
  id,
  conversationId: "flow_1",
  sessionId: "flow_1",
  turnId,
  role,
  content,
  status: "completed",
  createdAt: "2026-07-26T00:00:00.000Z",
})

describe("Flow goal and query navigation", () => {
  const messages = [
    message("u1", "turn_1", "user", "Review the focus ledger"),
    message("a1", "turn_1", "assistant"),
    message("u2", "turn_2", "user", "Add the requested information"),
    message("a2", "turn_2", "assistant"),
    message("u3", "turn_3", "user", "Review trace retrieval"),
  ]
  const mapping = {
    u1: "goal_ledger",
    a1: "goal_ledger",
    u2: "goal_ledger",
    a2: "goal_ledger",
    u3: "goal_trace",
  }

  it("shows only the Q and A pairs belonging to the selected goal", () => {
    const queries = flowQueriesForGoal({ messages, goalIdByMessageId: mapping, goalId: "goal_ledger" })
    expect(queries.map((query) => query.id)).toEqual(["turn_1", "turn_2"])
    expect(queries.at(-1)).toMatchObject({ label: "Add the requested information", isCurrent: true })
  })

  it("keeps the running query current inside its own selected goal", () => {
    const queries = flowQueriesForGoal({
      messages,
      goalIdByMessageId: mapping,
      goalId: "goal_trace",
      activeTurnId: "turn_3",
    })
    expect(queries).toHaveLength(1)
    expect(queries[0]).toMatchObject({ id: "turn_3", isCurrent: true })
  })

  it("derives goal counts from the same canonical message mapping", () => {
    const counts = flowQueryCountsByGoal(messages, mapping)
    expect(counts.get("goal_ledger")).toBe(2)
    expect(counts.get("goal_trace")).toBe(1)
  })
})
