import { describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import { SocratesAgent, capabilityCatalog, socratesBasePrompt, socratesMainAgentDefinition, type SocratesAgentEvent, type ToolExecutors } from "../index"
import type { ModelEvent, ModelMessage, ModelProvider } from "@socrates/providers"
import { bashTool } from "../tools/bashTool"
import { capabilityManagerTool } from "../tools/capabilityManagerTool"
import { frontierHandoverTool } from "../tools/frontierHandoverTool"

describe("SocratesAgent", () => {
  it("streams through the provider with Socrates prompt and history", async () => {
    const events: ModelEvent[] = [{ type: "model.answer.delta", text: "Hello" }, { type: "model.completed" }]
    const seen: unknown[] = []
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        seen.push(request)
        yield* events
      },
    }

    const agent = new SocratesAgent(provider)
    const streamed: SocratesAgentEvent[] = []
    for await (const event of agent.streamTurn({
      completionMode: "worker_text",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "read_only",
      },
      messages: [{ role: "user", content: "Hi" }],
    })) {
      streamed.push(event)
    }

    expect(streamed).toEqual(events.map((event) => ({ ...event, stepIndex: 0 })))
    const requestJson = JSON.stringify(seen[0])
    expect(requestJson).toContain("You are Socrates")
    expect(requestJson).toContain("Hi")
    expect(requestJson).toContain("Read before existing-file mutations")
    expect(requestJson).toContain("do not mutate user workspace artifacts")
    expect(requestJson).toContain("project-doc reconciliation remains governed by the durable-state rules")
    expect(requestJson).toContain("Product copy says Terminal; tool id is bash")
    expect(requestJson).toContain("socrates://tool-guidance")
    expect(requestJson).toContain("socrates://skills")
    expect(requestJson).toContain("search `socrates://capabilities`")
    expect(requestJson).toContain("current_time")
    expect(requestJson).toContain("socrates://project/memory")
    expect(requestJson).toContain("Use regex=true only for regex syntax")
    expect(requestJson).toContain(".socrates/MEMORY.md")
    expect(requestJson).toContain("live cross-conversation project memory")
    expect(requestJson).toContain("active assistant notebook")
    expect(requestJson).toContain("Durable-state operating loop")
    expect(requestJson).toContain("socrates://project/repo-docs")
    expect(requestJson).toContain("A separate Global Memory Agent runs in the background")
    expect(requestJson).toContain("A genuine user instruction not to remember")
    expect(requestJson).toContain("Interpret intent from the full semantic meaning, not by keyword")
    expect(requestJson).toContain("Keep user workspace artifacts separate from Socrates' internal project state")
    expect(requestJson).toContain("it does not by itself opt content out of project memory")
    expect(requestJson).toContain("Explicit user-stated allergies")
    expect(requestJson).toContain("compare stack trace lines to current files")
    expect(requestJson).toContain("distinguish config/credential issues from service availability")
    expect(requestJson).toContain("you are the primary Socrates worker")
    expect(requestJson).toContain("make a real, substantive effort")
    expect(requestJson).toContain("Difficulty or importance alone is not a blocker")
    expect(requestJson).toContain("always pauses for explicit user approval")
    expect(requestJson).toContain("Treat long read/search/Terminal/MCP/retrieval outputs as temporary evidence")
    expect(requestJson).toContain("release unneeded handles with context_disposition")
    expect(requestJson).toContain("Release is optional")
    expect(Buffer.byteLength(socratesBasePrompt, "utf8")).toBeLessThanOrEqual(26_000)
    expect(socratesBasePrompt).toContain("terminal response from this same loop must be exactly one JSON object")
    expect(socratesBasePrompt).not.toContain("Runtime action ledger")
    expect(socratesBasePrompt).not.toContain("socrates_final_answer_checkpoint")
  })

  it("rejects an unfinished streamed tool call without executing partial arguments", async () => {
    let readExecutions = 0
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream() {
        yield {
          type: "model.tool_call.streaming",
          toolCallId: "provider_partial_read",
          toolName: "read",
          argsText: '{"path":"README',
        }
        yield { type: "model.completed", finishReason: "length" }
      },
    }
    const executors = emptyToolExecutors()
    executors.read = async (input) => {
      readExecutions += 1
      return governedResourceOutput(input.path, "must not execute")
    }
    const run = async () => {
      for await (const _event of new SocratesAgent(provider).streamTurn({
        completionMode: "main_structured",
        providerId: "openrouter",
        modelId: "deepseek/deepseek-v4-pro",
        runtimeConfig: {
          providerId: "openrouter",
          authMode: "api_key",
          modelId: "deepseek/deepseek-v4-pro",
          thinkingEnabled: false,
          thinkingEffort: "none",
          approvalMode: "manual",
          sandboxMode: "workspace_write",
        },
        messages: [{ role: "user", content: "Read the repository." }],
        workspacePath: "/tmp",
        stableCachePreludeSnapshot: { identitySections: {} },
        toolExecutors: executors,
        requestApproval: async () => ({ decision: "approved" }),
      })) {
        // Drain until the typed truncation error is raised.
      }
    }

    await expect(run()).rejects.toMatchObject({ code: "model_tool_call_truncated" })
    expect(readExecutions).toBe(0)
  })

  it("rejects a cut-off final object instead of accepting a partial answer", async () => {
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream() {
        yield { type: "model.answer.delta", text: '{"finalAnswer":"unfinished' }
        yield { type: "model.completed", finishReason: "max_output_tokens" }
      },
    }
    const run = async () => {
      for await (const _event of new SocratesAgent(provider).streamTurn({
        completionMode: "main_structured",
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        runtimeConfig: {
          providerId: "openai",
          modelId: "gpt-5.4-mini",
          thinkingEnabled: false,
          thinkingEffort: "none",
          approvalMode: "manual",
          sandboxMode: "read_only",
        },
        messages: [{ role: "user", content: "Answer exactly." }],
        stableCachePreludeSnapshot: { identitySections: {} },
      })) {
        // Drain until the typed truncation error is raised.
      }
    }

    await expect(run()).rejects.toMatchObject({ code: "model_output_truncated" })
  })

  it("completes a no-tool main turn in one foreground model call", async () => {
    const requests: Array<Parameters<ModelProvider["stream"]>[0]> = []
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        requests.push(request)
        yield { type: "model.answer.delta", text: finalJson("Direct answer.", "Answered without tools.") }
        yield { type: "model.completed", finishReason: "stop" }
      },
    }
    const events: SocratesAgentEvent[] = []
    for await (const event of new SocratesAgent(provider).streamTurn({
      completionMode: "main_structured",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "read_only",
      },
      messages: [{ role: "user", content: "Answer directly." }],
      stableCachePreludeSnapshot: { identitySections: {} },
    })) {
      events.push(event)
    }

    expect(requests).toHaveLength(1)
    expect(requests[0]?.tools).toEqual([])
    if (socratesMainAgentDefinition.completion.mode === "text") throw new Error("Main Socrates must have structured completion.")
    expect(requests[0]?.structuredOutputSchema).toBe(socratesMainAgentDefinition.completion.schema)
    expect(events).toContainEqual({
      type: "agent.final_result",
      result: {
        finalAnswer: "Direct answer.",
        goalFinalization: { state: "completed", note: "Answered without tools." },
      },
    })
  })

  it("rejects dynamic tools outside the main role manifest before model execution", async () => {
    let providerCalled = false
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream() {
        providerCalled = true
        yield { type: "model.completed" }
      },
    }
    const run = async () => {
      for await (const _event of new SocratesAgent(provider).streamTurn({
        completionMode: "worker_text",
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        runtimeConfig: {
          providerId: "openai",
          modelId: "gpt-5.4-mini",
          thinkingEnabled: false,
          thinkingEffort: "none",
          approvalMode: "manual",
          sandboxMode: "read_only",
        },
        messages: [{ role: "user", content: "Hi" }],
        runtimeCapabilities: [{
          id: "shadow.tool",
          kind: "dynamic_tool",
          name: "mcp__shadow__tool",
          description: "This must not be exposed.",
          inputSchema: z.object({}).strict(),
          resultSchema: z.unknown(),
          providerInputSchema: { type: "object", properties: {}, additionalProperties: false },
          source: { type: "mcp", serverId: "shadow", childName: "tool", scope: "project" },
        }],
      })) {
        // The manifest violation must fail before the provider can emit an event.
      }
    }

    await expect(run()).rejects.toMatchObject({ code: "agent_role_manifest_mismatch" })
    expect(providerCalled).toBe(false)
  })

  it("does not invoke another model phase after the goal is already resolved", async () => {
    const structuredRequests: Array<Parameters<NonNullable<ModelProvider["generateStructured"]>>[0]> = []
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async generateStructured(request) {
        structuredRequests.push(request)
        throw new Error("No structured phase should run for a worker-text turn.")
      },
      async *stream() {
        yield { type: "model.answer.delta", text: "The report update is ready." }
        yield { type: "model.completed" }
      },
    }

    const agent = new SocratesAgent(provider)
    for await (const _event of agent.streamTurn({
      completionMode: "worker_text",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "deepseek",
      modelId: "deepseek-v4-pro",
      runtimeConfig: {
        providerId: "deepseek",
        authMode: "api_key",
        modelId: "deepseek-v4-pro",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "read_only",
      },
      messages: [{ role: "user", content: "Could you check where the AIDPA report stands?" }],
      workspacePath: "/tmp",
      stableCachePreludeSnapshot: { identitySections: {} },
      toolExecutors: emptyToolExecutors(),
      requestApproval: async () => ({ decision: "approved" }),
      activeGoal: { goalId: "v2goal_1", title: "Review AIDPA report status", state: "foreground", note: "Review the report." },
    })) {
      // Drain the turn.
    }

    expect(structuredRequests).toEqual([])
  })

  it("hands the full current task one way to Frontier and suppresses the driver's provisional answer", async () => {
    const requests: Array<Parameters<ModelProvider["stream"]>[0]> = []
    let handedOver = false
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        requests.push(request)
        const toolNames = request.tools?.map((tool) => tool.name) ?? []
        if (!handedOver && toolNames.includes("handover_to_frontier")) {
          handedOver = true
          yield { type: "model.answer.delta", text: "Driver draft that must not leak." }
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "provider_handover_1",
              toolName: "handover_to_frontier",
              input: { focus: "Resolve the conflicting lifecycle evidence" },
            },
          }
          yield { type: "model.completed" }
          return
        }
        yield { type: "model.answer.delta", text: finalJson("Frontier completed the task.", "Resolved the lifecycle evidence.") }
        yield { type: "model.completed" }
      },
    }
    const modelCalls: Array<{ providerId: string; modelId: string }> = []
    const streamed: SocratesAgentEvent[] = []
    const agent = new SocratesAgent(provider)
    for await (const event of agent.streamTurn({
      completionMode: "main_structured",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openrouter",
      modelId: "deepseek/deepseek-v4-flash",
      runtimeConfig: {
        providerId: "openrouter",
        authMode: "api_key",
        modelId: "deepseek/deepseek-v4-flash",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      frontierModelSettings: {
        providerId: "openrouter",
        authMode: "api_key",
        modelId: "x-ai/grok-4.5",
        thinkingEnabled: true,
        thinkingEffort: "low",
      },
      messages: [{ role: "user", content: "Resolve this difficult lifecycle problem using the evidence you gather." }],
      workspacePath: "/tmp",
      stableCachePreludeSnapshot: { identitySections: {} },
      toolExecutors: emptyToolExecutors(),
      requestApproval: async () => ({ decision: "approved" }),
      createModelCall: (request) => {
        modelCalls.push({ providerId: request.providerId, modelId: request.modelId })
        return `mcall_${modelCalls.length}`
      },
    })) {
      streamed.push(event)
    }

    expect(modelCalls).toEqual([
      { providerId: "openrouter", modelId: "deepseek/deepseek-v4-flash" },
      { providerId: "openrouter", modelId: "x-ai/grok-4.5" },
    ])
    const driverRequest = requests.find((request) => request.tools?.some((tool) => tool.name === "handover_to_frontier"))
    const frontierRequests = requests.filter((request) => request.modelId === "x-ai/grok-4.5")
    expect(driverRequest?.tools?.map((tool) => tool.name)).toContain("handover_to_frontier")
    expect(frontierRequests).toHaveLength(1)
    expect(frontierRequests.every((request) => !request.tools?.some((tool) => tool.name === "handover_to_frontier"))).toBe(true)
    expect(frontierRequests[0]?.messages.slice(0, driverRequest?.messages.length)).toEqual(driverRequest?.messages)
    expect(JSON.stringify(frontierRequests[0]?.messages)).toContain("Resolve this difficult lifecycle problem")
    expect(JSON.stringify(frontierRequests[0]?.messages)).toContain("handover_to_frontier")
    expect(JSON.stringify(frontierRequests[0]?.messages)).toContain("Resolve the conflicting lifecycle evidence")
    expect(JSON.stringify(frontierRequests[0]?.messages)).toContain("exact current model-visible context")
    expect(streamed.filter((event) => event.type === "model.answer.delta")).toHaveLength(0)
    expect(streamed).toContainEqual({
      type: "agent.final_result",
      result: {
        finalAnswer: "Frontier completed the task.",
        goalFinalization: { state: "completed", note: "Resolved the lifecycle evidence." },
      },
    })
    expect(streamed).toContainEqual({
      type: "approval.requested",
      request: expect.objectContaining({
        toolName: "handover_to_frontier",
        title: "Call Frontier model",
        description: expect.stringContaining("x-ai/grok-4.5 through openrouter"),
        actionPreview: "Focus: Resolve the conflicting lifecycle evidence",
        risk: "medium",
      }),
    })
    expect(streamed).toContainEqual({
      type: "tool.call.started",
      toolCallId: expect.stringMatching(/^tcall_/),
      providerToolCallId: "provider_handover_1",
      toolName: "handover_to_frontier",
      category: "other",
      displayName: "Calling Frontier model",
      argsPreview: expect.any(String),
      input: { focus: "Resolve the conflicting lifecycle evidence" },
      requiresApproval: true,
      modelCallId: "mcall_1",
      stepIndex: 0,
    })
    expect(streamed).toContainEqual({
      type: "agent.handover",
      toolCallId: expect.stringMatching(/^tcall_/),
      stepIndex: 0,
      fromProviderId: "openrouter",
      fromModelId: "deepseek/deepseek-v4-flash",
      toProviderId: "openrouter",
      toModelId: "x-ai/grok-4.5",
      focus: "Resolve the conflicting lifecycle evidence",
    })
  })

  it("returns a rejected Frontier request to Socrates and removes the handover tool for the rest of the turn", async () => {
    const requests: Array<Parameters<ModelProvider["stream"]>[0]> = []
    let requestedHandover = false
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        requests.push(request)
        const toolNames = request.tools?.map((tool) => tool.name) ?? []
        if (!requestedHandover && toolNames.includes("handover_to_frontier")) {
          requestedHandover = true
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "provider_handover_rejected",
              toolName: "handover_to_frontier",
              input: { focus: "Resolve the remaining invariant" },
            },
          }
          yield { type: "model.completed" }
          return
        }
        yield { type: "model.answer.delta", text: finalJson("Socrates completed the task after the declined handover.", "Resolved without Frontier.") }
        yield { type: "model.completed" }
      },
    }
    const streamed: SocratesAgentEvent[] = []
    let approvalRequests = 0
    const agent = new SocratesAgent(provider)

    for await (const event of agent.streamTurn({
      completionMode: "main_structured",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openrouter",
      modelId: "deepseek/deepseek-v4-flash",
      runtimeConfig: {
        providerId: "openrouter",
        authMode: "api_key",
        modelId: "deepseek/deepseek-v4-flash",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "approve_all",
        sandboxMode: "danger_full_access",
      },
      frontierModelSettings: {
        providerId: "openrouter",
        authMode: "api_key",
        modelId: "x-ai/grok-4.5",
        thinkingEnabled: true,
        thinkingEffort: "low",
      },
      messages: [{ role: "user", content: "Resolve the lifecycle invariant and give me the result." }],
      workspacePath: "/tmp",
      stableCachePreludeSnapshot: { identitySections: {} },
      toolExecutors: emptyToolExecutors(),
      requestApproval: async () => {
        approvalRequests += 1
        return { decision: "rejected", reason: "Keep this turn on Socrates." }
      },
    })) {
      streamed.push(event)
    }

    expect(approvalRequests).toBe(1)
    expect(streamed.filter((event) => event.type === "approval.requested")).toHaveLength(1)
    expect(streamed.some((event) => event.type === "agent.handover")).toBe(false)
    expect(streamed).toContainEqual(
      expect.objectContaining({
        type: "tool.call.failed",
        toolName: "handover_to_frontier",
        error: expect.objectContaining({ code: "tool_approval_rejected" }),
      }),
    )
    const handoverRequestIndex = requests.findIndex((request) =>
      request.tools?.some((tool) => tool.name === "handover_to_frontier"),
    )
    const postRejectionRequests = requests.slice(handoverRequestIndex + 1)
    expect(postRejectionRequests.length).toBeGreaterThan(0)
    expect(postRejectionRequests.some((request) => JSON.stringify(request.messages).includes("tool_approval_rejected"))).toBe(true)
    expect(postRejectionRequests.some((request) => JSON.stringify(request.messages).includes("Keep this turn on Socrates."))).toBe(true)
    expect(postRejectionRequests.every((request) => !request.tools?.some((tool) => tool.name === "handover_to_frontier"))).toBe(true)
    expect(streamed.filter((event) => event.type === "model.answer.delta")).toHaveLength(0)
    expect(streamed).toContainEqual({
      type: "agent.final_result",
      result: {
        finalAnswer: "Socrates completed the task after the declined handover.",
        goalFinalization: { state: "completed", note: "Resolved without Frontier." },
      },
    })
  })

  it("preserves answer-before-completion ordering when Frontier is available but unused", async () => {
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream() {
        yield { type: "model.answer.delta", text: "Ordinary streamed answer." }
        yield { type: "model.completed" }
      },
    }
    const agent = new SocratesAgent(provider)
    const streamed: SocratesAgentEvent[] = []

    for await (const event of agent.streamTurn({
      completionMode: "worker_text",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openrouter",
      modelId: "deepseek/deepseek-v4-flash",
      runtimeConfig: {
        providerId: "openrouter",
        authMode: "api_key",
        modelId: "deepseek/deepseek-v4-flash",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      frontierModelSettings: {
        providerId: "openrouter",
        authMode: "api_key",
        modelId: "x-ai/grok-4.5",
        thinkingEnabled: true,
        thinkingEffort: "low",
      },
      messages: [{ role: "user", content: "Give an ordinary answer." }],
      workspacePath: "/tmp",
      stableCachePreludeSnapshot: { identitySections: {} },
      toolExecutors: emptyToolExecutors(),
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      streamed.push(event)
    }

    const answerIndex = streamed.findIndex((event) => event.type === "model.answer.delta")
    const completedIndex = streamed.findIndex((event) => event.type === "model.completed")
    expect(answerIndex).toBeGreaterThanOrEqual(0)
    expect(completedIndex).toBeGreaterThan(answerIndex)
  })

  it("loads the stable Socrates prelude even when structured memory routing is unavailable", async () => {
    const requests: Array<{ messages: ModelMessage[] }> = []
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        requests.push(request)
        yield { type: "model.answer.delta", text: "Ready." }
        yield { type: "model.completed" }
      },
    }
    const executors = emptyToolExecutors()
    executors.read = async (input) => {
      const sectionId = String(input.path).split("/").at(-1) ?? "core_identity"
      const content = sectionId === "core_identity" ? "Calm, exact, and collaborative." : "Warm and direct."
      return governedResourceOutput(input.path, content)
    }

    const agent = new SocratesAgent(provider)
    for await (const _event of agent.streamTurn({
      completionMode: "worker_text",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "read_only",
      },
      messages: [{ role: "user", content: "Hi" }],
      workspacePath: "/tmp",
      toolExecutors: executors,
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      // Drain the turn.
    }

    const firstMessages = requests[0]?.messages ?? []
    expect(firstMessages[0]).toMatchObject({ role: "developer" })
    expect(String(firstMessages[0]?.content)).toContain("socrates_stable_cache_prelude")
    expect(String(firstMessages[0]?.content)).toContain("Calm, exact, and collaborative.")
    expect(String(firstMessages[0]?.content)).toContain("socrates_surface_map")
    expect(firstMessages[1]).toMatchObject({ role: "user", content: "Hi" })
  })

  it("uses a backend stable snapshot without emitting standing or routed reads", async () => {
    const requests: Array<{ messages: ModelMessage[] }> = []
    const readInputs: unknown[] = []
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        requests.push(request)
        yield { type: "model.answer.delta", text: "Ready." }
        yield { type: "model.completed" }
      },
    }
    const executors = emptyToolExecutors()
    executors.read = async (input) => {
      readInputs.push(input)
      return governedResourceOutput(input.path, "- Dynamic note.")
    }

    const events: SocratesAgentEvent[] = []
    const agent = new SocratesAgent(provider)
    for await (const event of agent.streamTurn({
      completionMode: "worker_text",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "read_only",
      },
      messages: [{ role: "user", content: "Continue the project." }],
      workspacePath: "/tmp",
      toolExecutors: executors,
      requestApproval: async () => ({ decision: "approved" }),
      stableCachePreludeSnapshot: {
        projectRules: "- Project standing rule.",
        globalRules: "- Global standing rule.",
        identitySections: {
          core_identity: "Calm and exact.",
          voice_and_presence: "Warm and direct.",
          relationship_to_user: "Collaborative.",
        },
        cacheHit: true,
      },
    })) {
      events.push(event)
    }

    expect(readInputs).toEqual([])
    expect(events.filter((event) => event.type === "tool.call.started")).toEqual([])
    const messages = requests.find((request) => JSON.stringify(request.messages).includes("socrates_stable_cache_prelude"))?.messages ?? []
    const serializedMessages = JSON.stringify(messages)
    expect(serializedMessages).toContain("Project standing rule")
    expect(serializedMessages).toContain("Global standing rule")
    expect(serializedMessages.indexOf("socrates_stable_cache_prelude")).toBeLessThan(serializedMessages.indexOf("Continue the project."))
  })

  it("keeps the full stable prelude byte-identical across dynamic context changes and changes it with identity", async () => {
    let identityCore = "Identity version one."
    const capturePrelude = async (userName: string, projectName: string): Promise<string> => {
      const requests: Array<{ messages: ModelMessage[] }> = []
      const provider: ModelProvider = {
        countTokens: fakeCountTokens,
        async *stream(request) {
          requests.push(request)
          yield { type: "model.answer.delta", text: "Ready." }
          yield { type: "model.completed" }
        },
      }
      const executors = emptyToolExecutors()
      executors.read = async (input) => {
        const sectionId = String(input.path).split("/").at(-1)
        const content = sectionId === "core_identity" ? identityCore : "Stable voice section."
        return governedResourceOutput(input.path, content)
      }
      const agent = new SocratesAgent(provider)
      for await (const _event of agent.streamTurn({
      completionMode: "worker_text",
        projectId: "proj_1",
        conversationId: "conv_1",
        sessionId: "sess_1",
        turnId: "turn_1",
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        runtimeConfig: {
          providerId: "openai",
          modelId: "gpt-5.4-mini",
          thinkingEnabled: false,
          thinkingEffort: "none",
          approvalMode: "manual",
          sandboxMode: "read_only",
        },
        promptContext: { userDisplayName: userName, projectName, projectDescription: `Dynamic ${projectName}` },
        messages: [{ role: "user", content: `Dynamic request for ${projectName}` }],
        workspacePath: "/tmp",
        toolExecutors: executors,
        requestApproval: async () => ({ decision: "approved" }),
      })) {
        // Drain the turn.
      }
      return String(requests[0]?.messages.find((message) => message.role === "developer" && String(message.content).includes("socrates_stable_cache_prelude"))?.content)
    }

    const first = await capturePrelude("Ayush", "Alpha")
    const dynamicChange = await capturePrelude("Different User", "Beta")
    expect(dynamicChange).toBe(first)
    identityCore = "Identity version two."
    const identityChange = await capturePrelude("Different User", "Beta")
    expect(identityChange).not.toBe(first)
    expect(identityChange).toContain("Identity version two.")
  })

  it("exposes the base tool set", () => {
    const tools = capabilityCatalog.resolve(socratesMainAgentDefinition.roleManifest).modelDefinitions()
    expect(tools.map((tool) => tool.name)).toEqual([
      "read",
      "search",
      "url_fetch",
      "edit",
      "apply_patch",
      "bash",
      "wait",
      "handover_to_frontier",
      "current_time",
      "trace_retrieve",
      "capability_manager",
      "memory_note",
      "context_disposition",
    ])
    expect(tools.map((tool) => tool.name).some((name) => name.startsWith("mcp__playwright__"))).toBe(false)
    expect(tools.find((tool) => tool.name === "capability_manager")?.description).toContain("skills and MCP")
    expect(tools.find((tool) => tool.name === "memory_note")?.description).toContain("Memory Agent")
    expect(tools.find((tool) => tool.name === "memory_note")?.description).toContain("not to remember")
    expect(tools.find((tool) => tool.name === "edit")?.inputSchema.safeParse({ path: "README.md", content: "new" }).success).toBe(true)
    expect(
      tools
        .find((tool) => tool.name === "edit")
        ?.inputSchema.safeParse({ path: "README.md", content: "new", oldString: "old", newString: "new" }).success,
    ).toBe(false)
  })

  it("always requires explicit approval for Frontier handover, including full-access mode", async () => {
    const policy = await frontierHandoverTool.decidePolicy(
      { focus: "Resolve the remaining invariant" },
      {
        runtimeConfig: {
          providerId: "openrouter",
          modelId: "deepseek/deepseek-v4-flash",
          thinkingEnabled: false,
          thinkingEffort: "none",
          approvalMode: "approve_all",
          sandboxMode: "danger_full_access",
        },
        frontierModel: { providerId: "openrouter", modelId: "x-ai/grok-4.5" },
      } as Parameters<typeof frontierHandoverTool.decidePolicy>[1],
    )

    expect(policy).toEqual({
      type: "approval_required",
      request: {
        actionKind: "other",
        title: "Call Frontier model",
        description: expect.stringContaining("x-ai/grok-4.5 through openrouter"),
        actionPreview: "Focus: Resolve the remaining invariant",
        risk: "medium",
      },
    })
  })

  it("ends the model turn immediately when wait registers a durable suspension", async () => {
    let calls = 0
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream() {
        calls += 1
        yield {
          type: "model.tool_call.completed",
          toolCall: {
            toolCallId: "tcall_wait",
            toolName: "wait",
            input: { terminalNames: ["integration-tests"], wakeOn: ["completed", "failed"], reason: "Waiting for integration test results" },
          },
        }
        yield { type: "model.completed", finishReason: "tool-calls" }
      },
    }
    const executors = emptyToolExecutors()
    executors.wait = async (input) => ({
      status: "waiting",
      terminalNames: input.terminalNames,
      wakeOn: input.wakeOn,
      reason: input.reason,
      message: "Task suspended until a requested Terminal event occurs.",
    })
    const agent = new SocratesAgent(provider)
    const events: SocratesAgentEvent[] = []
    for await (const event of agent.streamTurn({
      completionMode: "worker_text",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: { providerId: "openai", modelId: "gpt-5.4-mini", thinkingEnabled: false, thinkingEffort: "none", approvalMode: "manual", sandboxMode: "workspace_write" },
      messages: [{ role: "user", content: "Run the tests." }],
      workspacePath: "/tmp",
      toolExecutors: executors,
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      events.push(event)
    }
    expect(calls).toBe(1)
    expect(events.some((event) => event.type === "agent.suspended")).toBe(true)
    expect(events.some((event) => event.type === "model.answer.delta")).toBe(false)
  })

  it("keeps OpenRouter routed-provider affinity for later calls in the same turn", async () => {
    const seen: Parameters<ModelProvider["stream"]>[0][] = []
    let calls = 0
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        seen.push(request)
        calls += 1
        if (calls === 1) {
          yield {
            type: "model.tool_call.completed",
            toolCall: { toolCallId: "call_1", toolName: "read", input: { path: "README.md" } },
          }
          yield { type: "model.usage", usage: { routedProvider: "DeepInfra" } }
          yield { type: "model.completed", finishReason: "tool-calls", usage: { routedProvider: "DeepInfra" } }
          return
        }
        yield { type: "model.answer.delta", text: "done" }
        yield { type: "model.completed" }
      },
    }

    const agent = new SocratesAgent(provider)
    for await (const _event of agent.streamTurn({
      completionMode: "worker_text",
      providerId: "openrouter",
      modelId: "deepseek/deepseek-v4-pro",
      sessionId: "sess_1",
      cacheKey: "project:proj_1:conversation:conv_1",
      workspacePath: "/tmp",
      runtimeConfig: {
        providerId: "openrouter",
        modelId: "deepseek/deepseek-v4-pro",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "read_only",
      },
      messages: [{ role: "user", content: "Read the README." }],
      toolExecutors: emptyToolExecutors(),
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      // Drain the turn.
    }

    expect(seen).toHaveLength(2)
    expect(seen[0]?.providerRouting).toBeUndefined()
    expect(seen[1]?.providerRouting).toEqual({ preferredOpenRouterProvider: "DeepInfra" })
  })

  it("streams blocking compaction start before the compressor finishes and model call begins", async () => {
    let releaseCompressor: (() => void) | undefined
    const compressorReleased = new Promise<void>((resolve) => {
      releaseCompressor = resolve
    })
    let countCalls = 0
    let appModelStarted = false
    const provider: ModelProvider = {
      countTokens: async (request) => {
        countCalls += 1
        const inputTokens = countCalls === 1 ? 20 : 5
        return {
          providerId: request.providerId,
          modelId: request.modelId,
          inputTokens,
          baseTokens: inputTokens,
          method: "local_tiktoken",
          safetyMarginPercent: 0,
        }
      },
      async generateStructured(request) {
        expect(request.modelId).toBe("deepseek/deepseek-v4-flash")
        await compressorReleased
        return {
          output: validCompressorSummary() as never,
          usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        }
      },
      async *stream(request) {
        appModelStarted = true
        yield { type: "model.completed" }
      },
    }

    const agent = new SocratesAgent(provider)
    const iterator = agent
      .streamTurn({
      completionMode: "worker_text",
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        runtimeConfig: {
          providerId: "openai",
          modelId: "gpt-5.4-mini",
          thinkingEnabled: false,
          thinkingEffort: "none",
          approvalMode: "manual",
          sandboxMode: "read_only",
        },
        messages: [
          { role: "user", content: "Old history", id: "msg_1", turnId: "turn_1" },
          { role: "assistant", content: "Old answer", id: "msg_2", turnId: "turn_1" },
          { role: "user", content: "Current request", id: "msg_3", turnId: "turn_2" },
        ],
        contextCompression: {
          enabled: true,
          thresholds: { triggerTokens: 10, recentTailTargetTokens: 1 },
        },
      })
      [Symbol.asyncIterator]()

    const first = await iterator.next()
    expect(first.value?.type).toBe("context.compaction.started")
    expect(appModelStarted).toBe(false)

    releaseCompressor?.()

    const events: SocratesAgentEvent[] = [first.value as SocratesAgentEvent]
    for (;;) {
      const next = await iterator.next()
      if (next.done) {
        break
      }
      events.push(next.value)
    }

    const eventTypes = events.map((event) => event.type)
    expect(eventTypes).toEqual(["context.compaction.started", "context.compaction.completed", "model.completed"])
    expect(appModelStarted).toBe(true)
  })

  it("executes current-turn tool calls and feeds results into a final model step", async () => {
    const seenMessages: unknown[] = []
    const countRequests: CountedRequest[] = []
    let calls = 0
    const provider: ModelProvider = {
      countTokens: async (request) => {
        countRequests.push(snapshotCountRequest(request))
        return fakeCountTokens(request)
      },
      async *stream(request) {
        seenMessages.push(request.messages)
        calls += 1
        if (calls === 1) {
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_project_notes_once",
              toolName: "read",
              input: { path: "socrates://project/notes" },
            },
          }
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_project_notes_1",
              toolName: "read",
              input: { path: "socrates://project/notes" },
            },
          }
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_read_1",
              toolName: "read",
              input: { path: "README.md" },
              providerMetadata: { google: { thoughtSignature: "sig_1" } },
            },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: "Read it." }
        yield { type: "model.completed" }
      },
    }

    const executors = emptyToolExecutors()
    executors.read = async (input) => input.path === "README.md"
      ? { path: "README.md", kind: "file", content: "Socrates", truncation: { truncated: false, charLimit: 20_000, returnedLength: 8 } }
      : governedResourceOutput(input.path, "")

    const streamed: SocratesAgentEvent[] = []
    const agent = new SocratesAgent(provider)
    for await (const event of agent.streamTurn({
      completionMode: "worker_text",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      messages: [{ role: "user", content: "Read README" }],
      workspacePath: "/tmp",
      toolExecutors: executors,
      createModelCall: () => `mcall_${calls}`,
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      streamed.push(event)
    }

    expect(streamed.some((event) => event.type === "tool.call.completed")).toBe(true)
    expect(streamed.some((event) => event.type === "model.answer.delta")).toBe(true)
    expect(countRequests).toHaveLength(2)
    expect(countRequests[0]?.toolCount).toBe(12)
    expect(countRequests[1]?.toolCount).toBe(12)
    expect(JSON.stringify(countRequests[0]?.messages)).not.toContain("tool-result")
    expect(JSON.stringify(countRequests[1]?.messages)).toContain("tool-result")
    expect(JSON.stringify(seenMessages.at(-1))).toContain("tool-result")
    expect(JSON.stringify(seenMessages.at(-1))).toContain("thoughtSignature")
  })

  it("feeds governed resource content into the next model request", async () => {
    const requests: unknown[] = []
    let calls = 0
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        requests.push(JSON.parse(JSON.stringify(request.messages)) as unknown)
        calls += 1
        if (calls === 1) {
          yield {
            type: "model.tool_call.completed",
            toolCall: { toolCallId: "repo_index", toolName: "read", input: { path: "socrates://project/repo-docs" } },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: "Done." }
        yield { type: "model.completed" }
      },
    }
    const executors = emptyToolExecutors()
    executors.read = async (input) => governedResourceOutput(input.path, "VISIBLE_REPO_DOC_CONTENT")

    const agent = new SocratesAgent(provider)
    for await (const _event of agent.streamTurn({
      completionMode: "worker_text",
      providerId: "deepseek",
      modelId: "deepseek-v4-pro",
      runtimeConfig: {
        providerId: "deepseek",
        authMode: "api_key",
        modelId: "deepseek-v4-pro",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "read_only",
      },
      messages: [{ role: "user", content: "Read the repository index." }],
      workspacePath: "/tmp",
      toolExecutors: executors,
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      // Drain the turn.
    }

    expect(requests).toHaveLength(2)
    expect(JSON.stringify(requests[1])).toContain("VISIBLE_REPO_DOC_CONTENT")
  })

  it("piggybacks release-only tool-output control on the next functional tool call", async () => {
    const requests: Array<{ messages: unknown; tools: string[] }> = []
    let calls = 0
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        requests.push({
          messages: JSON.parse(JSON.stringify(request.messages)) as unknown,
          tools: request.tools?.map((tool) => tool.name) ?? [],
        })
        calls += 1
        if (calls === 1) {
          yield {
            type: "model.tool_call.completed",
            toolCall: { toolCallId: "read_large", toolName: "read", input: { path: "report.txt" } },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        if (calls === 2) {
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "dispose_large",
              toolName: "context_disposition",
              input: { release: ["R1"] },
            },
          }
          yield {
            type: "model.tool_call.completed",
            toolCall: { toolCallId: "get_time", toolName: "current_time", input: {} },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: "Done." }
        yield { type: "model.completed" }
      },
    }
    const executors = emptyToolExecutors()
    executors.read = async () => ({
      path: "report.txt",
      kind: "file",
      content: `UNIQUE_LARGE_REPORT_MARKER ${"substantial evidence ".repeat(2_000)}`,
      truncation: { truncated: false, charLimit: 100_000, returnedLength: 42_000 },
    })

    const completedTools: string[] = []
    const agent = new SocratesAgent(provider)
    for await (const event of agent.streamTurn({
      completionMode: "worker_text",
      providerId: "deepseek",
      modelId: "deepseek-v4-pro",
      runtimeConfig: {
        providerId: "deepseek",
        authMode: "api_key",
        modelId: "deepseek-v4-pro",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "read_only",
      },
      messages: [{ role: "user", content: "Read the report, check the date, then summarize it." }],
      workspacePath: "/tmp",
      toolExecutors: executors,
      requestApproval: async () => ({ decision: "approved" }),
      maxToolCallsPerTurn: 2,
    })) {
      if (event.type === "tool.call.completed") completedTools.push(event.toolName)
    }

    expect(requests).toHaveLength(3)
    expect(requests[0]?.tools).toContain("context_disposition")
    expect(JSON.stringify(requests[1]?.messages)).toContain("UNIQUE_LARGE_REPORT_MARKER")
    expect(JSON.stringify(requests[1]?.messages)).toContain("Large temporary result R1")
    expect(JSON.stringify(requests[2]?.messages)).not.toContain("UNIQUE_LARGE_REPORT_MARKER")
    expect(JSON.stringify(requests[2]?.messages)).toContain('"contextDisposition":"released"')
    expect(completedTools[0]).toBe("read")
    expect(new Set(completedTools.slice(1))).toEqual(new Set(["context_disposition", "current_time"]))
  })

  it("never blocks a normal functional call when a large-result release is omitted", async () => {
    const requests: Array<{ messages: unknown }> = []
    let calls = 0
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        requests.push({ messages: JSON.parse(JSON.stringify(request.messages)) as unknown })
        calls += 1
        if (calls === 1) {
          yield {
            type: "model.tool_call.completed",
            toolCall: { toolCallId: "read_large", toolName: "read", input: { path: "report.txt" } },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        if (calls === 2) {
          yield {
            type: "model.tool_call.completed",
            toolCall: { toolCallId: "unclassified_time", toolName: "current_time", input: {} },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: "Done." }
        yield { type: "model.completed" }
      },
    }
    const executors = emptyToolExecutors()
    executors.read = async () => ({
      path: "report.txt",
      kind: "file",
      content: `UNIQUE_RETRY_REPORT_MARKER ${"substantial evidence ".repeat(2_000)}`,
      truncation: { truncated: false, charLimit: 100_000, returnedLength: 42_000 },
    })

    const completedTools: string[] = []
    const agent = new SocratesAgent(provider)
    for await (const event of agent.streamTurn({
      completionMode: "worker_text",
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      runtimeConfig: {
        providerId: "deepseek",
        authMode: "api_key",
        modelId: "deepseek-v4-flash",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "read_only",
      },
      messages: [{ role: "user", content: "Read the report, check the date, then summarize it." }],
      workspacePath: "/tmp",
      toolExecutors: executors,
      requestApproval: async () => ({ decision: "approved" }),
      maxToolCallsPerTurn: 2,
    })) {
      if (event.type === "tool.call.completed") completedTools.push(event.toolName)
    }

    expect(requests).toHaveLength(3)
    expect(JSON.stringify(requests[1]?.messages)).toContain("Large temporary result R1")
    expect(JSON.stringify(requests[2]?.messages)).toContain("UNIQUE_RETRY_REPORT_MARKER")
    expect(JSON.stringify(requests[2]?.messages)).not.toContain("were not executed")
    expect(completedTools[0]).toBe("read")
    expect(new Set(completedTools.slice(1))).toEqual(new Set(["current_time"]))
    expect(completedTools.filter((toolName) => toolName === "current_time")).toHaveLength(1)
  })

  it("does not inject a disposition call after repeated omissions", async () => {
    let calls = 0
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream() {
        calls += 1
        if (calls === 1) {
          yield {
            type: "model.tool_call.completed",
            toolCall: { toolCallId: "read_large", toolName: "read", input: { path: "report.txt" } },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        if (calls === 2) {
          yield {
            type: "model.tool_call.completed",
            toolCall: { toolCallId: `ignored_time_${calls}`, toolName: "current_time", input: {} },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: "Done." }
        yield { type: "model.completed" }
      },
    }
    const executors = emptyToolExecutors()
    executors.read = async () => ({
      path: "report.txt",
      kind: "file",
      content: `SAFE_FALLBACK_REPORT_MARKER ${"substantial evidence ".repeat(2_000)}`,
      truncation: { truncated: false, charLimit: 100_000, returnedLength: 42_000 },
    })

    const completedTools: string[] = []
    const agent = new SocratesAgent(provider)
    for await (const event of agent.streamTurn({
      completionMode: "worker_text",
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      runtimeConfig: {
        providerId: "deepseek",
        authMode: "api_key",
        modelId: "deepseek-v4-flash",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "read_only",
      },
      messages: [{ role: "user", content: "Read the report, check the date, then summarize it." }],
      workspacePath: "/tmp",
      toolExecutors: executors,
      requestApproval: async () => ({ decision: "approved" }),
      maxToolCallsPerTurn: 2,
    })) {
      if (event.type === "tool.call.completed") completedTools.push(event.toolName)
    }

    expect(calls).toBe(3)
    expect(completedTools[0]).toBe("read")
    expect(new Set(completedTools.slice(1))).toEqual(new Set(["current_time"]))
    expect(completedTools.filter((toolName) => toolName === "current_time")).toHaveLength(1)
    expect(completedTools).not.toContain("context_disposition")
  })

  it("continues from the exact memory_note result without a shadow ledger", async () => {
    const streamRequests: Array<{ system: string; messages: unknown }> = []
    let calls = 0
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        streamRequests.push({ system: request.system, messages: JSON.parse(JSON.stringify(request.messages)) as unknown })
        calls += 1
        if (calls === 1) {
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_memory_note",
              toolName: "memory_note",
              input: { note: "User explicitly prefers implementation only after approval.", importance: "high" },
            },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: "Noted." }
        yield { type: "model.completed" }
      },
    }
    const executors = emptyToolExecutors()
    executors.memory_note = async () => ({
      noteNumber: 1,
      status: "open",
      attachedSource: "current_user_message",
      result: "created",
    })

    const agent = new SocratesAgent(provider)
    for await (const _event of agent.streamTurn({
      completionMode: "worker_text",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      messages: [{ role: "user", content: "Please remember this implementation approval preference." }],
      workspacePath: "/tmp",
      toolExecutors: executors,
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      // Drain the turn.
    }

    expect(streamRequests).toHaveLength(2)
    expect(streamRequests[1]?.system).toBe(streamRequests[0]?.system)
    expect(streamRequests[0]?.system).not.toContain("socrates_memory_save_ledger")
    expect(JSON.stringify(streamRequests[0]?.messages)).not.toContain("socrates_memory_save_ledger")
    const followUp = JSON.stringify(streamRequests[1]?.messages)
    expect(followUp).not.toContain("socrates_memory_save_ledger")
    expect(followUp).toContain('"noteNumber":1')
    expect(followUp).toContain("implementation only after approval")
  })

  it("loads stable always-apply context without a model-driven memory router", async () => {
    const streamRequests: ModelRequestLike[] = []
    const readInputs: unknown[] = []
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        streamRequests.push(request)
        yield { type: "model.answer.delta", text: "Got it." }
        yield { type: "model.completed" }
      },
    }
    const executors = emptyToolExecutors()
    executors.read = async (input) => {
      readInputs.push(input)
      const content = input.path === "socrates://project/memory/always_apply_rules"
        ? "- Existing project rule."
        : input.path === "socrates://user/profile/global_always_apply_rules"
          ? "- Existing global rule."
          : "Stable identity section."
      return governedResourceOutput(input.path, content)
    }
    const streamed: SocratesAgentEvent[] = []
    const agent = new SocratesAgent(provider)
    for await (const event of agent.streamTurn({
      completionMode: "worker_text",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openrouter",
      modelId: "z-ai/glm-4.5",
      runtimeConfig: {
        providerId: "openrouter",
        modelId: "z-ai/glm-4.5",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      messages: [{ role: "user", content: "Remember this project boundary, then inspect the repo." }],
      workspacePath: "/tmp",
      toolExecutors: executors,
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      streamed.push(event)
    }

    expect(readInputs).toEqual([
      { path: "socrates://project/memory/always_apply_rules", charLimit: 10_000 },
      { path: "socrates://user/profile/global_always_apply_rules", charLimit: 10_000 },
      { path: "socrates://identity/core_identity", charLimit: 4_000 },
      { path: "socrates://identity/voice_and_presence", charLimit: 4_000 },
      { path: "socrates://identity/relationship_to_user", charLimit: 4_000 },
    ])
    const toolNames = streamed.filter((event) => event.type === "tool.call.started").map((event) => event.toolName)
    expect(toolNames).toEqual(["read", "read", "read", "read", "read"])
    const firstRequestMessages = streamRequests[0]?.messages ?? []
    const firstRequestJson = JSON.stringify(firstRequestMessages)
    const firstRequestText = stringMessageContents(firstRequestMessages).join("\n")
    expect(firstRequestMessages[0]).toMatchObject({ role: "developer" })
    expect(String(firstRequestMessages[0]?.content)).toContain("socrates_stable_cache_prelude")
    expect(String(firstRequestMessages[0]?.content)).toContain("Existing global rule")
    expect(String(firstRequestMessages[0]?.content)).toContain("identity_core")
    expect(String(firstRequestMessages[0]?.content)).toContain("socrates_surface_map")
    expect(String(firstRequestMessages[0]?.content)).toContain("Existing project rule")
    expect(firstRequestMessages[1]).toMatchObject({ role: "user", content: "Remember this project boundary, then inspect the repo." })
    expect(firstRequestText.indexOf("socrates_stable_cache_prelude")).toBeLessThan(
      firstRequestText.indexOf("Remember this project boundary"),
    )
    expect(firstRequestJson).not.toContain("memory_router")
  })

  it("reconciles and verifies project memory inside the same foreground loop", async () => {
    const streamRequests: ModelRequestLike[] = []
    const resourceInputs: Array<{ toolName: string; input: unknown }> = []
    let streamCalls = 0
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        streamRequests.push(request)
        streamCalls += 1
        if (streamCalls === 1) {
          yield {
            type: "model.tool_call.completed",
            toolCall: { toolCallId: "tcall_read_memory_loop", toolName: "read", input: { path: "README.md" } },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        if (streamCalls === 2) {
          yield { type: "model.tool_call.completed", toolCall: { toolCallId: "tcall_memory_read", toolName: "read", input: { path: "socrates://project/memory/durable_decisions", charLimit: 20_000 } } }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        if (streamCalls === 3) {
          yield { type: "model.tool_call.completed", toolCall: { toolCallId: "tcall_memory_patch", toolName: "edit", input: { path: "socrates://project/memory/durable_decisions", edits: [{ oldString: "- Existing durable decision.", newString: "- Verified README mentions the Socrates memory loop." }] } } }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        if (streamCalls === 4) {
          yield { type: "model.tool_call.completed", toolCall: { toolCallId: "tcall_memory_verify", toolName: "read", input: { path: "socrates://project/memory/durable_decisions", charLimit: 20_000 } } }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: finalJson("Verified and saved.", "Verified the memory-loop state.") }
        yield { type: "model.completed" }
      },
    }
    const executors = emptyToolExecutors()
    let durableDecision = "- Existing durable decision."
    executors.read = async (input) => {
      resourceInputs.push({ toolName: "read", input })
      if (input.path === "README.md") {
        return { path: "README.md", kind: "file", content: "Socrates memory loop", truncation: { truncated: false, charLimit: 20_000, returnedLength: 20 } }
      }
      const content = input.path.endsWith("/durable_decisions")
        ? durableDecision
        : input.path.endsWith("/always_apply_rules")
          ? "- Add at most 10 short project hard rules here."
          : ""
      return governedResourceOutput(input.path, content)
    }
    executors.edit = async (input) => {
      resourceInputs.push({ toolName: "edit", input })
      if ("edits" in input) durableDecision = input.edits[0]?.newString ?? durableDecision
      return { changedFiles: [{ path: input.path, operation: "edited" }], diff: durableDecision, dryRun: false, truncation: { truncated: false, charLimit: 20_000, returnedLength: durableDecision.length } }
    }

    const streamed: SocratesAgentEvent[] = []
    const agent = new SocratesAgent(provider)
    for await (const event of agent.streamTurn({
      completionMode: "main_structured",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      messages: [{ role: "user", content: "Check the README for memory-loop state." }],
      workspacePath: "/tmp",
      toolExecutors: executors,
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      streamed.push(event)
    }

    expect(resourceInputs).toContainEqual({ toolName: "edit", input: {
      path: "socrates://project/memory/durable_decisions",
      edits: [{ oldString: "- Existing durable decision.", newString: "- Verified README mentions the Socrates memory loop." }],
    } })
    const toolNames = streamed.filter((event) => event.type === "tool.call.started").map((event) => event.toolName)
    expect(toolNames).toEqual(["read", "read", "read", "read", "read", "read", "read", "edit", "read"])
    expect(streamRequests).toHaveLength(5)
    expect(JSON.stringify(streamRequests)).not.toContain("socrates_reconciliation_checkpoint")
    expect(JSON.stringify(streamRequests[4]?.messages)).toContain("Verified README mentions the Socrates memory loop")
    expect(streamed.filter((event) => event.type === "model.answer.delta")).toHaveLength(0)
    expect(streamed).toContainEqual({
      type: "agent.final_result",
      result: {
        finalAnswer: "Verified and saved.",
        goalFinalization: { state: "completed", note: "Verified the memory-loop state." },
      },
    })
  })

  it("keeps pre-turn routing read-only and skips final writes when no reconciliation is needed", async () => {
    const memoryNoteInputs: unknown[] = []
    const streamRequests: ModelRequestLike[] = []
    let streamCalls = 0
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        streamRequests.push(request)
        streamCalls += 1
        if (streamCalls === 1) {
          yield {
            type: "model.tool_call.completed",
            toolCall: { toolCallId: "tcall_read_workspace", toolName: "read", input: { path: "." } },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: finalJson("Done.", "Inspection completed without durable changes.") }
        yield { type: "model.completed" }
      },
    }
    const executors = emptyToolExecutors()
    executors.read = async () => ({ path: ".", kind: "directory", entries: [], truncation: { truncated: false, charLimit: 20_000, returnedLength: 0 } })
    executors.memory_note = async (input) => {
      memoryNoteInputs.push(input)
      return { noteNumber: 1, status: "open", attachedSource: "current_user_message", result: "created" }
    }

    const agent = new SocratesAgent(provider)
    for await (const _event of agent.streamTurn({
      completionMode: "main_structured",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "deepseek",
      modelId: "deepseek-v4-pro",
      runtimeConfig: {
        providerId: "deepseek",
        modelId: "deepseek-v4-pro",
        thinkingEnabled: true,
        thinkingEffort: "high",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      messages: [{ role: "user", content: "Inspect Deepplay and create one project note." }],
      workspacePath: "/tmp",
      toolExecutors: executors,
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      // Drain the turn.
    }

    expect(memoryNoteInputs).toHaveLength(0)
    expect(streamRequests).toHaveLength(2)
    expect(JSON.stringify(streamRequests)).not.toContain("socrates_reconciliation_checkpoint")
  })

  it("preserves OpenAI reasoning item metadata when continuing after tool calls", async () => {
    const seenMessages: unknown[] = []
    let calls = 0
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        seenMessages.push(request.messages)
        calls += 1
        if (calls === 1) {
          yield {
            type: "model.reasoning.completed",
            text: "",
            providerMetadata: { openai: { itemId: "rs_1", reasoningEncryptedContent: null } },
          }
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "fc_1",
              toolName: "read",
              input: { path: "README.md" },
              providerMetadata: { openai: { itemId: "fc_item_1" } },
            },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: "Read it." }
        yield { type: "model.completed" }
      },
    }
    const executors = emptyToolExecutors()
    executors.read = async () => ({
      path: "README.md",
      kind: "file",
      content: "Socrates",
      truncation: { truncated: false, charLimit: 20_000, returnedLength: 8 },
    })

    const agent = new SocratesAgent(provider)
    for await (const _event of agent.streamTurn({
      completionMode: "worker_text",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: true,
        thinkingEffort: "low",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      messages: [{ role: "user", content: "Read README" }],
      workspacePath: "/tmp",
      toolExecutors: executors,
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      // Drain the turn.
    }

    const nextRequestMessages = seenMessages.at(-1) as Array<{ role: string; content: unknown }>
    const assistantMessage = nextRequestMessages.find(
      (message) =>
        message.role === "assistant" &&
        Array.isArray(message.content) &&
        message.content.some((part) => (part as { type?: string }).type === "tool-call"),
    ) as { role: string; content: Array<Record<string, unknown>> }

    expect(assistantMessage.content[0]).toEqual({
      type: "reasoning",
      text: "",
      providerMetadata: { openai: { itemId: "rs_1", reasoningEncryptedContent: null } },
    })
    expect(assistantMessage.content[1]).toMatchObject({
      type: "tool-call",
      toolCallId: "fc_1",
      toolName: "read",
      providerMetadata: { openai: { itemId: "fc_item_1" } },
    })
  })

  it("uses internal tool run ids while preserving repeated provider ids in model messages", async () => {
    const seenMessages: unknown[] = []
    let calls = 0
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        seenMessages.push(request.messages)
        calls += 1
        if (calls <= 2) {
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "functions.read:0",
              toolName: "read",
              input: { path: `file-${calls}.txt` },
            },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: "Done." }
        yield { type: "model.completed" }
      },
    }
    const executors = emptyToolExecutors()
    executors.read = async (input) => ({
      path: input.path,
      kind: "file",
      content: input.path,
      truncation: { truncated: false, charLimit: 20_000, returnedLength: input.path.length },
    })

    const streamed: SocratesAgentEvent[] = []
    const agent = new SocratesAgent(provider)
    for await (const event of agent.streamTurn({
      completionMode: "worker_text",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      messages: [{ role: "user", content: "Read two files" }],
      workspacePath: "/tmp",
      toolExecutors: executors,
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      streamed.push(event)
    }

    const started = streamed.filter(
      (event): event is Extract<SocratesAgentEvent, { type: "tool.call.started" }> =>
        event.type === "tool.call.started" && event.providerToolCallId === "functions.read:0",
    )
    expect(started).toHaveLength(2)
    expect(started.map((event) => event.providerToolCallId)).toEqual(["functions.read:0", "functions.read:0"])
    expect(new Set(started.map((event) => event.toolCallId)).size).toBe(2)
    expect(started.every((event) => event.toolCallId.startsWith("tcall_"))).toBe(true)
    expect(JSON.stringify(seenMessages.at(-1))).toContain('"toolCallId":"functions.read:0"')
    expect(JSON.stringify(seenMessages.at(-1))).not.toContain(started[0]?.toolCallId)
  })

  it("keeps clean trace references model-visible and returns cached warnings for duplicate searches", async () => {
    const seenMessages: unknown[] = []
    let calls = 0
    let traceExecutions = 0
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        seenMessages.push(request.messages)
        calls += 1
        if (calls <= 2) {
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: `trace_call_${calls}`,
              toolName: "trace_retrieve",
              input: { operation: "search", mode: "lexical", query: "staleness guard", conversationTitle: "apply patch fix", limit: 8 },
            },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: "Found it." }
        yield { type: "model.completed" }
      },
    }
    const executors = emptyToolExecutors()
    executors.trace_retrieve = (async () => {
      traceExecutions += 1
      return {
        results: [
          {
            resultNumber: 1,
            content: "The staleness guard caught it cold.",
            turnId: "turn_source_3",
            conversationTitle: "apply patch fix",
            turnNumber: 3,
            matchedRole: "assistant",
            status: "complete",
            occurredAt: "2026-07-01T10:00:00.000Z",
          },
        ],
        totalMatches: 1,
      }
    }) as never

    const streamed: SocratesAgentEvent[] = []
    const agent = new SocratesAgent(provider)
    for await (const event of agent.streamTurn({
      completionMode: "worker_text",
      projectId: "proj_1",
      conversationId: "conv_live",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      messages: [{ role: "user", content: "Find this old quote" }],
      workspacePath: "/tmp",
      toolExecutors: executors,
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      streamed.push(event)
    }

    expect(traceExecutions).toBe(1)
    expect(streamed.filter((event) => event.type === "tool.call.completed" && event.toolName === "trace_retrieve")).toHaveLength(2)
    const finalRequest = JSON.stringify(seenMessages.at(-1))
    expect(finalRequest).toContain("turn_source_3")
    expect(finalRequest).not.toContain("conv_source")
    expect(finalRequest).not.toContain("msg_assistant_3")
    expect(finalRequest).toContain("Identical trace_retrieve input already ran earlier in this turn")
  })

  it("omits tools from the final no-tools call after the per-turn tool budget is exhausted", async () => {
    const countRequests: CountedRequest[] = []
    const streamRequests: ModelRequestLike[] = []
    let calls = 0
    const provider: ModelProvider = {
      countTokens: async (request) => {
        countRequests.push(snapshotCountRequest(request))
        return fakeCountTokens(request)
      },
      async *stream(request) {
        streamRequests.push(request)
        calls += 1
        if (calls === 1) {
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_project_notes_1",
              toolName: "read",
              input: { path: "socrates://project/notes" },
            },
          }
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_project_notes_1",
              toolName: "read",
              input: { path: "socrates://project/notes" },
            },
          }
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_project_notes_once",
              toolName: "read",
              input: { path: "socrates://project/notes" },
            },
          }
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_project_notes_1",
              toolName: "read",
              input: { path: "socrates://project/notes" },
            },
          }
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_read_1",
              toolName: "read",
              input: { path: "README.md" },
            },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: "Tool budget was exhausted." }
        yield { type: "model.completed" }
      },
    }

    const agent = new SocratesAgent(provider)
    const streamed: SocratesAgentEvent[] = []
    for await (const event of agent.streamTurn({
      completionMode: "worker_text",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      messages: [{ role: "user", content: "Read README" }],
      workspacePath: "/tmp",
      toolExecutors: emptyToolExecutors(),
      requestApproval: async () => ({ decision: "approved" }),
      maxToolCallsPerTurn: 0,
    })) {
      streamed.push(event)
    }

    expect(streamed.some((event) => event.type === "tool.call.failed")).toBe(true)
    expect(countRequests[0]?.toolCount).toBe(12)
    expect(countRequests[1]?.toolCount).toBe(0)
    expect(streamRequests[1]?.tools).toHaveLength(0)
    expect(JSON.stringify(countRequests[1]?.messages)).toContain("tool-result")
  })

  it("keeps failed-tool guidance in the actual result without a shadow action ledger", async () => {
    const countRequests: CountedRequest[] = []
    let calls = 0
    const provider: ModelProvider = {
      countTokens: async (request) => {
        countRequests.push(snapshotCountRequest(request))
        return fakeCountTokens(request)
      },
      async *stream() {
        calls += 1
        if (calls === 1) {
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_bad_read_1",
              toolName: "read",
              input: { path: 123 },
            },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: "The read call was invalid." }
        yield { type: "model.completed" }
      },
    }

    const agent = new SocratesAgent(provider)
    for await (const _event of agent.streamTurn({
      completionMode: "worker_text",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      messages: [{ role: "user", content: "Read the file" }],
      workspacePath: "/tmp",
      toolExecutors: emptyToolExecutors(),
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      // Drain the turn.
    }

    const followUpMessages = JSON.stringify(countRequests[1]?.messages)
    expect(followUpMessages).toContain("socrates://tool-guidance")
    expect(followUpMessages).toContain("invalid_tool_input")
    expect(followUpMessages).not.toContain("Runtime action ledger for this turn")
  })

  it("gives invalid mutation tool schemas a concrete recovery hint before forcing a final answer", async () => {
    const countRequests: CountedRequest[] = []
    const streamRequests: ModelRequestLike[] = []
    const editInputs: unknown[] = []
    let calls = 0
    const provider: ModelProvider = {
      countTokens: async (request) => {
        countRequests.push(snapshotCountRequest(request))
        return fakeCountTokens(request)
      },
      async *stream(request) {
        streamRequests.push(request)
        calls += 1
        if (calls === 1) {
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_project_notes_once",
              toolName: "read",
              input: { path: "socrates://project/notes" },
            },
          }
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_project_notes_once",
              toolName: "read",
              input: { path: "socrates://project/notes" },
            },
          }
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_bad_edit_1",
              toolName: "edit",
              input: { path: "socrates_natural_e2e.md", content: "# Note\n", overwrite: false },
            },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        if (calls === 2) {
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_bad_edit_2",
              toolName: "edit",
              input: { path: "socrates_natural_e2e.md", content: "# Note\n", oldString: "old", newString: "new" },
            },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        if (calls === 3) {
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_capability_guidance",
              toolName: "read",
              input: { path: "socrates://tool-guidance/edit" },
            },
          }
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_good_edit_3",
              toolName: "edit",
              input: { path: "socrates_natural_e2e.md", content: "# Natural E2E\n" },
            },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: "Created the note." }
        yield { type: "model.completed" }
      },
    }

    const executors = emptyToolExecutors()
    executors.edit = async (input) => {
      editInputs.push(input)
      return {
        changedFiles: [{ path: "socrates_natural_e2e.md", operation: "created" }],
        diff: "created",
        dryRun: false,
        truncation: { truncated: false, charLimit: 20_000, returnedLength: 7 },
      }
    }

    const agent = new SocratesAgent(provider)
    for await (const _event of agent.streamTurn({
      completionMode: "worker_text",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "approve_all",
        sandboxMode: "workspace_write",
      },
      messages: [{ role: "user", content: "Make a small markdown note with what we checked." }],
      workspacePath: "/tmp",
      toolExecutors: executors,
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      // Drain the turn.
    }

    expect(JSON.stringify(countRequests[1]?.messages)).toContain("socrates://tool-guidance")
    expect(JSON.stringify(countRequests[2]?.messages)).not.toContain("Runtime tool-schema recovery")
    expect(streamRequests[1]?.tools?.map((tool) => tool.name)).toContain("edit")
    expect(streamRequests[2]?.tools?.map((tool) => tool.name)).toContain("edit")
    expect(editInputs).toHaveLength(1)
    expect(editInputs[0]).toMatchObject({ path: "socrates_natural_e2e.md", content: "# Natural E2E\n" })
  })

  it("still forces a final no-tools call after four invalid mutation schemas", async () => {
    const countRequests: CountedRequest[] = []
    const streamRequests: ModelRequestLike[] = []
    let calls = 0
    const provider: ModelProvider = {
      countTokens: async (request) => {
        countRequests.push(snapshotCountRequest(request))
        return fakeCountTokens(request)
      },
      async *stream(request) {
        streamRequests.push(request)
        calls += 1
        if (calls <= 4) {
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: `tcall_bad_edit_${calls}`,
              toolName: "edit",
              input: { path: "socrates_natural_e2e.md", content: `# Note ${calls}\n`, overwrite: false },
            },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: "I could not safely edit the file." }
        yield { type: "model.completed" }
      },
    }

    const agent = new SocratesAgent(provider)
    for await (const _event of agent.streamTurn({
      completionMode: "worker_text",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "approve_all",
        sandboxMode: "workspace_write",
      },
      messages: [{ role: "user", content: "Make a small markdown note with what we checked." }],
      workspacePath: "/tmp",
      toolExecutors: emptyToolExecutors(),
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      // Drain the turn.
    }

    expect(countRequests.at(-1)?.toolCount).toBe(0)
    expect(streamRequests.at(-1)?.tools).toHaveLength(0)
    const finalMessages = JSON.stringify(countRequests.at(-1)?.messages)
    expect(finalMessages).toContain("invalid_tool_input")
    expect(finalMessages).not.toContain("Runtime anti-spiral guard")
  })

  it("forces a final no-tools call after repeated normalized tool targets", async () => {
    const countRequests: CountedRequest[] = []
    const streamRequests: ModelRequestLike[] = []
    let calls = 0
    const provider: ModelProvider = {
      countTokens: async (request) => {
        countRequests.push(snapshotCountRequest(request))
        return fakeCountTokens(request)
      },
      async *stream(request) {
        streamRequests.push(request)
        calls += 1
        if (calls <= 4) {
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: `tcall_read_${calls}`,
              toolName: "read",
              input: { path: calls % 2 === 0 ? "./README.md" : "README.md" },
            },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: "I have enough evidence from the repeated reads." }
        yield { type: "model.completed" }
      },
    }

    const agent = new SocratesAgent(provider)
    for await (const _event of agent.streamTurn({
      completionMode: "worker_text",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      messages: [{ role: "user", content: "Inspect README" }],
      workspacePath: "/tmp",
      toolExecutors: emptyToolExecutors(),
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      // Drain the turn.
    }

    expect(countRequests.at(-1)?.toolCount).toBe(0)
    expect(streamRequests.at(-1)?.tools).toHaveLength(0)
    const finalMessages = JSON.stringify(countRequests.at(-1)?.messages)
    expect(finalMessages).toContain("tool-result")
    expect(finalMessages).not.toContain("Runtime anti-spiral guard")
  })

  it("does not inject token-growth steering messages into large current turns", async () => {
    const countRequests: CountedRequest[] = []
    const streamRequests: ModelRequestLike[] = []
    let countCalls = 0
    let streamCalls = 0
    const provider: ModelProvider = {
      countTokens: async (request) => {
        countRequests.push(snapshotCountRequest(request))
        countCalls += 1
        const inputTokens = countCalls === 1 ? 1_000 : countCalls === 2 ? 51_000 : countCalls === 3 ? 82_000 : 82_100
        return {
          providerId: request.providerId,
          modelId: request.modelId,
          inputTokens,
          baseTokens: inputTokens,
          method: "local_tiktoken",
          safetyMarginPercent: 0,
        }
      },
      async *stream(request) {
        streamRequests.push(request)
        streamCalls += 1
        if (streamCalls === 1) {
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_read_1",
              toolName: "read",
              input: { path: "README.md" },
            },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: "Stopping before more tool work." }
        yield { type: "model.completed" }
      },
    }

    const agent = new SocratesAgent(provider)
    for await (const _event of agent.streamTurn({
      completionMode: "worker_text",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      messages: [{ role: "user", content: "Investigate deeply" }],
      workspacePath: "/tmp",
      toolExecutors: emptyToolExecutors(),
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      // Drain the turn.
    }

    expect(countRequests.at(-1)?.toolCount).toBeGreaterThan(0)
    expect(streamRequests.at(-1)?.tools?.length ?? 0).toBeGreaterThan(0)
    const finalMessages = JSON.stringify(countRequests.at(-1)?.messages)
    expect(finalMessages).not.toContain("current-turn context growth")
    expect(finalMessages).not.toContain("Runtime action ledger")
  })

  it("omits tools after ten confirmed tool execution errors", async () => {
    const countRequests: CountedRequest[] = []
    const streamRequests: ModelRequestLike[] = []
    let calls = 0
    const provider: ModelProvider = {
      countTokens: async (request) => {
        countRequests.push(snapshotCountRequest(request))
        return fakeCountTokens(request)
      },
      async *stream(request) {
        streamRequests.push(request)
        calls += 1
        if (calls <= 10) {
          yield {
            type: "model.tool_call.completed",
              toolCall: {
                toolCallId: `tcall_bad_trace_${calls}`,
                toolName: "trace_retrieve",
                input: { query: `README ${calls}`, role: "system" },
              },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: "The tool calls are invalid." }
        yield { type: "model.completed" }
      },
    }

    const agent = new SocratesAgent(provider)
    const streamed: SocratesAgentEvent[] = []
    for await (const event of agent.streamTurn({
      completionMode: "worker_text",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      messages: [{ role: "user", content: "Find this old quote" }],
      workspacePath: "/tmp",
      toolExecutors: emptyToolExecutors(),
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      streamed.push(event)
    }

    const failed = streamed.filter((event) => event.type === "tool.call.failed")
    expect(failed).toHaveLength(10)
    expect(countRequests).toHaveLength(11)
    expect(countRequests[0]?.toolCount).toBe(12)
    expect(countRequests[10]?.toolCount).toBe(0)
    expect(streamRequests[10]?.tools).toHaveLength(0)
    expect(JSON.stringify(countRequests[10]?.messages)).toContain("invalid_tool_input")
    expect(JSON.stringify(countRequests[10]?.messages)).not.toContain("confirmed tool-call execution errors")
  })

  it("uses an internal preview to include an edit diff in approval requests", async () => {
    let calls = 0
    const streamRequests: ModelRequestLike[] = []
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        streamRequests.push(request)
        calls += 1
        if (calls === 1) {
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_read_1",
              toolName: "read",
              input: { path: "README.md" },
            },
          }
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_edit_1",
              toolName: "edit",
              input: { path: "README.md", edits: [{ oldString: "old", newString: "new" }] },
            },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: "Edited." }
        yield { type: "model.completed" }
      },
    }
    const approvals: string[] = []
    const editDryRuns: boolean[] = []
    const executors: ToolExecutors = {
      read: async () => ({
        path: "README.md",
        kind: "file",
        content: "",
        truncation: { truncated: false, charLimit: 20_000, returnedLength: 0 },
      }),
      search: async () => ({ mode: "files", query: "", matches: [], totalMatches: 0, truncation: { truncated: false, charLimit: 20_000, returnedLength: 0 } }),
      url_fetch: async () => ({
        url: "https://example.com",
        finalUrl: "https://example.com",
        status: 200,
        ok: true,
        redirected: false,
        sizeBytes: 0,
        text: "",
        truncation: { truncated: false, charLimit: 20_000, returnedLength: 0 },
      }),
      edit: async (_input, context) => {
        editDryRuns.push(context.previewOnly === true)
        return {
          changedFiles: [{ path: "README.md", operation: "edited" }],
          diff: "--- a/README.md\n+++ b/README.md\n@@ -1,1 +1,1 @@\n-old\n+new",
          dryRun: context.previewOnly ?? false,
          truncation: { truncated: false, charLimit: 20_000, returnedLength: 57 },
        }
      },
      apply_patch: async () => ({ changedFiles: [], diff: "", dryRun: false, truncation: { truncated: false, charLimit: 20_000, returnedLength: 0 } }),
      bash: async () => bashOk(),
      current_time: async () => ({
        currentDate: "2026-06-19",
        currentDateTime: "2026-06-19T06:30:00.000Z",
        timeZone: "Europe/Vienna",
        source: "system",
      }),
      trace_retrieve: async () => ({
        results: [],
        totalMatches: 0,
        truncation: { truncated: false, charLimit: 20_000, returnedLength: 0 },
        appliedFilters: { operation: "search", scope: "current_conversation", mode: "combined" },
      }),
    }

    const agent = new SocratesAgent(provider)
    for await (const _event of agent.streamTurn({
      completionMode: "worker_text",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      messages: [{ role: "user", content: "Edit README" }],
      workspacePath: "/tmp",
      toolExecutors: executors,
      requestApproval: async (request) => {
        approvals.push(request.actionPreview)
        return { decision: "approved" }
      },
    })) {
      // Drain stream.
    }

    expect(editDryRuns).toEqual([true, false])
    expect(approvals[0]).toContain("-old")
    expect(approvals[0]).toContain("+new")
    expect(JSON.stringify(streamRequests)).not.toContain("runtime_socrates_docs_preflight")
    expect(JSON.stringify(streamRequests)).not.toContain("runtime_docs_sync_checkpoint")
  })

  it("allows an action tool without project and repo docs ceremony", async () => {
    let calls = 0
    const streamRequests: ModelRequestLike[] = []
    const approvals: string[] = []
    const editInputs: unknown[] = []
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        streamRequests.push(request)
        calls += 1
        if (calls === 1) {
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_read_without_repo_docs",
              toolName: "read",
              input: { path: "README.md" },
            },
          }
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_edit_without_repo_docs",
              toolName: "edit",
              input: { path: "README.md", edits: [{ oldString: "old", newString: "new" }] },
            },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: "I need to read docs first." }
        yield { type: "model.completed" }
      },
    }
    const streamed: SocratesAgentEvent[] = []
    const executors = emptyToolExecutors()
    executors.edit = async (input, context) => {
      editInputs.push(input)
      return {
        changedFiles: [{ path: "README.md", operation: "edited" }],
        diff: "real diff",
        dryRun: context.previewOnly ?? false,
        truncation: { truncated: false, charLimit: 20_000, returnedLength: 9 },
      }
    }

    const agent = new SocratesAgent(provider)
    for await (const event of agent.streamTurn({
      completionMode: "worker_text",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      messages: [{ role: "user", content: "Edit README" }],
      workspacePath: "/tmp",
      toolExecutors: executors,
      requestApproval: async (request) => {
        approvals.push(request.actionPreview)
        return { decision: "approved" }
      },
    })) {
      streamed.push(event)
    }

    const failed = streamed.find((event): event is Extract<SocratesAgentEvent, { type: "tool.call.failed" }> => event.type === "tool.call.failed")
    expect(failed).toBeUndefined()
    expect(JSON.stringify(streamRequests)).not.toContain("docs_preflight_required")
    expect(approvals).toHaveLength(1)
    expect(editInputs).toHaveLength(2)
  })

  it("does not inject per-action docs checkpoints", async () => {
    let calls = 0
    const streamRequests: ModelRequestLike[] = []
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        streamRequests.push(request)
        calls += 1
        if (calls === 1) {
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_read_once",
              toolName: "read",
              input: { path: "README.md" },
            },
          }
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_edit_once",
              toolName: "edit",
              input: { path: "README.md", edits: [{ oldString: "old", newString: "new" }] },
            },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        if (calls === 2) {
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "tcall_bash_after_checkpoint",
              toolName: "bash",
              input: { operation: "run", command: "pnpm test", cwd: "." },
            },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: "Done." }
        yield { type: "model.completed" }
      },
    }
    const executors = emptyToolExecutors()
    executors.edit = async (_input, context) => ({
      changedFiles: [{ path: "README.md", operation: "edited" }],
      diff: context.previewOnly ? "dry diff" : "real diff",
      dryRun: context.previewOnly ?? false,
      truncation: { truncated: false, charLimit: 20_000, returnedLength: 8 },
    })
    executors.bash = async () => bashOk()

    const agent = new SocratesAgent(provider)
    for await (const _event of agent.streamTurn({
      completionMode: "worker_text",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      messages: [{ role: "user", content: "Make the small README fix and check it." }],
      workspacePath: "/tmp",
      toolExecutors: executors,
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      // Drain stream.
    }

    expect(streamRequests).toHaveLength(3)
    const firstRequest = JSON.stringify(streamRequests[0]?.messages)
    const finalRequest = JSON.stringify(streamRequests[2]?.messages)
    expect(countSubstring(firstRequest, "<runtime_socrates_docs_preflight>")).toBe(0)
    expect(countSubstring(finalRequest, "<runtime_socrates_docs_preflight>")).toBe(0)
    expect(countSubstring(finalRequest, "<runtime_docs_sync_checkpoint>")).toBe(0)
  })

  it("feeds read image results back to vision-capable models as native image parts", async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-core-image-read-"))
    fs.writeFileSync(path.join(workspacePath, "screenshot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const streamRequests: ModelRequestLike[] = []
    let calls = 0
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        streamRequests.push(request)
        calls += 1
        if (calls === 1) {
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "call_read_image",
              toolName: "read",
              input: { path: "screenshot.png" },
            },
          }
          yield { type: "model.completed" }
          return
        }
        yield { type: "model.answer.delta", text: "I can inspect the image." }
        yield { type: "model.completed" }
      },
    }
    const executors = emptyToolExecutors()
    executors.read = async () => ({
      path: "screenshot.png",
      kind: "image",
      mimeType: "image/png",
      sizeBytes: 4,
      contentHash: "hash",
      image: {
        mediaType: "image/png",
        nativeVisionSupported: true,
        description: "Image metadata is available.",
      },
      truncation: { truncated: false, charLimit: 20_000, returnedLength: 0 },
    })

    const agent = new SocratesAgent(provider)
    const streamed: SocratesAgentEvent[] = []
    for await (const event of agent.streamTurn({
      completionMode: "worker_text",
      providerId: "openrouter",
      modelId: "x-ai/grok-build-0.1",
      runtimeConfig: {
        providerId: "openrouter",
        modelId: "x-ai/grok-build-0.1",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      messages: [{ role: "user", content: "Read the screenshot." }],
      workspacePath,
      toolExecutors: executors,
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      streamed.push(event)
    }

    expect(streamed.some((event) => event.type === "tool.call.completed")).toBe(true)
    expect(JSON.stringify(streamRequests[1]?.messages)).toContain("Native image content returned by read")
    expect(JSON.stringify(streamRequests[1]?.messages)).toContain('"type":"image"')
    expect(JSON.stringify(streamRequests[1]?.messages)).toContain("iVBORw==")
    expect(streamRequests[1]?.tools?.map((tool) => tool.name)).toContain("read")
  })

  it("preserves tool schemas for OpenRouter turns that already include native image parts", async () => {
    const streamRequests: ModelRequestLike[] = []
    const countRequests: CountedRequest[] = []
    const provider: ModelProvider = {
      countTokens: async (request) => {
        countRequests.push(snapshotCountRequest(request))
        return fakeCountTokens(request)
      },
      async *stream(request) {
        streamRequests.push(request)
        yield { type: "model.answer.delta", text: request.tools?.length ? "tools present" : "image only" }
        yield { type: "model.completed" }
      },
    }

    const agent = new SocratesAgent(provider)
    const streamed: SocratesAgentEvent[] = []
    for await (const event of agent.streamTurn({
      completionMode: "worker_text",
      providerId: "openrouter",
      modelId: "x-ai/grok-build-0.1",
      runtimeConfig: {
        providerId: "openrouter",
        modelId: "x-ai/grok-build-0.1",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is in this screenshot?" },
            { type: "image", mediaType: "image/png", data: "data:image/png;base64,iVBORw==" },
          ],
        },
      ],
      workspacePath: "/tmp",
      toolExecutors: emptyToolExecutors(),
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      streamed.push(event)
    }

    expect(streamed.some((event) => event.type === "model.answer.delta")).toBe(true)
    expect(countRequests[0]?.toolCount).toBeGreaterThan(0)
    expect(streamRequests[0]?.tools?.map((tool) => tool.name)).toContain("read")
  })

  it("hides terminal runtime ids and sequence cursors from model-visible tool results", async () => {
    const requests: ModelRequestLike[] = []
    let call = 0
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        requests.push(request)
        call += 1
        if (call === 1) {
          yield {
            type: "model.tool_call.completed",
            toolCall: {
              toolCallId: "call_terminal_output",
              toolName: "bash",
              input: { operation: "inspect", name: "dev-server" },
            },
          }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: "Terminal output checked." }
        yield { type: "model.completed" }
      },
    }
    const executors = emptyToolExecutors()
    executors.bash = async () => ({
      ...bashOk(),
      operation: "inspect",
      stdout: "ready on http://localhost:5173\n",
      process: {
        processId: "proc_secret",
        systemPid: 1234,
        status: "running",
        nextOutputSequence: 7,
      },
      terminal: {
        terminalId: "term_secret",
        name: "dev-server",
        status: "running",
        nextOutputSequence: 7,
      },
    })

    const agent = new SocratesAgent(provider)
    for await (const _event of agent.streamTurn({
      completionMode: "worker_text",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "approve_all",
        sandboxMode: "workspace_write",
      },
      messages: [{ role: "user", content: "Check terminal output" }],
      workspacePath: "/tmp",
      toolExecutors: executors,
      requestApproval: async () => ({ decision: "approved" }),
    })) {
      // Drain stream.
    }

    const secondRequest = JSON.stringify(requests[1]?.messages)
    expect(secondRequest).toContain("dev-server")
    expect(secondRequest).toContain("ready on http://localhost:5173")
    expect(secondRequest).not.toContain("proc_secret")
    expect(secondRequest).not.toContain("term_secret")
    expect(secondRequest).not.toContain("nextOutputSequence")
    expect(secondRequest).not.toContain("systemPid")
  })

  it("injects user and project context into the system prompt", async () => {
    const seen: unknown[] = []
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        seen.push(request)
        yield { type: "model.completed" }
      },
    }

    const agent = new SocratesAgent(provider)
    for await (const _event of agent.streamTurn({
      completionMode: "worker_text",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "read_only",
      },
      messages: [{ role: "user", content: "Hi" }],
      promptContext: {
        userDisplayName: "Ayush",
        projectName: "Socrates",
        projectDescription: "Local-first AI workspace.",
        projectInstructions: "Read repo_docs before answering.",
      },
    })) {
      // Exhaust the stream.
    }

    const request = seen[0] as { system: string; messages: ModelMessage[] }
    const dynamicContext = JSON.stringify(request.messages)
    expect(request.system).not.toContain("Name: Ayush")
    expect(dynamicContext).toContain("Name: Ayush")
    expect(dynamicContext).toContain("Name: Socrates")
    expect(dynamicContext).toContain("Local-first AI workspace.")
    expect(dynamicContext).toContain("Read repo_docs before answering.")
    expect(request.system).toContain("If the current date or exact time matters, call current_time")
    expect(request.system).toContain("greetings do not require ceremonial reads")
    expect(request.system).toContain("prepared capsule and latest exact exchange")
    expect(request.system).toContain("Project notes include `active_context`")
    expect(request.system).toContain("socrates://project/notes/active_context")
    expect(request.system).toContain("backend-owned `runtime_context` section")
    expect(request.system).toContain("Be human first: warm, curious, grounded, and quietly wise")
    expect(request.system).toContain("Translate them into plain human language before speaking")
    expect(request.system).toContain("do not give a backend status report")
    expect(request.system).toContain("not a status daemon narrating its database")
    expect(request.system).not.toContain("Current date: 2026-06-19")
    expect(request.system).not.toContain("Current timestamp: 2026-06-19T06:30:00.000Z")
    expect(request.system).not.toContain("Time zone: Europe/Vienna")
    expect(request.system).not.toContain("Python Environment Hints")
    expect(request.system).not.toContain("Workspace command environment:")
    expect(request.system).not.toContain("Semantic retrieval status:")
    expect(request.system).toContain("search `socrates://capabilities`")
    expect(request.system).toContain("capability_manager handles skill create/update/delete/enable/disable")
    expect(request.system).toContain("Do not simulate skills or extensions")
    expect(request.system).toContain("Never claim a capability is missing before this fallback")
    expect(request.system).toContain("five operations")
    expect(request.system).toContain("Use lexical with a concise literal phrase")
    expect(request.system).toContain("Cross-project selectors are not available to the main agent")
    expect(request.system).toContain("Do not begin with guessed absolute cd paths")
    expect(request.system).toContain("Terminal commands start in the active workspace")
  })

  it("keeps skill import preview automatic and requires approval for commit", async () => {
    const context = {} as Parameters<typeof capabilityManagerTool.decidePolicy>[1]
    expect(await capabilityManagerTool.decidePolicy({ operation: "skill_preview_import", scope: "path", url: "https://example.com/review.zip" }, context)).toEqual({ type: "auto" })
    expect(
      await capabilityManagerTool.decidePolicy(
        { operation: "skill_commit_import", scope: "global", previewId: `skillimp_${"a".repeat(32)}`, conflictStrategy: "replace" },
        context,
      ),
    ).toMatchObject({ type: "approval_required", request: { risk: "low" } })
  })

  it("requires approval for skill lifecycle mutations", async () => {
    const context = {} as Parameters<typeof capabilityManagerTool.decidePolicy>[1]

    expect(await capabilityManagerTool.decidePolicy(
      { operation: "skill_create", scope: "path", name: "release-auditor", request: "Check release notes for missing verification evidence." },
      context,
    )).toMatchObject({
      type: "approval_required",
      request: { actionKind: "file_write", risk: "low" },
    })
    expect(await capabilityManagerTool.decidePolicy(
      { operation: "skill_delete", scope: "path", name: "release-auditor" },
      context,
    )).toMatchObject({
      type: "approval_required",
      request: { actionKind: "file_write", risk: "medium" },
    })
  })

  it("collects multiple MCP credentials sequentially and passes values only to the runtime executor", async () => {
    const requestedKeys: string[] = []
    let executorInput: unknown
    let executorSecrets: Readonly<Record<string, string>> | undefined
    const executors = emptyToolExecutors()
    executors.capability_manager = async (input, _context, resolvedSecretEnv) => {
      executorInput = input
      executorSecrets = resolvedSecretEnv
      return {
        operation: "mcp_configure",
        status: "completed",
        summary: "Configured safely.",
      }
    }
    const result = await capabilityManagerTool.execute({
      operation: "mcp_configure",
      scope: "path",
      server: {
        id: "multi-secret",
        command: "trusted-mcp-command",
        secretBindings: [
          { envKey: "FIRST_API_KEY", source: "user_input" },
          { envKey: "SECOND_API_KEY", source: "workspace_env" },
        ],
      },
    }, {
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      toolCallId: "tcall_1",
      workspacePath: "/tmp",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      executors,
      onOutput: () => undefined,
      requestApproval: async () => ({ decision: "approved" }),
      requestCredentialInput: async (request) => {
        requestedKeys.push(request.envKey)
        expect(request.toolCallId).toBe("tcall_1")
        return { decision: "submitted", value: `${request.envKey}-private`, source: request.source }
      },
    })

    expect(result.summary).toBe("Configured safely.")
    expect(requestedKeys).toEqual(["FIRST_API_KEY", "SECOND_API_KEY"])
    expect(executorSecrets).toEqual({
      FIRST_API_KEY: "FIRST_API_KEY-private",
      SECOND_API_KEY: "SECOND_API_KEY-private",
    })
    expect(JSON.stringify(executorInput)).not.toContain("-private")
    expect(executorInput).toMatchObject({
      server: {
        secretBindings: [
          { envKey: "FIRST_API_KEY", source: "user_input" },
          { envKey: "SECOND_API_KEY", source: "workspace_env" },
        ],
      },
    })
  })
  it("attaches one compact reconciliation notice to a real result after a verified mutation milestone", async () => {
    const streamRequests: ModelRequestLike[] = []
    const persisted: Array<import("../index").ReconciliationWatermarkState> = []
    let streamCalls = 0
    const provider: ModelProvider = {
      countTokens: fakeCountTokens,
      async *stream(request) {
        streamRequests.push(request)
        streamCalls += 1
        if (streamCalls === 1) {
          yield { type: "model.tool_call.completed", toolCall: { toolCallId: "notes", toolName: "read", input: { path: "socrates://project/notes" } } }
          yield { type: "model.tool_call.completed", toolCall: { toolCallId: "rules", toolName: "read", input: { path: "socrates://project/repo-docs/REPO_RULES.md" } } }
          yield { type: "model.tool_call.completed", toolCall: { toolCallId: "patch", toolName: "apply_patch", input: { patchText: "*** Begin Patch" } } }
          yield { type: "model.completed", finishReason: "tool-calls" }
          return
        }
        yield { type: "model.answer.delta", text: finalJson("Implemented and verified.", "Mutation milestone verified.") }
        yield { type: "model.completed" }
      },
    }
    const executors = emptyToolExecutors()
    executors.apply_patch = async () => ({
      changedFiles: [{ path: "a.ts", operation: "edited" }, { path: "b.ts", operation: "edited" }],
      diff: "two verified files",
      dryRun: false,
      truncation: { truncated: false, charLimit: 20_000, returnedLength: 18 },
    })

    const agent = new SocratesAgent(provider)
    for await (const _event of agent.streamTurn({
      completionMode: "main_structured",
      projectId: "proj_1",
      conversationId: "conv_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      runtimeConfig: {
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        thinkingEnabled: false,
        thinkingEffort: "none",
        approvalMode: "manual",
        sandboxMode: "workspace_write",
      },
      messages: [{ role: "user", content: "Implement the two-file milestone." }],
      workspacePath: "/tmp",
      toolExecutors: executors,
      requestApproval: async () => ({ decision: "approved" }),
      taskStartedAt: "2026-07-26T10:00:00.000Z",
      reconciliationClock: () => Date.parse("2026-07-26T10:01:00.000Z"),
      persistReconciliationWatermark: (state) => {
        persisted.push(state)
      },
    })) {
      // Drain the same foreground loop.
    }

    expect(streamRequests).toHaveLength(2)
    const followUp = JSON.stringify(streamRequests[1]?.messages)
    expect(countSubstring(followUp, '"kind":"socrates_reconciliation"')).toBe(1)
    expect(followUp).toContain("substantial_verified_mutation")
    expect(followUp).not.toContain("socrates_progress_reconciliation_checkpoint")
    expect(followUp).not.toContain("socrates_reconciliation_checkpoint")
    expect(persisted.at(-1)).toMatchObject({
      lastReconciledEvidenceSequence: 3,
      lastObservedEvidenceSequence: 3,
      lastVerifiedMutationBoundary: 3,
    })
  })
})

