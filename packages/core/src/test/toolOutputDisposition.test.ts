import { describe, expect, it } from "vitest"
import type { NormalizedToolCall } from "@socrates/contracts"
import type { ModelMessage, ModelMessagePart } from "@socrates/providers"
import { ToolOutputDispositionLedger } from "../context/toolOutputDisposition"

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
})
