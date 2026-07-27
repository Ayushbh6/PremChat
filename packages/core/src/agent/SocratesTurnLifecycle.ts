import {
  type NormalizedToolCall,
  type ToolExecutionResult,
  type ToolName,
} from "@socrates/contracts"
import type { ModelMessage, ModelProvider } from "@socrates/providers"
import { createId, normalizeError, SocratesError } from "@socrates/shared"
import type { CapabilitySet } from "../capabilities/CapabilityCatalog"
import type { ApprovalRequest, ToolLifecycleEvent, ToolRuntimeContext } from "../tools/types"
import { MemoryRouterAgent, type ActiveGoalCard } from "./MemoryRouterAgent"
import type { SocratesAgentTurnInput } from "./SocratesAgent"
import { AsyncEventQueue } from "./AsyncEventQueue"
import {
  canLoadStableCachePrelude,
  canRunMemoryLoop,
  emptyMemoryLoopRunResult,
  isStableCachePreludeRecord,
  memoryLoopWarning,
  memoryRouterBaseInput,
  renderMemoryLoopDeveloperMessage,
  renderStableCachePrelude,
  renderStableCachePreludeSnapshot,
  routedPreTurnRecallRequests,
  stablePreludeRecallRequests,
  summarizeMemoryLoop,
  type MemoryLoopRunResult,
  type MemoryLoopToolRecord,
} from "./socratesMemorySupport"
import {
  TurnDocsLedger,
  docsPreflightError,
  requiresActionDocsPreflight,
  requiresDocsPreflightAfterPolicy,
  toolErrorResult,
} from "./socratesTurnLedgers"
import {
  addDuplicateTraceRetrieveWarning,
  previewJson,
  stableToolInputKey,
} from "./socratesToolResultSupport"

export class SocratesTurnLifecycle {
  constructor(
    private readonly provider: ModelProvider,
    private readonly baseCapabilities: CapabilitySet,
    private readonly memoryRouterAgent: MemoryRouterAgent,
  ) {}

  executeToolCalls(input: {
    toolCalls: NormalizedToolCall[]
    capabilitySet: CapabilitySet
    context: ToolRuntimeContext
    remainingBudget: number
    maxParallelToolCalls: number
    duplicateTraceRetrieveResults: Map<string, unknown>
    docsLedger: TurnDocsLedger
  }): { events: AsyncIterable<ToolLifecycleEvent>; done: Promise<{ results: ToolExecutionResult[]; countedToolCalls: number; budgetExhausted: boolean }> } {
    const queue = new AsyncEventQueue<ToolLifecycleEvent>()
    const done = (async () => {
      const results = new Map<string, ToolExecutionResult>()
      let countedToolCalls = 0
      let budgetExhausted = false
      const runnable: NormalizedToolCall[] = []

      for (const toolCall of input.toolCalls) {
        const countsTowardBudget = toolCall.toolName !== "context_disposition"
        if (countsTowardBudget && countedToolCalls >= input.remainingBudget) {
          budgetExhausted = true
          const error = new SocratesError("tool_budget_exhausted", "The per-turn tool-call budget was exhausted.")
          queue.push({
            type: "tool.call.failed",
            toolCallId: toolCall.toolCallId,
            providerToolCallId: toolCall.providerToolCallId,
            toolName: toolCall.toolName,
            error,
          })
          results.set(toolCall.toolCallId, toolErrorResult(toolCall, error))
          continue
        }
        if (countsTowardBudget) countedToolCalls += 1
        runnable.push(toolCall)
      }

      const parallel = runnable.filter((toolCall) => input.capabilitySet.get(toolCall.toolName)?.executeLane === "parallel")
      const mutation = runnable.filter((toolCall) => input.capabilitySet.get(toolCall.toolName)?.executeLane !== "parallel")

      for (let index = 0; index < parallel.length; index += input.maxParallelToolCalls) {
        const chunk = parallel.slice(index, index + input.maxParallelToolCalls)
        const chunkResults = await Promise.all(
          chunk.map((toolCall) => this.executeOneToolCall(toolCall, input.capabilitySet, input.context, queue, input.duplicateTraceRetrieveResults, input.docsLedger)),
        )
        for (const result of chunkResults) {
          results.set(result.toolCallId, result)
        }
      }

      for (const toolCall of mutation) {
        const result = await this.executeOneToolCall(toolCall, input.capabilitySet, input.context, queue, input.duplicateTraceRetrieveResults, input.docsLedger)
        results.set(result.toolCallId, result)
      }

      queue.close()
      return {
        results: input.toolCalls.map((toolCall) => results.get(toolCall.toolCallId) ?? toolErrorResult(toolCall, new SocratesError("tool_not_executed", "Tool was not executed."))),
        countedToolCalls,
        budgetExhausted,
      }
    })().catch((error) => {
      queue.close()
      throw error
    })

    return { events: queue, done }
  }

