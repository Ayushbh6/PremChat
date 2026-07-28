import { socratesFinalAnswerSchema, type SocratesFinalAnswer } from "@socrates/contracts"
import { SocratesError } from "@socrates/shared"

export const parseSocratesFinalOutput = (text: string): SocratesFinalAnswer => {
  const trimmed = text.trim()
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    throw invalidFinalOutput("The foreground loop ended without a complete JSON final object.", trimmed)
  }
  const parsed = socratesFinalAnswerSchema.safeParse(value)
  if (!parsed.success) {
    throw new SocratesError(
      "structured_agent_output_invalid",
      "The foreground loop final object failed validation.",
      {
        recoverable: true,
        details: {
          validation: parsed.error.flatten(),
          outputPreview: trimmed.slice(0, 2_000),
        },
      },
    )
  }
  return parsed.data
}

export const assertCompleteModelStep = (input: {
  streamedToolCallIds: ReadonlySet<string>
  completedToolCallIds: ReadonlySet<string>
  finishReason?: string
}): void => {
  const incomplete = [...input.streamedToolCallIds].filter((id) => !input.completedToolCallIds.has(id))
  if (incomplete.length > 0) {
    throw new SocratesError(
      "model_tool_call_truncated",
      "The model response ended before one or more tool calls were complete. No partial tool call was executed.",
      { recoverable: true, details: { incompleteToolCalls: incomplete.length } },
    )
  }
  if (["length", "max_tokens", "max_output_tokens"].includes(input.finishReason ?? "")) {
    throw new SocratesError(
      "model_output_truncated",
      "The model response reached its output limit before completion. No partial final answer or tool batch was accepted.",
      { recoverable: true },
    )
  }
}

const invalidFinalOutput = (message: string, text: string): SocratesError => new SocratesError(
  "structured_agent_output_invalid",
  message,
  { recoverable: true, details: { outputPreview: text.slice(0, 2_000) } },
)
