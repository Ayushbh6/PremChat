import { describe, expect, it } from "vitest"
import type { ModelProvider } from "@socrates/providers"
import { SocratesAgent, type SocratesAgentEvent } from "../agent/SocratesAgent"

const runtimeConfig = {
  providerId: "openrouter" as const,
  authMode: "api_key" as const,
  modelId: "test/model",
  thinkingEnabled: false,
  thinkingEffort: "none" as const,
  approvalMode: "manual" as const,
  sandboxMode: "read_only" as const,
}

describe("Socrates structured final answer", () => {
  it("withholds plaintext until persistence can publish the validated same-loop result", async () => {
    const validFinalAnswer = "The foreground runtime was committing finalization before answer integrity was established."
    let streamCalls = 0
    const provider: ModelProvider = {
      countTokens: async (request) => ({
        providerId: request.providerId,
        modelId: request.modelId,
        inputTokens: 10,
        baseTokens: 10,
        method: "local_tiktoken",
        safetyMarginPercent: 0,
      }),
      async *stream() {
        streamCalls += 1
        yield {
          type: "model.answer.delta",
          text: JSON.stringify({
            finalAnswer: validFinalAnswer,
            goalFinalization: { state: "active", note: "Review found a finalization ordering defect to correct." },
          }),
        }
        yield { type: "model.completed", finishReason: "stop" }
      },
    }

    const events: SocratesAgentEvent[] = []
    for await (const event of new SocratesAgent(provider).streamTurn({
      providerId: runtimeConfig.providerId,
      modelId: runtimeConfig.modelId,
      runtimeConfig,
      messages: [{ role: "user", content: "Review the foreground runtime finalization boundary." }],
      activeGoal: {
        goalId: "goal_review_finalization",
        title: "Review foreground runtime finalization",
        state: "foreground",
        note: "Inspect the shared runtime and finalization path.",
      },
      completionMode: "main_structured",
    })) {
      events.push(event)
    }

    const visibleAnswer = events
      .filter((event): event is Extract<SocratesAgentEvent, { type: "model.answer.delta" }> => event.type === "model.answer.delta")
      .map((event) => event.text)
      .join("")
    const finalResult = events.find(
      (event): event is Extract<SocratesAgentEvent, { type: "agent.final_result" }> => event.type === "agent.final_result",
    )

    expect(streamCalls).toBe(1)
    expect(visibleAnswer).toBe("")
    expect(finalResult?.result).toEqual({
      finalAnswer: validFinalAnswer,
      goalFinalization: { state: "active", note: "Review found a finalization ordering defect to correct." },
    })
  })

  it("strictly validates one JSON object surrounded by provider formatting noise", async () => {
    const provider: ModelProvider = {
      countTokens: async (request) => ({
        providerId: request.providerId,
        modelId: request.modelId,
        inputTokens: 10,
        baseTokens: 10,
        method: "local_tiktoken",
        safetyMarginPercent: 0,
      }),
      async *stream() {
        yield {
          type: "model.answer.delta",
          text: `The requested evidence is present.\n\n${JSON.stringify({
            finalAnswer: "Verified the exact project-memory evidence after the read completed.",
            goalFinalization: { state: "active", note: "The verification goal remains active." },
          })}\n\n]`,
        }
        yield { type: "model.completed", finishReason: "stop" }
      },
    }

    const events: SocratesAgentEvent[] = []
    for await (const event of new SocratesAgent(provider).streamTurn({
      providerId: runtimeConfig.providerId,
      modelId: runtimeConfig.modelId,
      runtimeConfig,
      messages: [{ role: "user", content: "Verify the exact evidence." }],
      activeGoal: {
        goalId: "goal_verify_evidence",
        title: "Verify exact evidence",
        state: "foreground",
        note: "Read and verify the requested evidence.",
      },
      completionMode: "main_structured",
    })) events.push(event)

    const finalResult = events.find(
      (event): event is Extract<SocratesAgentEvent, { type: "agent.final_result" }> => event.type === "agent.final_result",
    )
    expect(finalResult?.result).toEqual({
      finalAnswer: "Verified the exact project-memory evidence after the read completed.",
      goalFinalization: { state: "active", note: "The verification goal remains active." },
    })
    expect(events.some((event) => event.type === "model.answer.delta")).toBe(false)
  })
})