  async runPreTurnMemoryLoop(
    input: SocratesAgentTurnInput,
    messages: ModelMessage[],
    docsLedger: TurnDocsLedger,
  ): Promise<MemoryLoopRunResult> {
    if (!input.stableCachePreludeSnapshot && !canLoadStableCachePrelude(input, this.baseCapabilities)) {
      return emptyMemoryLoopRunResult()
    }

    const events: ToolLifecycleEvent[] = []
    const records: MemoryLoopToolRecord[] = []
    if (!input.stableCachePreludeSnapshot) {
      for (const request of stablePreludeRecallRequests()) {
        const record = await this.executeMemoryLoopTool(input, docsLedger, request)
        events.push(...record.events)
        records.push(record)
      }
    }
    const stableCachePreludeMessage = input.stableCachePreludeSnapshot
      ? renderStableCachePreludeSnapshot(input.stableCachePreludeSnapshot)
      : renderStableCachePrelude(records)

    if (!canRunMemoryLoop(this.provider, input, this.baseCapabilities)) {
      return {
        events: [],
        records,
        ...(input.activeGoal ? { activeGoal: input.activeGoal } : {}),
        ...(stableCachePreludeMessage ? { stableCachePreludeMessage } : {}),
      }
    }

    try {
      const route = await this.memoryRouterAgent.routePreTurn(memoryRouterBaseInput(input, messages))
      const skipped: string[] = []

      for (const request of routedPreTurnRecallRequests(route)) {
        const record = await this.executeMemoryLoopTool(input, docsLedger, request)
        events.push(...record.events)
        records.push(record)
      }

      const activeGoal: ActiveGoalCard | undefined = input.activeGoal
      const summary = summarizeMemoryLoop("pre_turn", route, records, skipped)
      const dynamicRecords = records.filter((record) => !isStableCachePreludeRecord(record))
      const memoryDeveloperMessage = renderMemoryLoopDeveloperMessage("pre_turn", route, dynamicRecords, skipped, {
        stableCachePreludeApplied: Boolean(stableCachePreludeMessage),
      })
      return {
        events,
        summary,
        records,
        ...(activeGoal ? { activeGoal } : {}),
        ...(stableCachePreludeMessage ? { stableCachePreludeMessage } : {}),
        developerMessage: memoryDeveloperMessage,
      }
    } catch (error) {
      const normalized = normalizeError(error)
      const warning = memoryLoopWarning("pre_turn", `${normalized.code}: ${normalized.message}`)
      const activeGoal = input.activeGoal
      return {
        ...warning,
        events: [...events, ...warning.events],
        records,
        ...(activeGoal ? { activeGoal } : {}),
        ...(stableCachePreludeMessage ? { stableCachePreludeMessage } : {}),
      }
    }
  }

  private async executeMemoryLoopTool(
    input: SocratesAgentTurnInput,
    docsLedger: TurnDocsLedger,
    request: { toolName: ToolName; input: unknown },
  ): Promise<MemoryLoopToolRecord> {
    if (!input.toolExecutors || !input.workspacePath || !input.requestApproval) {
      const error = new SocratesError("memory_loop_tool_context_unavailable", "Memory loop tool execution requires tools, workspacePath, and approval handler.", {
        recoverable: true,
      })
      const toolCallId = createId("tcall")
      return {
        toolName: request.toolName,
        input: request.input,
        events: [],
        result: toolErrorResult({ toolCallId, toolName: request.toolName, input: request.input }, error),
      }
    }

    const queue = new AsyncEventQueue<ToolLifecycleEvent>()
    const toolCall: NormalizedToolCall = {
      toolCallId: createId("tcall"),
      toolName: request.toolName,
      input: request.input,
    }
    const done = this.executeOneToolCall(
      toolCall,
      this.baseCapabilities,
      {
        projectId: input.projectId ?? "",
        conversationId: input.conversationId ?? "",
        sessionId: input.sessionId ?? "",
        turnId: input.turnId ?? "",
        workspacePath: input.workspacePath,
        runtimeConfig: input.runtimeConfig,
        executors: input.toolExecutors,
        requestApproval: input.requestApproval,
        ...(input.fileFreshness ? { fileFreshness: input.fileFreshness } : {}),
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      },
      queue,
      new Map(),
      docsLedger,
    ).finally(() => queue.close())
    const events: ToolLifecycleEvent[] = []
    for await (const event of queue) {
      events.push(event)
    }
    const result = await done
    return { toolName: request.toolName, input: request.input, events, result }
  }

