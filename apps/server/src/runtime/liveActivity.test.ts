import { describe, expect, it } from "vitest"
import { createSocratesLiveActivity, socratesToolActivity } from "./liveActivity"

describe("Socrates live activity presentation", () => {
  it("maps tool execution to one bounded user-facing label", () => {
    expect(socratesToolActivity("turn_1", "read", { path: "/workspace/src/traceRetrieveTool.ts" })).toEqual({
      turnId: "turn_1",
      phase: "tool",
      label: "Reading traceRetrieveTool.ts…",
    })
    expect(socratesToolActivity("turn_1", "search", { query: "secret search text" }).label).toBe("Searching the workspace…")
  })

  it("never exposes unknown tool names, raw arguments, or undefined labels", () => {
    const activity = socratesToolActivity("turn_1", "internal_opaque_tool_927", {
      query: "private user text",
      token: "secret",
    })
    expect(activity.label).toBe("Working with the project tools…")
    expect(activity.label).not.toMatch(/private|secret|undefined|internal_opaque/i)
  })

  it("rejects labels outside the shared presentation contract", () => {
    expect(() => createSocratesLiveActivity("turn_1", "thinking", " ")).toThrow()
    expect(() => createSocratesLiveActivity("turn_1", "thinking", "x".repeat(121))).toThrow()
  })
})
