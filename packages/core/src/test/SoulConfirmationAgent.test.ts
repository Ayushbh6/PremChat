import { describe, expect, it } from "vitest"
import type { ModelProvider, StructuredModelRequest } from "@socrates/providers"
import { SoulConfirmationAgent } from "../agent/SoulConfirmationAgent"

describe("SoulConfirmationAgent", () => {
  it("uses AgentRuntime, the dedicated prompt, an empty tool scope, and strict structured output", async () => {
    const requests: StructuredModelRequest<unknown>[] = []
    let streamCalls = 0
    const provider: ModelProvider = {
      countTokens: async (request) => ({
        providerId: request.providerId,
        modelId: request.modelId,
        inputTokens: 5,
        baseTokens: 5,
        method: "local_tiktoken",
        safetyMarginPercent: 0,
      }),
      async *stream() {
        streamCalls += 1
        yield { type: "model.completed" }
      },
      async generateStructured<TOutput>(request: StructuredModelRequest<TOutput>) {
        requests.push(request as StructuredModelRequest<unknown>)
        return {
          output: {
            decision: "yes",
            reason: "The edit is narrow, durable, and supported by the supplied evidence.",
          } as TOutput,
        }
      },
    }

    const result = await new SoulConfirmationAgent().run({
      provider,
      modelSettings: {
        providerId: "openrouter",
        modelId: "deepseek/deepseek-v4-flash",
        thinkingEnabled: false,
      },
      targetPath: "/tmp/socrates/identity.md",
      rationale: "Preserve a verified durable operating principle.",
      oldText: "Old principle",
      newText: "Verified principle",
      projectId: "global",
      conversationId: "memory_job",
      sessionId: "memory_job",
      turnId: "memory_job",
      workspacePath: "/tmp/socrates",
    })

    expect(result.output).toMatchObject({ decision: "yes" })
    expect(streamCalls).toBe(0)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.system).toContain("Socrates Soul Confirmation Agent")
    expect(requests[0]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "user", content: expect.stringContaining("Verified principle") }),
    ]))
  })
})