  private async executeOneToolCall(
    toolCall: NormalizedToolCall,
    capabilitySet: CapabilitySet,
    context: ToolRuntimeContext,
    queue: AsyncEventQueue<ToolLifecycleEvent>,
    duplicateTraceRetrieveResults: Map<string, unknown>,
    docsLedger: TurnDocsLedger,
  ): Promise<ToolExecutionResult> {
    const startedAt = Date.now()
    const tool = capabilitySet.get(toolCall.toolName)
    if (!tool) {
      const error = new SocratesError("tool_not_found", "Tool is not registered", { details: { toolName: toolCall.toolName } })
      queue.push({
        type: "tool.call.failed",
        toolCallId: toolCall.toolCallId,
        providerToolCallId: toolCall.providerToolCallId,
        toolName: toolCall.toolName,
        error,
        modelCallId: context.modelCallId,
        stepIndex: context.stepIndex,
      })
      return toolErrorResult(toolCall, error)
    }

    const parsed = tool.inputSchema.safeParse(toolCall.input)
    if (!parsed.success) {
      const error = new SocratesError("invalid_tool_input", "Tool input did not match the schema", {
        details: parsed.error.flatten(),
      })
      queue.push({
        type: "tool.call.failed",
        toolCallId: toolCall.toolCallId,
        providerToolCallId: toolCall.providerToolCallId,
        toolName: toolCall.toolName,
        error,
        modelCallId: context.modelCallId,
        stepIndex: context.stepIndex,
      })
      return toolErrorResult(toolCall, error)
    }

    if (requiresActionDocsPreflight(tool.name) && !docsLedger.hasActionPreflight()) {
      const error = docsPreflightError(tool.name, docsLedger.missingActionPreflight())
      queue.push({
        type: "tool.call.failed",
        toolCallId: toolCall.toolCallId,
        providerToolCallId: toolCall.providerToolCallId,
        toolName: tool.name,
        error,
        modelCallId: context.modelCallId,
        stepIndex: context.stepIndex,
      })
      return toolErrorResult(toolCall, error)
    }

    const duplicateTraceRetrieveKey = tool.name === "trace_retrieve" ? stableToolInputKey(tool.name, parsed.data) : undefined
    if (duplicateTraceRetrieveKey) {
      const duplicateOutput = duplicateTraceRetrieveResults.get(duplicateTraceRetrieveKey)
      if (duplicateOutput !== undefined) {
        const output = addDuplicateTraceRetrieveWarning(duplicateOutput)
        const parsedOutput = tool.resultSchema.parse(output)
        queue.push({
          type: "tool.call.started",
          toolCallId: toolCall.toolCallId,
          providerToolCallId: toolCall.providerToolCallId,
          toolName: tool.name,
          category: tool.category,
          displayName: tool.displayName ?? tool.name,
          argsPreview: previewJson(parsed.data),
          input: parsed.data,
          requiresApproval: false,
          modelCallId: context.modelCallId,
          stepIndex: context.stepIndex,
        })
        queue.push({
          type: "tool.call.completed",
          toolCallId: toolCall.toolCallId,
          providerToolCallId: toolCall.providerToolCallId,
          toolName: tool.name,
          output: parsedOutput,
          summary: tool.summary(parsedOutput),
          resultPreview: tool.resultPreview(parsedOutput),
          ...(tool.metrics ? { metrics: tool.metrics(parsedOutput) } : {}),
          durationMs: Date.now() - startedAt,
          modelCallId: context.modelCallId,
          stepIndex: context.stepIndex,
        })
        return {
          toolCallId: toolCall.toolCallId,
          providerToolCallId: toolCall.providerToolCallId,
          toolName: tool.name,
          ok: true,
          output: parsedOutput,
        }
      }
    }

    try {
      const policy = await tool.decidePolicy(parsed.data, context)
      queue.push({
        type: "tool.call.started",
        toolCallId: toolCall.toolCallId,
        providerToolCallId: toolCall.providerToolCallId,
        toolName: tool.name,
        category: tool.category,
        displayName: tool.displayName ?? tool.name,
        argsPreview: previewJson(parsed.data),
        input: parsed.data,
        requiresApproval: policy.type === "approval_required",
        modelCallId: context.modelCallId,
        stepIndex: context.stepIndex,
      })

      if (policy.type === "denied") {
        throw new SocratesError(policy.code ?? "tool_denied", policy.reason, {
          ...(policy.details !== undefined ? { details: policy.details } : {}),
          ...(policy.recoverable !== undefined ? { recoverable: policy.recoverable } : {}),
        })
      }

      if (requiresDocsPreflightAfterPolicy(tool, policy) && !docsLedger.hasActionPreflight()) {
        throw docsPreflightError(tool.name, docsLedger.missingActionPreflight())
      }

      if (policy.type === "approval_required") {
        const approvalId = createId("appr")
        const request: ApprovalRequest = {
          approvalId,
          toolCallId: toolCall.toolCallId,
          providerToolCallId: toolCall.providerToolCallId,
          toolName: tool.name,
          ...policy.request,
        }
        queue.push({ type: "approval.requested", request })
        const decision = await context.requestApproval(request)
        queue.push({
          type: "approval.resolved",
          approvalId,
          toolCallId: toolCall.toolCallId,
          providerToolCallId: toolCall.providerToolCallId,
          decision: decision.decision,
        })
        if (decision.decision !== "approved") {
          throw new SocratesError("tool_approval_rejected", decision.reason ?? "The user rejected this tool call.")
        }
      }

      const output = await tool.execute(parsed.data, {
        ...context,
        toolCallId: toolCall.toolCallId,
        onOutput: (output) =>
          queue.push({
            type: "tool.call.output",
            toolCallId: toolCall.toolCallId,
            providerToolCallId: toolCall.providerToolCallId,
            modelCallId: context.modelCallId,
            stepIndex: context.stepIndex,
            ...output,
          }),
      })
      const parsedOutput = tool.resultSchema.safeParse(output)
      if (!parsedOutput.success) {
        throw new SocratesError("invalid_tool_output", "Tool output did not match the schema", {
          details: parsedOutput.error.flatten(),
        })
      }
      if (duplicateTraceRetrieveKey) {
        duplicateTraceRetrieveResults.set(duplicateTraceRetrieveKey, parsedOutput.data)
      }
      docsLedger.recordImmediatePreflight({
        toolCallId: toolCall.toolCallId,
        providerToolCallId: toolCall.providerToolCallId,
        toolName: tool.name,
        ok: true,
        output: parsedOutput.data,
      }, toolCall)
      queue.push({
        type: "tool.call.completed",
        toolCallId: toolCall.toolCallId,
        providerToolCallId: toolCall.providerToolCallId,
        toolName: tool.name,
        output: parsedOutput.data,
        summary: tool.summary(parsedOutput.data),
        resultPreview: tool.resultPreview(parsedOutput.data),
        ...(tool.metrics ? { metrics: tool.metrics(parsedOutput.data) } : {}),
        durationMs: Date.now() - startedAt,
        modelCallId: context.modelCallId,
        stepIndex: context.stepIndex,
      })
      return {
        toolCallId: toolCall.toolCallId,
        providerToolCallId: toolCall.providerToolCallId,
        toolName: tool.name,
        ok: true,
        output: parsedOutput.data,
      }
    } catch (error) {
      const normalized = normalizeError(error)
      queue.push({
        type: "tool.call.failed",
        toolCallId: toolCall.toolCallId,
        providerToolCallId: toolCall.providerToolCallId,
        toolName: tool.name,
        error: normalized,
        modelCallId: context.modelCallId,
        stepIndex: context.stepIndex,
      })
      return toolErrorResult(toolCall, normalized)
    }
  }

}
