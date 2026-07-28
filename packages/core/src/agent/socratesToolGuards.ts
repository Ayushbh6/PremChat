import {
  toolExecutionResultSchema,
  type NormalizedToolCall,
  type ToolExecutionResult,
} from "@socrates/contracts"
import { SocratesError } from "@socrates/shared"

export const isConfirmedToolErrorResult = (result: ToolExecutionResult): boolean =>
  result.ok === false
  && typeof result.error?.code === "string"
  && result.error.code.length > 0
  && typeof result.error.message === "string"
  && result.error.message.length > 0

const TOOL_DOCS_FAILURE_NUDGE = "Read or search socrates://tool-guidance for current usage before retrying this tool or choosing another tool."

export const toolErrorResult = (toolCall: NormalizedToolCall, error: SocratesError): ToolExecutionResult =>
  toolExecutionResultSchema.parse({
    toolCallId: toolCall.toolCallId,
    providerToolCallId: toolCall.providerToolCallId,
    toolName: toolCall.toolName,
    ok: false,
    error: {
      code: error.code,
      message: `${error.message}\n\n${TOOL_DOCS_FAILURE_NUDGE}`,
      details: error.details,
    },
  })

export const interactiveTerminalAwaitingInput = (results: ToolExecutionResult[]): string | undefined => {
  for (const result of results) {
    if (!result.ok || result.toolName !== "bash" || !result.output || typeof result.output !== "object") continue
    const terminal = "terminal" in result.output ? result.output.terminal : undefined
    if (!terminal || typeof terminal !== "object") continue
    const name = "name" in terminal ? terminal.name : undefined
    const awaitingInput = "awaitingInput" in terminal ? terminal.awaitingInput : undefined
    if (awaitingInput === true && typeof name === "string" && name.trim()) return name.trim()
  }
  return undefined
}
