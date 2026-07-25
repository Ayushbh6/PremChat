import { describe, expect, it } from "vitest"
import { z } from "zod"
import type { ModelProvider, StructuredModelRequest } from "@socrates/providers"
import { StructuredToolAgentRunner } from "../agent/StructuredToolAgentRunner"
import { currentTimeTool } from "../tools/currentTimeTool"
import { ToolRegistry } from "../tools/registry"
import type { ToolExecutors } from "../tools/types"

const runtimeConfig = {
  providerId: "openrouter" as const,
  authMode: "api_key" as const,
  modelId: "test/model",
  thinkingEnabled: false,
  thinkingEffort: "none" as const,
  approvalMode: "read_only_auto" as const,
  sandboxMode: "read_only" as const,
}

const countTokens: ModelProvider["countTokens"] = async (request) => ({
  providerId: request.providerId,
  modelId: request.modelId,
  inputTokens: 1,
  baseTokens: 1,
  method: "local_tiktoken",
  safetyMarginPercent: 0,
})

const runBase = {
  providerId: "openrouter" as const,
  modelId: "test/model",
  runtimeConfig,
  system: "Return the requested structured result.",
  userContent: "Read the current time and report success.",
  projectId: "proj_1",
  conversationId: "conv_1",
  sessionId: "sess_1",
  turnId: "turn_1",
  workspacePath: "/tmp/socrates-structured-runner-test",
}

describe("StructuredToolAgentRunner", () => {
  it("returns schema errors to the model, permits a corrected native tool call, and then validates the final result", async () => {
    let streamCalls = 0
    const toolResults: Array<{ toolName: string; input: unknown; output: unknown }> = []
    const provider: ModelProvider = {
      countTokens,
      async *stream() {
        streamCalls += 1
        if (streamCalls === 1) {
          yield {
            type: "model.tool_call.completed",
            toolCall: { toolCallId: "bad_time", toolName: "current_time", input: { unsupported: true } },
          }
        } else {
          yield {
            type: "model.tool_call.completed",
            toolCall: { toolCallId: "good_time", toolName: "current_time", input: {} },
          }
        }
        yield { type: "model.completed", finishReason: "tool-calls" }
      },
      async generateStructured<TOutput>() {
        return { output: { ok: true } as TOutput }
      },
    }
    const toolExecutors = {
      current_time: async () => ({
        currentDate: "2026-07-25",
        currentDateTime: "2026-07-25T15:30:00.000+02:00",
        timeZone: "Europe/Vienna",
        source: "system" as const,
      }),
    } as unknown as ToolExecutors

    const result = await new StructuredToolAgentRunner().run({
      ...runBase,
      provider,
      schema: z.object({ ok: z.literal(true) }).strict(),
      toolRegistry: new ToolRegistry([currentTimeTool]),
      toolExecutors,
      maxToolCalls: 2,
      onToolResult: ({ toolName, input, output }) => toolResults.push({ toolName, input, output }),
    })

    expect(result.output).toEqual({ ok: true })
    expect(result.toolCalls).toBe(2)
    expect(streamCalls).toBe(2)
    expect(toolResults).toEqual([
      {
        toolName: "current_time",
        input: { unsupported: true },
        output: expect.objectContaining({ error: expect.objectContaining({ code: "invalid_tool_input" }) }),
      },
      {
        toolName: "current_time",
        input: {},
        output: expect.objectContaining({ currentDate: "2026-07-25", timeZone: "Europe/Vienna" }),
      },
    ])
  })

  it("gives one bounded validation repair before accepting a strict structured final", async () => {
    const requests: StructuredModelRequest<unknown>[] = []
    const outputs: unknown[] = [{ ok: false, extra: "invalid" }, { ok: true }]
    const provider: ModelProvider = {
      countTokens,
      async *stream() {
        throw new Error("The no-tool completion mode must not enter the streaming loop.")
      },
      async generateStructured<TOutput>(request: StructuredModelRequest<TOutput>) {
        requests.push(request as StructuredModelRequest<unknown>)
        return { output: outputs.shift() as TOutput }
      },
    }

    const result = await new StructuredToolAgentRunner().run({
      ...runBase,
      provider,
      schema: z.object({ ok: z.literal(true) }).strict(),
      toolRegistry: new ToolRegistry([]),
      toolExecutors: {},
      maxToolCalls: 0,
      maxOutputRepairAttempts: 1,
    })

    expect(result.output).toEqual({ ok: true })
    expect(result.toolCalls).toBe(0)
    expect(requests).toHaveLength(2)
    expect(JSON.stringify(requests[1]?.messages)).toContain("failed validation")
    expect(JSON.stringify(requests[1]?.messages)).toContain("invalid")
  })

  it("fails explicitly when the provider cannot generate a structured result", async () => {
    const provider: ModelProvider = {
      countTokens,
      async *stream() {
        yield { type: "model.completed" }
      },
    }

    await expect(new StructuredToolAgentRunner().run({
      ...runBase,
      provider,
      schema: z.object({ ok: z.literal(true) }).strict(),
      toolRegistry: new ToolRegistry([]),
      toolExecutors: {},
      maxToolCalls: 0,
    })).rejects.toMatchObject({ code: "structured_generation_unavailable" })
  })
})