describe("bash tool policy", () => {
  it("keeps only inspection operations automatic and gates executable commands", async () => {
    const context = {
      runtimeConfig: { sandboxMode: "workspace_write", approvalMode: "manual" },
    } as Parameters<typeof bashTool.decidePolicy>[1]

    expect(await bashTool.decidePolicy({ operation: "run", command: "git status --short" }, context)).toMatchObject({ type: "approval_required" })
    expect(await bashTool.decidePolicy({ operation: "run", command: "Get-Content package.json" }, context)).toMatchObject({ type: "approval_required" })
    expect(await bashTool.decidePolicy({ operation: "run", command: "cat package.json > copied.json" }, context)).toMatchObject({ type: "approval_required" })
    expect(await bashTool.decidePolicy({ operation: "inspect", name: "dev" }, context)).toEqual({ type: "auto" })
    expect(await bashTool.decidePolicy({ operation: "stop", name: "dev" }, context)).toEqual({ type: "auto" })
    expect(await bashTool.decidePolicy({ operation: "list" }, context)).toEqual({ type: "auto" })

    const dockerPolicy = await bashTool.decidePolicy({ operation: "run", command: "docker compose up -d" }, context)
    expect(dockerPolicy.type).toBe("approval_required")
    if (dockerPolicy.type === "approval_required") {
      expect(dockerPolicy.request.risk).toBe("high")
    }
  })

  it("denies all executable commands in read-only mode", async () => {
    const context = {
      runtimeConfig: { sandboxMode: "read_only", approvalMode: "read_only_auto" },
    } as Parameters<typeof bashTool.decidePolicy>[1]

    expect(await bashTool.decidePolicy({ operation: "run", command: "git diff --stat" }, context)).toMatchObject({ type: "denied" })
    expect(await bashTool.decidePolicy({ operation: "run", command: "pnpm test" }, context)).toMatchObject({ type: "denied" })
    expect(await bashTool.decidePolicy({ operation: "inspect", name: "dev" }, context)).toEqual({ type: "auto" })
  })

  it("rejects empty or comment-only Terminal commands before approval", async () => {
    const context = {
      runtimeConfig: { sandboxMode: "workspace_write", approvalMode: "manual" },
    } as Parameters<typeof bashTool.decidePolicy>[1]

    expect(await bashTool.decidePolicy({ operation: "run", command: "   \n\t" }, context)).toMatchObject({
      type: "denied",
      code: "terminal_noop_command",
    })
    expect(await bashTool.decidePolicy({ operation: "start", name: "notes", command: "# note\n# another note" }, context)).toMatchObject({
      type: "denied",
      code: "terminal_noop_command",
    })
    expect(await bashTool.decidePolicy({ operation: "run", command: "# list files\nls" }, context)).toMatchObject({ type: "approval_required" })
  })
})

