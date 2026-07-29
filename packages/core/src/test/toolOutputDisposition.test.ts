import { describe, expect, it } from "vitest"
import type { NormalizedToolCall } from "@socrates/contracts"
import type { ModelMessage, ModelMessagePart } from "@socrates/providers"
import { ToolOutputDispositionLedger } from "../context/toolOutputDisposition"
import { compactModelToolOutput } from "../agent/socratesToolResultSupport"

const largeResult = (toolCallId: string, marker: string): ModelMessage => ({
  role: "tool",
  content: [{
    type: "tool-result",
    toolCallId,
    toolName: "read",
    output: { ok: true, output: { content: `${marker} ${"evidence ".repeat(6_000)}` } },
  }],
})

const call = (toolCallId: string, path: string): NormalizedToolCall => ({
  toolCallId,
  toolName: "read",
  input: { path },
})

describe("ToolOutputDispositionLedger", () => {
  it("numbers only qualifying results with friendly turn-local handles", () => {
    const small: ModelMessage = {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "small", toolName: "read", output: { ok: true, output: { content: "small" } } }],
    }
    const first = largeResult("large-1", "FIRST_MARKER")
    const second = largeResult("large-2", "SECOND_MARKER")
    const messages: ModelMessage[] = [small, first, second]
    const ledger = new ToolOutputDispositionLedger(messages)

    ledger.recordBatch({ message: small, toolCalls: [call("small", "small.md")], providerId: "deepseek", modelId: "deepseek-v4-pro" })
    ledger.recordBatch({ message: first, toolCalls: [call("large-1", "first.md")], providerId: "deepseek", modelId: "deepseek-v4-pro" })
    ledger.recordBatch({ message: second, toolCalls: [call("large-2", "second.md")], providerId: "deepseek", modelId: "deepseek-v4-pro" })

    expect(ledger.pendingResults()).toEqual(["R1", "R2"])
    const rendered = JSON.stringify(messages)
    expect(rendered.match(/Large temporary result R1:/g)).toHaveLength(1)
    expect(rendered.match(/Large temporary result R2:/g)).toHaveLength(1)
    expect(rendered).toContain("read first.md")
  })

  it("releases only the model-facing copy and removes the completed reminder", () => {
    const toolMessage = largeResult("call-1", "UNIQUE_EXACT_MARKER")
    const messages: ModelMessage[] = [toolMessage]
    const ledger = new ToolOutputDispositionLedger(messages)
    ledger.recordBatch({ message: toolMessage, toolCalls: [call("call-1", "report.md")], providerId: "deepseek", modelId: "deepseek-v4-pro" })

    const output = ledger.apply({ release: ["R1"] }, true)

    expect(output).toMatchObject({ released: ["R1"], ignored: [], piggybacked: true })
    expect(ledger.pendingResults()).toEqual([])
    expect(JSON.stringify(messages)).not.toContain("UNIQUE_EXACT_MARKER")
    expect(JSON.stringify(messages)).toContain('"contextDisposition":"released"')
    expect(JSON.stringify(messages)).toContain("trace_retrieve")
    expect(JSON.stringify(messages)).not.toContain("socrates_large_temporary_results")
  })

  it("batches reminders and keeps unreleased results available without ceremony", () => {
    const first = largeResult("call-1", "FIRST")
    const secondPart = (largeResult("call-2", "SECOND").content as ModelMessagePart[])[0]!
    ;(first.content as ModelMessagePart[]).push(secondPart)
    const messages: ModelMessage[] = [first]
    const ledger = new ToolOutputDispositionLedger(messages)
    ledger.recordBatch({
      message: first,
      toolCalls: [call("call-1", "first.md"), call("call-2", "second.md")],
      providerId: "deepseek",
      modelId: "deepseek-v4-pro",
    })

    expect(messages.filter((message) => message.role === "developer")).toHaveLength(0)
    ledger.apply({ release: ["R1"] }, true)
    expect(ledger.pendingResults()).toEqual(["R2"])
    expect(JSON.stringify(messages)).not.toContain("Large temporary result R1:")
    expect(JSON.stringify(messages)).toContain("Large temporary result R2:")
    expect(JSON.stringify(messages)).toContain("SECOND")
  })

  it("caps dynamic MCP projection at the shared default while preserving an exact-recovery contract", () => {
    const projected = compactModelToolOutput("mcp__documents__read", {
      image: { type: "image", data: "a".repeat(20_000), mimeType: "image/png" },
      content: [{ type: "text", text: `MCP_EXACT_MARKER ${"x".repeat(30_000)}` }],
    })
    const serialized = JSON.stringify(projected)

    expect(serialized.length).toBeLessThanOrEqual(16_000)
    expect(projected).toMatchObject({ truncated: true, kind: "dynamic_mcp_result_preview" })
    expect(serialized).toContain("exact result is persisted")
    expect(serialized).toContain("binary payload omitted")
    expect(serialized).not.toContain("a".repeat(500))
  })

  it("keeps the serialized MCP envelope under the hard cap even when preview text needs escaping", () => {
    const projected = compactModelToolOutput("mcp__documents__read", { content: `MCP_ESCAPED ${"\\\"".repeat(20_000)}` })

    expect(JSON.stringify(projected).length).toBeLessThanOrEqual(16_000)
    expect(projected).toMatchObject({ truncated: true, kind: "dynamic_mcp_result_preview" })
  })

  it("assigns R handles from the exact raw result even when the model projection was capped", () => {
    const message: ModelMessage = {
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "provider-call",
        toolName: "mcp__documents__read",
        output: { ok: true, output: { truncated: true, preview: "short projection" } },
      }],
    }
    const ledger = new ToolOutputDispositionLedger()
    const assignments = ledger.recordBatch({
      message,
      toolCalls: [{ ...call("runtime-call", "report.pdf"), providerToolCallId: "provider-call", toolName: "mcp__documents__read" }],
      rawResults: [{ toolCallId: "runtime-call", providerToolCallId: "provider-call", ok: true, output: { content: "x".repeat(30_000) } }],
      providerId: "deepseek",
      modelId: "deepseek-v4-pro",
    })

    expect(assignments).toEqual([{ result: "R1", toolCallId: "runtime-call" }])
    expect(JSON.stringify(message)).toContain("Large temporary result R1")
  })
})
