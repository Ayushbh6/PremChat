import { toolExecutionResultSchema, type NormalizedToolCall, type ToolExecutionResult } from "@socrates/contracts"
import { DEFAULT_MODEL_OUTPUT_TOKEN_LIMIT, MAX_MODEL_OUTPUT_TOKEN_LIMIT, resolveModelOutputCharLimit } from "@socrates/shared"


export const sanitizeToolExecutionResultForModel = (result: ToolExecutionResult, modelToolCallId: string): ToolExecutionResult => {
  if (result.ok) {
    return toolExecutionResultSchema.parse({
      toolCallId: modelToolCallId,
      toolName: result.toolName,
      ok: true,
      output: compactModelToolOutput(
        result.toolName,
        sanitizeModelVisibleValue(result.output, { preserveTraceRetrieveIds: result.toolName === "trace_retrieve" }),
      ),
    })
  }
  return toolExecutionResultSchema.parse({
    toolCallId: modelToolCallId,
    toolName: result.toolName,
    ok: false,
    error: result.error
      ? {
          code: result.error.code,
          message: result.error.message,
          ...(result.error.details === undefined ? {} : { details: sanitizeModelVisibleValue(result.error.details) }),
        }
      : undefined,
  })
}

export const compactModelToolOutput = (toolName: string, output: unknown): unknown => {
  const dynamicMcp = toolName.startsWith("mcp__")
  const projected = dynamicMcp ? removeDynamicBinaryPayloads(output) : output
  const serialized = safeSerialize(projected)
  const charLimit = resolveModelOutputCharLimit({
    tokenLimit: dynamicMcp ? DEFAULT_MODEL_OUTPUT_TOKEN_LIMIT : MAX_MODEL_OUTPUT_TOKEN_LIMIT,
    defaultTokenLimit: dynamicMcp ? DEFAULT_MODEL_OUTPUT_TOKEN_LIMIT : MAX_MODEL_OUTPUT_TOKEN_LIMIT,
  })
  if (serialized.length <= charLimit) return projected
  const envelope = (preview: string) => ({
    truncated: true,
    kind: dynamicMcp ? "dynamic_mcp_result_preview" : "tool_result_preview",
    preview,
    truncation: {
      charLimit,
      originalLength: serialized.length,
      returnedLength: preview.length,
    },
    recovery: "The exact result is persisted in the tool audit. Use its R-number if shown, or trace_retrieve audit/inspect after this turn.",
  })
  let low = 0
  let high = serialized.length
  while (low < high) {
    const candidate = Math.ceil((low + high) / 2)
    if (safeSerialize(envelope(serialized.slice(0, candidate))).length <= charLimit) low = candidate
    else high = candidate - 1
  }
  return envelope(serialized.slice(0, low))
}

const removeDynamicBinaryPayloads = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(removeDynamicBinaryPayloads)
  if (!value || typeof value !== "object") return value
  const source = value as Record<string, unknown>
  const media = source.type === "image" || source.type === "audio" || source.type === "resource"
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(source)) {
    if (media && (key === "data" || key === "blob") && typeof child === "string") {
      result[key] = `[binary payload omitted; ${child.length} encoded characters retained in exact audit]`
    } else {
      result[key] = removeDynamicBinaryPayloads(child)
    }
  }
  return result
}

const safeSerialize = (value: unknown): string => {
  try {
    return typeof value === "string" ? value : JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export const sanitizeModelVisibleValue = (value: unknown, options: { preserveTraceRetrieveIds?: boolean } = {}): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeModelVisibleValue(item, options))
  }
  if (!value || typeof value !== "object") {
    return value
  }
  const record = value as Record<string, unknown>
  const sanitized: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(record)) {
    if (isRuntimeOwnedModelKey(key, options)) {
      continue
    }
    if (key === "source" && child && typeof child === "object" && "id" in child) {
      continue
    }
    sanitized[key] = sanitizeModelVisibleValue(child, options)
  }
  return sanitized
}

export const isRuntimeOwnedModelKey = (key: string, options: { preserveTraceRetrieveIds?: boolean } = {}): boolean => {
  if (options.preserveTraceRetrieveIds && (key === "conversationId" || key === "turnId" || key === "messageId" || key === "toolId")) {
    return false
  }
  return (
    key === "id" ||
    key === "ids" ||
    key === "handle" ||
    key === "sourceId" ||
    key === "sourceIds" ||
    key === "inspectArgs" ||
    key === "projectId" ||
    key === "conversationId" ||
    key === "conversationIds" ||
    key === "sessionId" ||
    key === "turnId" ||
    key === "messageId" ||
    key === "toolCallId" ||
    key === "terminalId" ||
    key === "processId" ||
    key === "outputSequence" ||
    key === "nextOutputSequence" ||
    key === "systemPid" ||
    key === "serverId" ||
    key === "configId" ||
    key === "providerId" ||
    key === "modelCallId" ||
    key.endsWith("Id") ||
    key.endsWith("Ids")
  )
}

