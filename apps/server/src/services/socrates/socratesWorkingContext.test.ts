import { describe, expect, it } from "vitest"
import type { ModelMessage } from "@socrates/providers"
import { buildSocratesWorkingMessages } from "./socratesWorkingContext"

describe("global Socrates working context", () => {
  it("places Terminal wake evidence after the original user request", async () => {
    const retained: ModelMessage[] = [
      { role: "assistant", content: "Earlier work." },
      { role: "user", content: "Run the command and wait for it." },
    ]
    const store = {
      getModelMessages: () => retained,
      getGoalHomeProjectId: () => "global",
      goalRetrievalParentGroups: () => [{ projectId: "global" }],
    }
    const sharedStore = {
      prepareExactGoalHistory: async () => retained,
    }

    const messages = await buildSocratesWorkingMessages(store as never, sharedStore as never, {
      projectId: "global",
      goalId: "goal_1",
      query: "Run the command and wait for it.",
      includeImages: false,
      lateDeveloperContext: "Terminal exited with code 0. Do not restart already-attempted work.",
    })

    expect(messages.at(-2)).toEqual(retained.at(-1))
    expect(messages.at(-1)).toMatchObject({ role: "developer" })
    expect(String(messages.at(-1)?.content)).toContain("Terminal exited with code 0")
    expect(String(messages.at(-1)?.content)).toContain("Do not restart already-attempted work")
  })
})
