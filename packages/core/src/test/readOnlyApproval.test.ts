import { describe, expect, it } from "vitest"
import type { FilesystemAuthorizationSnapshot } from "@socrates/contracts"
import type { ModelProvider } from "@socrates/providers"
import { SocratesAgent, type ToolExecutors } from "../index"

const access: FilesystemAuthorizationSnapshot = {
  id: "access_1",
  turnId: "task_1",
  mode: "read_only",
  revision: 1,
  roots: [],
  workingRootPath: "/tmp",
  createdAt: "2026-07-30T00:00:00.000Z",
}

describe("Read only tool lifecycle", () => {
  it("executes a precise approved write without changing the immutable Read only snapshot", async () => {
    let providerCalls = 0
    let approvals = 0
    let writes = 0
    const provider: ModelProvider = {
      countTokens: async (request) => ({
        providerId: request.providerId,
        modelId: request.modelId,
        inputTokens: 1,
        baseTokens: 1,
        method: "local_tiktoken",
        safetyMarginPercent: 0,
      }),
      async *stream() {
        providerCalls += 1
        if (providerCalls === 1) {
          yield {
            type: "model.tool_call.completed",
            toolCall: { toolCallId: "provider_edit", toolName: "edit", input: { path: "approved.txt", content: "approved" } },
          }
          yield { type: "model.completed", finishReason: "tool_calls" }
          return
        }
        yield { type: "model.answer.delta", text: JSON.stringify({ finalAnswer: "The approved write completed.", goalFinalization: { state: "completed", note: "Wrote the approved file." } }) }
        yield { type: "model.completed", finishReason: "stop" }
      },
    }
    const executors: ToolExecutors = {
      read: async (input) => ({ path: input.path, kind: "missing", truncation: { truncated: false, charLimit: 20_000, returnedLength: 0 } }),
      search: async () => ({ mode: "files", query: "", matches: [], totalMatches: 0, truncation: { truncated: false, charLimit: 20_000, returnedLength: 0 } }),
      url_fetch: async () => ({ url: "https://example.com", finalUrl: "https://example.com", status: 200, ok: true, redirected: false, sizeBytes: 0, text: "", truncation: { truncated: false, charLimit: 20_000, returnedLength: 0 } }),
      edit: async (_input, context) => {
        if (!context.previewOnly) writes += 1
        return { changedFiles: [], diff: "approved.txt", dryRun: Boolean(context.previewOnly), truncation: { truncated: false, charLimit: 20_000, returnedLength: 12 } }
      },
      apply_patch: async (_input, context) => ({ changedFiles: [], diff: "", dryRun: Boolean(context.previewOnly), truncation: { truncated: false, charLimit: 20_000, returnedLength: 0 } }),
      bash: async () => ({ cwd: "/tmp", exitCode: 0, stdout: "", stderr: "", durationMs: 0, timedOut: false, truncation: { truncated: false, charLimit: 20_000, returnedLength: 0 }, shell: { platform: "darwin", kind: "posix", executable: "/bin/zsh" } }),
      current_time: async () => ({ currentDate: "2026-07-30", currentDateTime: "2026-07-30T00:00:00.000Z", timeZone: "Europe/Vienna", source: "system" }),
      trace_retrieve: async () => ({ results: [], totalMatches: 0 }),
    }

    const events = []
    for await (const event of new SocratesAgent(provider).streamTurn({
      completionMode: "main_structured",
      providerId: "openrouter",
      modelId: "deepseek/deepseek-v4-pro",
      runtimeConfig: { providerId: "openrouter", modelId: "deepseek/deepseek-v4-pro", authMode: "api_key", thinkingEnabled: false, thinkingEffort: "none", approvalMode: "manual", sandboxMode: "read_only" },
      messages: [{ role: "user", content: "Create approved.txt" }],
      workspacePath: "/tmp",
      filesystemAuthorization: access,
      stableCachePreludeSnapshot: { identitySections: {} },
      toolExecutors: executors,
      requestApproval: async () => {
        approvals += 1
        return { decision: "approved" }
      },
    })) events.push(event)

    expect(approvals).toBe(1)
    expect(writes).toBe(1)
    expect(access.mode).toBe("read_only")
    expect(events).toContainEqual(expect.objectContaining({ type: "approval.requested", request: expect.objectContaining({ toolName: "edit" }) }))
    expect(events).toContainEqual(expect.objectContaining({ type: "agent.final_result" }))
  })
})
