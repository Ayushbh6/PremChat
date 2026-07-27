import { describe, expect, it } from "vitest"
import type { Schema } from "ai"
import { z } from "zod"
import {
  bashToolInputSchema,
  editToolInputSchema,
  traceRetrieveMainToolInputSchema,
} from "@socrates/contracts"
import { inputSchemaForAiTool, mapUsage, normalizeAiSdkToolCallPart, toAiModelMessage } from "../ai-sdk/AiSdkProvider"

describe("AI SDK provider metadata", () => {
  it("preserves Gemini thought signatures from streamed tool calls", () => {
    expect(
      normalizeAiSdkToolCallPart({
        toolCallId: "call_1",
        toolName: "read",
        input: { path: "README.md" },
        providerMetadata: { google: { thoughtSignature: "sig_1" } },
      }),
    ).toEqual({
      toolCallId: "call_1",
      toolName: "read",
      input: { path: "README.md" },
      providerMetadata: { google: { thoughtSignature: "sig_1" } },
    })
  })

  it("passes provider metadata back as provider options on assistant tool-call messages", () => {
    expect(
      toAiModelMessage({
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "read",
            input: { path: "README.md" },
            providerMetadata: { google: { thoughtSignature: "sig_1" } },
          },
        ],
      }),
    ).toEqual({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "read",
          input: { path: "README.md" },
          providerOptions: { google: { thoughtSignature: "sig_1" } },
        },
      ],
    })
  })

  it("passes OpenAI reasoning metadata back as provider options on assistant reasoning parts", () => {
    expect(
      toAiModelMessage({
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "",
            providerMetadata: { openai: { itemId: "rs_1", reasoningEncryptedContent: null } },
          },
          {
            type: "tool-call",
            toolCallId: "fc_1",
            toolName: "read",
            input: { path: "README.md" },
            providerMetadata: { openai: { itemId: "fc_item_1" } },
          },
        ],
      }),
    ).toEqual({
      role: "assistant",
      content: [
        {
          type: "reasoning",
          text: "",
          providerOptions: { openai: { itemId: "rs_1", reasoningEncryptedContent: null } },
        },
        {
          type: "tool-call",
          toolCallId: "fc_1",
          toolName: "read",
          input: { path: "README.md" },
          providerOptions: { openai: { itemId: "fc_item_1" } },
        },
      ],
    })
  })

  it("maps Socrates image parts to AI SDK image parts without the data URL prefix", () => {
    expect(
      toAiModelMessage({
        role: "user",
        content: [
          { type: "text", text: "what do you see?" },
          { type: "image", mediaType: "image/png", data: "data:image/png;base64,aGVsbG8=", fileName: "screenshot.png" },
        ],
      }),
    ).toEqual({
      role: "user",
      content: [
        { type: "text", text: "what do you see?" },
        { type: "image", mediaType: "image/png", image: "aGVsbG8=" },
      ],
    })
  })

  it("passes final provider metadata into normalized usage", () => {
    const usage = mapUsage(
      "openrouter",
      "deepseek/deepseek-v4-flash",
      {
        inputTokens: 1000,
        outputTokens: 100,
        totalTokens: 1100,
        inputTokenDetails: {},
        outputTokenDetails: {},
        raw: {
          prompt_tokens: 1000,
          completion_tokens: 100,
          total_tokens: 1100,
        },
      } as never,
      {
        openrouter: {
          provider: "DeepSeek",
          usage: {
            cost: 0.0012,
            promptTokensDetails: {
              cachedTokens: 700,
            },
          },
        },
      },
    )

    expect(usage.providerMetadata).toEqual({
      openrouter: {
        provider: "DeepSeek",
        usage: {
          cost: 0.0012,
          promptTokensDetails: {
            cachedTokens: 700,
          },
        },
      },
    })
    expect(usage.costUsd).toBe(0.0012)
    expect(usage.costSource).toBe("provider_reported")
    expect(usage.cachedInputTokens).toBe(700)
    expect(usage.raw).toMatchObject({ prompt_tokens: 1000 })
  })

  it("uses the catalog projection while retaining the canonical runtime schema", () => {
    expect(editToolInputSchema.safeParse({ path: "README.md", oldString: "old", newString: "new" }).success).toBe(true)
    expect(editToolInputSchema.safeParse({ path: "README.md", content: "new" }).success).toBe(true)
    expect(editToolInputSchema.safeParse({ path: "README.md", content: "new", oldString: "old", newString: "new" }).success).toBe(false)
  })

  it("passes the exact catalog schema to AI SDK and validates with the canonical schema", async () => {
    const providerInputSchema = {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: { type: "string" },
        oldString: { type: "string" },
        newString: { type: "string" },
        content: { type: "string" },
        overwrite: { enum: [true] },
      },
    }
    const schema = inputSchemaForAiTool({
      name: "edit",
      description: "Create or modify one file.",
      inputSchema: editToolInputSchema,
      resultSchema: z.unknown(),
      providerInputSchema,
    }) as Schema

    expect(schema.jsonSchema).toBe(providerInputSchema)

    await expect(Promise.resolve(schema.validate?.({ path: "README.md", oldString: "old", newString: "new" }))).resolves.toEqual({
      success: true,
      value: { path: "README.md", oldString: "old", newString: "new" },
    })
    await expect(Promise.resolve(schema.validate?.({ path: "README.md", content: "new", overwrite: true }))).resolves.toEqual({
      success: true,
      value: { path: "README.md", content: "new", overwrite: true },
    })
    await expect(Promise.resolve(schema.validate?.({ path: "README.md", content: "new", overwrite: false }))).resolves.toMatchObject({ success: false })
    const invalid = await Promise.resolve(schema.validate?.({ path: "README.md", content: "new", oldString: "old", newString: "new" }))
    expect(invalid?.success).toBe(false)
  })

  it("rejects malformed Terminal calls instead of repairing provider output", async () => {
    const providerInputSchema = { type: "object", additionalProperties: false, properties: { command: { type: "string" }, argv: { type: "array", items: { type: "string" } } } }
    const schema = inputSchemaForAiTool({
      name: "bash",
      description: "Run a Terminal command.",
      inputSchema: bashToolInputSchema,
      resultSchema: z.unknown(),
      providerInputSchema,
    }) as Schema

    expect(schema.jsonSchema).toBe(providerInputSchema)
    await expect(Promise.resolve(schema.validate?.({ command: "pnpm run build", argv: ["pnpm", "run", "build"] }))).resolves.toMatchObject({ success: false })
    await expect(Promise.resolve(schema.validate?.({ operation: "start", argv: ["pnpm", "dev"] }))).resolves.toMatchObject({ success: false })
  })

  it("keeps provider projection separate from canonical trace validation", async () => {
    const providerInputSchema = { type: "object", additionalProperties: false, properties: { query: { type: "string" }, operation: { type: "string" }, messageId: { type: "string" } } }
    const schema = inputSchemaForAiTool({
      name: "trace_retrieve",
      description: "Search or inspect previous trace documents.",
      inputSchema: traceRetrieveMainToolInputSchema,
      resultSchema: z.unknown(),
      providerInputSchema,
    }) as Schema

    expect(schema.jsonSchema).toBe(providerInputSchema)

    await expect(Promise.resolve(schema.validate?.({ query: "screenshot" }))).resolves.toEqual({
      success: true,
      value: { query: "screenshot" },
    })
    const invalid = await Promise.resolve(schema.validate?.({ operation: "inspect" }))
    expect(invalid?.success).toBe(false)
    await expect(Promise.resolve(schema.validate?.({ operation: "inspect", resultNumber: 1 }))).resolves.toEqual({
      success: true,
      value: { operation: "inspect", resultNumber: 1 },
    })
  })
})
