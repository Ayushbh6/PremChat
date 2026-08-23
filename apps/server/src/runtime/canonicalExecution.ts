import type { ApprovalRequest, SocratesAgent, SocratesAgentTurnInput, ToolExecutors } from "@socrates/core"
import type { FilesystemAuthorizationSnapshot, RuntimeConfig } from "@socrates/contracts"
import { SocratesError } from "@socrates/shared"
import type { ModelMessage } from "@socrates/providers"
import { CanonicalSocratesStore, type CanonicalTask } from "../services/canonical/canonicalSocratesStore"

/** Canonical foreground finalization. Tool and Terminal handlers plug into this
 * event loop; they do not own a second transcript or finalization path. */
export const executeCanonicalTask = async (input: {
  store: CanonicalSocratesStore
  agent: Pick<SocratesAgent, "streamTurn">
  task: CanonicalTask
  goalId: string
  userMessage: string
  runtimeConfig: RuntimeConfig
  workspacePath: string
  filesystemAuthorization?: FilesystemAuthorizationSnapshot
  toolExecutors?: ToolExecutors
  fileFreshness?: SocratesAgentTurnInput["fileFreshness"]
  streamInput?: Partial<SocratesAgentTurnInput>
  abortSignal?: AbortSignal
  onActivity?: (event: { phase: "working" | "tool" | "waiting" | "finalizing" | "failed"; sentence: string }) => void
  onApprovalRequested?: (request: ApprovalRequest) => void
}): Promise<CanonicalTask> => {
  const messages: ModelMessage[] = [{ role: "user", content: input.userMessage }]
  let finalAnswer: string | undefined
  let finalization: { state?: string; note?: string } | undefined
  const agentInput: SocratesAgentTurnInput = {
    providerId: input.runtimeConfig.providerId,
    modelId: input.runtimeConfig.modelId,
    runtimeConfig: input.runtimeConfig,
    messages,
    workspacePath: input.workspacePath,
    turnId: input.task.id,
    taskOrdinal: input.task.ordinal,
    completionMode: "main_structured",
    createModelCall: (request) => input.store.beginModelCall({
      taskId: input.task.id,
      role: "main",
      providerId: request.providerId,
      modelId: request.modelId,
      request: { estimatedTokens: request.estimatedTokens, messageCount: request.messages.length, tools: request.tools.map((tool) => tool.name) },
    }),
    ...(input.filesystemAuthorization ? { filesystemAuthorization: input.filesystemAuthorization } : {}),
    ...(input.toolExecutors ? { toolExecutors: input.toolExecutors } : {}),
    ...(input.fileFreshness ? { fileFreshness: input.fileFreshness } : {}),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    ...input.streamInput,
  }
  try {
  input.onActivity?.({ phase: "working", sentence: "Socrates is working." })
  for await (const event of input.agent.streamTurn(agentInput)) {
    if (event.type === "agent.final_result") {
      finalAnswer = event.result.finalAnswer
      finalization = event.result.goalFinalization
    } else if (event.type === "tool.call.started") {
      input.onActivity?.({ phase: "tool", sentence: toolActivitySentence(event.toolName) })
      input.store.startToolCall({ id: event.toolCallId, taskId: input.task.id, name: event.toolName, ...(event.modelCallId ? { modelCallId: event.modelCallId } : {}), ...(event.input !== undefined ? { toolInput: event.input as Record<string, unknown> } : {}), requiresApproval: event.requiresApproval })
    } else if (event.type === "tool.call.completed") {
      input.store.completeToolCall({ id: event.toolCallId, output: event.output as Record<string, unknown>, evidence: { summary: event.summary, ...(event.resultPreview ? { resultPreview: event.resultPreview } : {}) } })
    } else if (event.type === "tool.call.failed") {
      input.store.failToolCall({ id: event.toolCallId, error: { code: event.error.code, message: event.error.message, recoverable: event.error.recoverable } })
    } else if (event.type === "approval.requested") {
      input.onActivity?.({ phase: "waiting", sentence: "Socrates needs your approval." })
      if (input.onApprovalRequested) input.onApprovalRequested(event.request)
      else input.store.createInteraction({
        taskId: input.task.id,
        kind: event.request.toolName === "handover_to_frontier" ? "frontier_approval" : "approval",
        toolCallId: event.request.toolCallId,
        fingerprint: `${event.request.toolName}:${event.request.actionPreview}`,
        prompt: event.request.title,
        publicPayload: {
          toolName: event.request.toolName,
          actionKind: event.request.actionKind,
          actionPreview: event.request.actionPreview,
          risk: event.request.risk,
          ...(event.request.description ? { description: event.request.description } : {}),
        },
      })
    } else if (event.type === "model.completed" && event.modelCallId) {
      input.store.completeModelCall({ id: event.modelCallId, ...(event.usage ? { usage: event.usage } : {}), response: { finishReason: event.finishReason ?? "completed" } })
    } else if (event.type === "model.failed" && event.modelCallId) {
      input.store.completeModelCall({ id: event.modelCallId, error: { message: event.error.message } })
    }
  }
  if (input.abortSignal?.aborted) {
    input.onActivity?.({ phase: "failed", sentence: "Socrates stopped this task." })
    return input.store.finishTaskWithError({ taskId: input.task.id, status: "cancelled", error: { code: "task_cancelled", message: "The task was cancelled." } })
  }
  if (!finalAnswer) throw new SocratesError("agent_final_result_missing", "Socrates completed without a validated final result.", { recoverable: true })
  input.onActivity?.({ phase: "finalizing", sentence: "Socrates is finalizing the answer." })
  return input.store.finalizeTask({
    taskId: input.task.id,
    answer: finalAnswer,
    ...(finalization ? { capsule: { ...(finalization.state ? { state: finalization.state } : {}), ...(finalization.note ? { summary: finalization.note } : {}) } } : {}),
  })
  } catch (error) {
    const normalized = error instanceof SocratesError
      ? { code: error.code, message: error.message, recoverable: error.recoverable }
      : { code: "task_execution_failed", message: error instanceof Error ? error.message : String(error), recoverable: true }
    input.store.finishTaskWithError({ taskId: input.task.id, status: "failed", error: normalized })
    input.onActivity?.({ phase: "failed", sentence: "Socrates could not complete this task." })
    throw error
  }
}

const toolActivitySentence = (name: string): string => {
  const labels: Record<string, string> = {
    read: "Socrates is reading relevant material.",
    search: "Socrates is searching relevant material.",
    edit: "Socrates is preparing an edit.",
    apply_patch: "Socrates is preparing a patch.",
    bash: "Socrates is using Terminal.",
    wait: "Socrates is waiting for work to finish.",
    memory_note: "Socrates is recording a useful memory note.",
    capability_manager: "Socrates is managing a capability.",
    handover_to_frontier: "Socrates is requesting Frontier approval.",
  }
  return labels[name] ?? "Socrates is using a capability."
}
