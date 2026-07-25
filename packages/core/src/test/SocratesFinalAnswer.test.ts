import { describe, expect, it } from "vitest"
import type { ModelProvider, StructuredModelRequest } from "@socrates/providers"
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
  it("withholds a plaintext tool envelope and publishes only a validated repaired result", async () => {
    const validFinalAnswer = "The Flow and Classic connection shares the main runtime, but finalization was committing before answer integrity was established."
    const structuredRequests: StructuredModelRequest<unknown>[] = []
    const outputs: unknown[] = [
      {
        finalAnswer: '<DSML><tool_calls><invoke name="search" /></tool_calls></DSML>',
        goalFinalization: { state: "completed", note: "Reviewed the architecture." },
      },
      {
        finalAnswer: validFinalAnswer,
        goalFinalization: { state: "active", note: "Review found a finalization ordering defect to correct." },
      },
    ]
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
        yield { type: "model.answer.delta", text: '<DSML><tool_calls><invoke name="search" /></tool_calls></DSML>' }
        yield { type: "model.completed", finishReason: "stop" }
      },
      async generateStructured<TOutput>(request: StructuredModelRequest<TOutput>) {
        structuredRequests.push(request as StructuredModelRequest<unknown>)
        return { output: outputs.shift() as TOutput }
      },
    }

    const events: SocratesAgentEvent[] = []
    for await (const event of new SocratesAgent(provider).streamTurn({
      providerId: runtimeConfig.providerId,
      modelId: runtimeConfig.modelId,
      runtimeConfig,
      messages: [{ role: "user", content: "Review Flow mode and its Classic connection." }],
      activeGoal: {
        goalId: "goal_review_flow",
        title: "Review Flow mode and Classic connection",
        state: "foreground",
        note: "Inspect the shared runtime and finalization path.",
      },
      finalAnswerMode: "structured",
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

    expect(structuredRequests).toHaveLength(2)
    expect(JSON.stringify(structuredRequests[1]?.messages)).toContain("failed validation")
    expect(visibleAnswer).toBe(validFinalAnswer)
    expect(visibleAnswer).not.toContain("DSML")
    expect(finalResult?.result).toEqual({
      finalAnswer: visibleAnswer,
      goalFinalization: { state: "active", note: "Review found a finalization ordering defect to correct." },
    })
  })
})
