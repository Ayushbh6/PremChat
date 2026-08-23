import { describe, expect, it } from "vitest"
import { socratesClientCommandSchema, socratesLiveActivitySchema, socratesServerEventSchema } from "./index"

describe("global Socrates presentation contracts", () => {
  it("accepts the replace-in-place live activity event", () => {
    const parsed = socratesServerEventSchema.parse({
      id: "event_1",
      schemaVersion: 3,
      timestamp: "2026-07-26T00:00:00.000Z",
      turnId: "turn_1",
      actor: { type: "system" },
      type: "socrates.activity.updated",
      payload: { activity: { turnId: "turn_1", phase: "tool", label: "Reading runtime.ts…" } },
    })
    expect(parsed.type).toBe("socrates.activity.updated")
  })

  it("rejects passive history selection as a server-side goal mutation", () => {
    const parsed = socratesClientCommandSchema.safeParse({
      id: "event_2",
      schemaVersion: 3,
      timestamp: "2026-07-26T00:00:00.000Z",
      goalId: "goal_done",
      type: "socrates.goal.update",
      payload: { goalId: "goal_done", action: "select" },
    })
    expect(parsed.success).toBe(false)
  })

  it("bounds activity copy", () => {
    expect(socratesLiveActivitySchema.safeParse({ turnId: "turn_1", phase: "tool", label: "x".repeat(121) }).success).toBe(false)
  })
})
