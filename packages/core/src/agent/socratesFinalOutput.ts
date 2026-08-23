import { socratesFinalAnswerSchema, type SocratesFinalAnswer } from "@socrates/contracts"
import { SocratesError } from "@socrates/shared"

export const parseSocratesFinalOutput = (text: string): SocratesFinalAnswer => {
  const trimmed = text.trim()
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    const isolatedObject = extractSingleJsonObject(trimmed)
    if (!isolatedObject) {
      throw invalidFinalOutput("The foreground loop ended without a complete JSON final object.", trimmed)
    }
    try {
      value = JSON.parse(isolatedObject)
    } catch {
      throw invalidFinalOutput("The foreground loop ended without a complete JSON final object.", trimmed)
    }
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

// Some OpenAI-compatible providers add a short preamble or a stray non-object
// token even when given an explicit JSON-only contract alongside native tools.
// Accept exactly one complete top-level object, then apply the same strict
// schema; never expose or persist the provider noise as part of the answer.
const extractSingleJsonObject = (text: string): string | undefined => {
  let inString = false
  let escaped = false
  let depth = 0
  let start = -1
  let isolatedObject: string | undefined

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === "{") {
      if (depth === 0) start = index
      depth += 1
      continue
    }
    if (character !== "}") continue
    depth -= 1
    if (depth < 0) return undefined
    if (depth === 0 && start >= 0) {
      if (isolatedObject) return undefined
      isolatedObject = text.slice(start, index + 1)
      start = -1
    }
  }

  return depth === 0 && !inString ? isolatedObject : undefined
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