export const addDuplicateTraceRetrieveWarning = (output: unknown): unknown => {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return output
  }
  const cloned = JSON.parse(JSON.stringify(output)) as Record<string, unknown>
  const warnings = Array.isArray(cloned.warnings) ? cloned.warnings.filter((item): item is string => typeof item === "string") : []
  cloned.warnings = [
    ...warnings,
    "Identical trace_retrieve input already ran earlier in this turn; this cached result was returned. Inspect a resultNumber or change the query, filters, or scope instead of repeating the same search.",
  ]
  return cloned
}

export const normalizedToolTargetKey = (toolCall: NormalizedToolCall): string | undefined => {
  const input = toolCall.input && typeof toolCall.input === "object" && !Array.isArray(toolCall.input) ? toolCall.input as Record<string, unknown> : {}
  if (toolCall.toolName === "read") {
    return typeof input.path === "string" ? `read:${normalizePathKey(input.path)}` : undefined
  }
  if (toolCall.toolName === "search") {
    const mode = typeof input.mode === "string" ? input.mode : "unknown"
    const query = typeof input.query === "string" ? normalizeTextKey(input.query) : ""
    const searchPath = typeof input.path === "string" ? normalizePathKey(input.path) : ""
    return `search:${mode}:${searchPath}:${query}`
  }
  if (toolCall.toolName === "bash") {
    const operation = typeof input.operation === "string" ? input.operation : "run"
    const command = typeof input.command === "string" ? normalizeTextKey(input.command).slice(0, 200) : ""
    const cwd = typeof input.cwd === "string" ? normalizePathKey(input.cwd) : ""
    return command ? `bash:${operation}:${cwd}:${command}` : undefined
  }
  if (toolCall.toolName === "edit") {
    return typeof input.path === "string" ? `edit:${normalizePathKey(input.path)}` : undefined
  }
  if (toolCall.toolName === "apply_patch") {
    const patchText = typeof input.patchText === "string" ? input.patchText : ""
    const patchPath = firstPatchPath(patchText)
    return patchPath ? `apply_patch:${normalizePathKey(patchPath)}` : `apply_patch:${normalizeTextKey(patchText).slice(0, 200)}`
  }
  return undefined
}

export const toolCallTargetPreview = (toolCall: NormalizedToolCall): string => {
  const key = normalizedToolTargetKey(toolCall)
  return key ? `[${key}]` : previewJson(toolCall.input)
}

export const mutationTargetFor = (toolCall: NormalizedToolCall): string => {
  const input = toolCall.input && typeof toolCall.input === "object" && !Array.isArray(toolCall.input) ? toolCall.input as Record<string, unknown> : {}
  if (typeof input.path === "string") {
    return normalizePathKey(input.path)
  }
  const patchText = typeof input.patchText === "string" ? input.patchText : ""
  return firstPatchPath(patchText) ?? "unknown target"
}

export const firstPatchPath = (patchText: string): string | undefined => {
  const match = /^(?:\*\*\* (?:Update|Delete) File:|\*\*\* Add File:|\*\*\* Move to:)\s+(.+)$/m.exec(patchText)
  return match?.[1]?.trim()
}

export const normalizePathKey = (value: string): string => value.trim().replaceAll("\\", "/").replace(/\/+/g, "/").replace(/^\.\//, "")

export const normalizeTextKey = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase()

export const stableToolInputKey = (toolName: string, input: unknown): string => `${toolName}:${stableJsonStringify(input)}`

export const stableJsonStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(",")}]`
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJsonStringify(child)}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "undefined"
}

export const previewJson = (value: unknown): string => {
  const text = JSON.stringify(value)
  if (!text) {
    return ""
  }
  return text.length > 500 ? `${text.slice(0, 500)}...` : text
}

// Pulls a human-friendly hint out of partially streamed tool-call argument text so
// the UI can show "Editing <file>" / "Running <command>" before the call is fully parsed.
export const extractStreamingPreview = (
  toolName: string,
  argsText: string,
): { pathPreview?: string; argsPreview?: string } => {
  const readField = (field: string): string | undefined => {
    const match = argsText.match(new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`))
    if (!match) {
      return undefined
    }
    try {
      return JSON.parse(`"${match[1]}"`) as string
    } catch {
      return match[1]
    }
  }

  if (toolName === "bash") {
    const command = readField("command")
    return command ? { argsPreview: command } : {}
  }

  const path = readField("path")
  if (path) {
    return { pathPreview: path, argsPreview: path }
  }
  return {}
}