type ModelRequestLike = Parameters<ModelProvider["countTokens"]>[0]
type CountedRequest = {
  messages: unknown
  toolCount: number
}

const countSubstring = (value: string, needle: string): number => value.split(needle).length - 1

const finalJson = (
  finalAnswer: string,
  note: string,
  state: "active" | "completed" | "blocked" | "discarded" = "completed",
): string => JSON.stringify({ finalAnswer, goalFinalization: { state, note } })

const stringMessageContents = (messages: unknown): string[] =>
  Array.isArray(messages)
    ? messages.flatMap((message) => {
        if (!message || typeof message !== "object" || !("content" in message)) {
          return []
        }
        const content = (message as { content?: unknown }).content
        return typeof content === "string" ? [content] : []
      })
    : []

const snapshotCountRequest = (request: ModelRequestLike): CountedRequest => ({
  messages: JSON.parse(JSON.stringify(request.messages)) as unknown,
  toolCount: request.tools?.length ?? 0,
})

const governedResourceOutput = (resourcePath: string, content: string) => ({
  path: resourcePath,
  kind: "resource" as const,
  content,
  truncation: { truncated: false, charLimit: 20_000, returnedLength: content.length },
})

const emptyToolExecutors = (): ToolExecutors => ({
  read: async (input) => input.path.startsWith("socrates://")
    ? governedResourceOutput(input.path, "")
    : { path: input.path, kind: "file", content: "", truncation: { truncated: false, charLimit: 20_000, returnedLength: 0 } },
  search: async () => ({ mode: "files", query: "", matches: [], totalMatches: 0, truncation: { truncated: false, charLimit: 20_000, returnedLength: 0 } }),
  url_fetch: async () => ({
    url: "https://example.com",
    finalUrl: "https://example.com",
    status: 200,
    ok: true,
    redirected: false,
    sizeBytes: 0,
    text: "",
    truncation: { truncated: false, charLimit: 20_000, returnedLength: 0 },
  }),
  edit: async () => ({ changedFiles: [], diff: "", dryRun: false, truncation: { truncated: false, charLimit: 20_000, returnedLength: 0 } }),
  apply_patch: async () => ({ changedFiles: [], diff: "", dryRun: false, truncation: { truncated: false, charLimit: 20_000, returnedLength: 0 } }),
  bash: async () => bashOk(),
  current_time: async () => ({
    currentDate: "2026-06-19",
    currentDateTime: "2026-06-19T06:30:00.000Z",
    timeZone: "Europe/Vienna",
    source: "system",
  }),
  trace_retrieve: async () => ({
    results: [],
    totalMatches: 0,
    truncation: { truncated: false, charLimit: 20_000, returnedLength: 0 },
    appliedFilters: { operation: "search", scope: "current_conversation", mode: "combined" },
  }),
})

const bashOk = () => ({
  operation: "run" as const,
  command: "pwd",
  cwd: "/tmp",
  exitCode: 0,
  stdout: "",
  stderr: "",
  durationMs: 0,
  timedOut: false,
  truncation: { truncated: false, charLimit: 20_000, returnedLength: 0 },
  shell: { platform: "darwin", kind: "posix" as const, executable: "/bin/zsh" },
})

const validCompressorSummary = () => ({
  schemaVersion: 1 as const,
  goal: "Continue after compaction.",
  constraints: [],
  done: ["Compressed old context."],
  inProgress: [],
  blocked: [],
  decisions: [],
  nextSteps: ["Run the app model call."],
  criticalContext: [],
  relevantFiles: [],
  toolState: [],
  anchors: ["Turn 1: inspect old history."],
})

const fakeCountTokens: ModelProvider["countTokens"] = async (request) => {
  const baseTokens = Math.ceil(`${request.system}${JSON.stringify(request.messages)}${JSON.stringify(request.tools ?? [])}`.length / 4)
  return {
    providerId: request.providerId,
    modelId: request.modelId,
    inputTokens: baseTokens,
    baseTokens,
    method: "local_tiktoken",
    safetyMarginPercent: 0,
  }
}
