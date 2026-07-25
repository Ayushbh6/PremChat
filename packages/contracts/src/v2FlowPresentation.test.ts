import { describe, expect, it } from "vitest"
import { v2ClientCommandSchema, v2LiveActivitySchema, v2ServerEventSchema } from "./index"

describe("V2 Flow presentation contracts", () => {
  it("accepts the replace-in-place live activity event", () => {
    const parsed = v2ServerEventSchema.parse({
      id: "event_1",
      schemaVersion: 2,
      timestamp: "2026-07-26T00:00:00.000Z",
      projectId: "project_1",
      flowId: "flow_1",
      turnId: "turn_1",
      actor: { type: "system" },
      type: "v2.activity.updated",
      payload: { activity: { turnId: "turn_1", phase: "tool", label: "Reading runtime.ts…" } },
    })
    expect(parsed.type).toBe("v2.activity.updated")
  })

  it("supports presentation-only goal selection without a lifecycle transition", () => {
    const parsed = v2ClientCommandSchema.parse({
      id: "event_2",
      schemaVersion: 2,
      timestamp: "2026-07-26T00:00:00.000Z",
      projectId: "project_1",
      flowId: "flow_1",
      goalId: "goal_done",
      type: "v2.focus.update",
      payload: { goalId: "goal_done", action: "select" },
    })
    expect(parsed.type).toBe("v2.focus.update")
    if (parsed.type === "v2.focus.update") expect(parsed.payload.action).toBe("select")
  })

  it("bounds activity copy", () => {
    expect(v2LiveActivitySchema.safeParse({ turnId: "turn_1", phase: "tool", label: "x".repeat(121) }).success).toBe(false)
  })
})
