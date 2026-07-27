import { describe, expect, it } from "vitest"
import { z } from "zod"
import type { ModelProvider, StructuredModelRequest } from "@socrates/providers"
import { AgentInstance } from "../agent/AgentInstance"
import { defineAgent } from "../agent/AgentDefinition"
import { AgentRuntime } from "../agent/AgentRuntime"
import { ContextPipeline } from "../agent/ContextPipeline"
import { phaseOneAgentDefinitionInventory } from "../agent/agentDefinitions"
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

const runContext = {
  providerId: "openrouter" as const,
  modelId: "test/model",
  runtimeConfig,
  projectId: "proj_1",
  conversationId: "conv_1",
  sessionId: "sess_1",
  turnId: "turn_1",
  workspacePath: "/tmp/socrates-agent-instance-test",
}

const countTokens: ModelProvider["countTokens"] = async (request) => ({
  providerId: request.providerId,
  modelId: request.modelId,
  inputTokens: 4,
  baseTokens: 4,
  method: "local_tiktoken",
  safetyMarginPercent: 0,
})

describe("AgentInstance", () => {
  it("runs a declared tool-capable agent through the injected shared runtime and context pipeline", async () => {
    const requests: Array<{ system: string; tools: string[] }> = []
    let preparedCalls = 0
    const contextPipeline = new ContextPipeline()
    const runtime = new AgentRuntime({
      prepare: async (input) => {
        preparedCalls += 1
        return contextPipeline.prepare(input)
      },
      precompute: (input) => contextPipeline.precompute(input),
    })
    let streamed = false
    const provider: ModelProvider = {
      countTokens,
      async *stream(request) {
        streamed = true
        requests.push({ system: request.system, tools: (request.tools ?? []).map((tool) => tool.name) })
        yield {
          type: "model.tool_call.completed",
          toolCall: { toolCallId: "time_1", toolName: "current_time", input: {} },
        }
        yield { type: "model.completed", finishReason: "tool-calls" }
      },
      async generateStructured<TOutput>(request: StructuredModelRequest<TOutput>) {
        requests.push({ system: request.system, tools: [] })
        return { output: { ok: true } as TOutput }
      },
    }
    const definition = defineAgent<{ voice: string }, { ok: true }>({
      id: "phase-one-probe",
      role: "phase_one_probe",
      modelRole: "test",
      prompt: { id: "phase-one-probe-v1", buildSystem: (context) => `Voice: ${context.voice}` },
      completion: {
        mode: "streaming_tools_structured_final",
        schema: z.object({ ok: z.literal(true) }).strict(),
      },
      roleManifest: { id: "phase-one-probe-tools-v1", modelTools: ["current_time"] },
      contextProfile: {
        id: "phase-one-probe-context-v1",
        stages: ["stable_prompt", "exact_messages", "tool_definitions"],
      },
      limits: { maxToolCalls: 1, maxOutputRepairAttempts: 1 },
      persistenceScope: "turn",
    })
    const toolExecutors = {
      current_time: async () => ({
        currentDate: "2026-07-27",
        currentDateTime: "2026-07-27T19:30:00.000+02:00",
        timeZone: "Europe/Vienna",
        source: "system" as const,
      }),
    } as unknown as ToolExecutors

    const result = await new AgentInstance(definition, runtime).run({
      ...runContext,
      provider,
      promptContext: { voice: "warm and exact" },
      userContent: "Read the current time, then return the strict result.",
      toolRegistry: new ToolRegistry([currentTimeTool]),
      toolExecutors,
    })

    expect(result).toMatchObject({
      mode: "streaming_tools_structured_final",
      output: { ok: true },
      toolCalls: 1,
    })
    expect(streamed).toBe(true)
    expect(preparedCalls).toBe(2)
    expect(requests[0]).toEqual({ system: "Voice: warm and exact", tools: ["current_time"] })
    expect(requests[1]).toEqual({ system: "Voice: warm and exact", tools: [] })
  })

  it("rejects a registry that differs from the declared role manifest before provider execution", async () => {
    let providerCalled = false
    const provider: ModelProvider = {
      countTokens,
      async *stream() {
        providerCalled = true
        yield { type: "model.completed" }
      },
    }
    const definition = defineAgent<undefined, string>({
      id: "empty-worker",
      role: "empty_worker",
      modelRole: "test",
      prompt: { id: "empty-worker-v1", buildSystem: () => "Return text." },
      completion: { mode: "text" },
      roleManifest: { id: "empty-worker-tools-v1", modelTools: [] },
      contextProfile: { id: "empty-worker-context-v1", stages: ["stable_prompt", "exact_messages"] },
      limits: { maxToolCalls: 0 },
      persistenceScope: "none",
    })

    await expect(new AgentInstance(definition).run({
      ...runContext,
      provider,
      promptContext: undefined,
      userContent: "hello",
      toolRegistry: new ToolRegistry([currentTimeTool]),
      toolExecutors: {},
    })).rejects.toMatchObject({ code: "agent_role_manifest_mismatch" })
    expect(providerCalled).toBe(false)
  })

  it("enforces the timeout declared by the agent definition", async () => {
    let providerAborted = false
    const provider: ModelProvider = {
      countTokens,
      async *stream(request) {
        await new Promise<never>((_resolve, reject) => {
          request.abortSignal?.addEventListener("abort", () => {
            providerAborted = true
            reject(request.abortSignal?.reason)
          }, { once: true })
        })
      },
    }
    const definition = defineAgent<undefined, string>({
      id: "timed-worker",
      role: "timed_worker",
      modelRole: "test",
      prompt: { id: "timed-worker-v1", buildSystem: () => "Return text." },
      completion: { mode: "text" },
      roleManifest: { id: "timed-worker-tools-v1", modelTools: [] },
      contextProfile: { id: "timed-worker-context-v1", stages: ["stable_prompt", "exact_messages"] },
      limits: { maxToolCalls: 0, timeoutMs: 20 },
      persistenceScope: "none",
    })

    await expect(new AgentInstance(definition).run({
      ...runContext,
      provider,
      promptContext: undefined,
      userContent: "hello",
      toolRegistry: new ToolRegistry([]),
      toolExecutors: {},
    })).rejects.toMatchObject({ code: "agent_timeout" })
    expect(providerAborted).toBe(true)
  })

  it("rejects tools that bypass the definition's declared context stages", async () => {
    const definition = defineAgent<undefined, string>({
      id: "missing-tool-context",
      role: "missing_tool_context",
      modelRole: "test",
      prompt: { id: "missing-tool-context-v1", buildSystem: () => "Return text." },
      completion: { mode: "text" },
      roleManifest: { id: "missing-tool-context-tools-v1", modelTools: ["current_time"] },
      contextProfile: { id: "missing-tool-context-v1", stages: ["stable_prompt", "exact_messages"] },
      limits: { maxToolCalls: 1 },
      persistenceScope: "none",
    })

    await expect(new AgentInstance(definition).run({
      ...runContext,
      provider: { countTokens, async *stream() { yield { type: "model.completed" } } },
      promptContext: undefined,
      userContent: "hello",
      toolRegistry: new ToolRegistry([currentTimeTool]),
      toolExecutors: {},
    })).rejects.toMatchObject({ code: "agent_context_profile_mismatch" })
  })

  it("publishes a unique machine-readable inventory for every Phase 1 definition", () => {
    const inventory = phaseOneAgentDefinitionInventory()
    expect(new Set(inventory.map((entry) => entry.id)).size).toBe(inventory.length)
    expect(inventory).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "socrates-main",
        completionMode: "streaming_tools_structured_final",
        modelTools: expect.arrayContaining(["read", "bash", "trace_retrieve"]),
        dynamicToolPrefixes: ["mcp__"],
        maxOutputRepairAttempts: 1,
      }),
      expect.objectContaining({
        id: "skill-writer",
        completionMode: "text",
        modelTools: expect.arrayContaining(["trace_retrieve", "skill_write"]),
      }),
      expect.objectContaining({ id: "title-generator", completionMode: "structured", modelTools: [] }),
      expect.objectContaining({
        id: "global-memory",
        completionMode: "streaming_tools_structured_final",
        modelTools: expect.arrayContaining(["trace_retrieve", "memory_notes", "edit_files"]),
      }),
      expect.objectContaining({ id: "socrates-context-compactor", modelRole: "socrates_context_compactor" }),
    ]))
  })
})
