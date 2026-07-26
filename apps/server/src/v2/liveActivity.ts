import path from "node:path"
import {
  v2LiveActivitySchema,
  type V2LiveActivity,
  type V2LiveActivityPhase,
  type V2Terminal,
  type V2ToolCall,
  type V2Turn,
} from "@socrates/contracts"

const MAX_TARGET_LENGTH = 64

export const createV2LiveActivity = (
  turnId: string,
  phase: V2LiveActivityPhase,
  label: string,
): V2LiveActivity => v2LiveActivitySchema.parse({ turnId, phase, label })

export const v2ToolActivity = (turnId: string, toolName: string, input: unknown): V2LiveActivity => {
  const record = asRecord(input)
  const target = safeTarget(record.path ?? record.filePath)
  const label = (() => {
    switch (toolName) {
      case "read":
        return target ? `Reading ${target}…` : "Reading a workspace file…"
      case "search":
        return target ? `Searching ${target}…` : "Searching the workspace…"
      case "trace_retrieve":
        return "Retrieving relevant history…"
      case "list_project_resources":
        return "Reviewing project resources…"
      case "edit":
        return target ? `Updating ${target}…` : "Updating a workspace file…"
      case "apply_patch":
        return "Applying the workspace changes…"
      case "bash":
        return "Running a Terminal command…"
      case "project_docs":
      case "repo_docs":
        return "Reviewing the working context…"
      case "skills":
        return "Reviewing available skills…"
      case "mcp_registry":
        return "Checking connected tools…"
      case "handover_to_frontier":
        return "Calling the Frontier model…"
      case "url_fetch":
        return "Reading the requested page…"
      default:
        return toolName.startsWith("mcp__") ? "Using a connected tool…" : "Working with the project tools…"
    }
  })()
  return createV2LiveActivity(turnId, "tool", label)
}

export const fallbackV2LiveActivity = (input: {
  turn: V2Turn
  tools: V2ToolCall[]
  terminals: V2Terminal[]
  hasPendingApproval: boolean
}): V2LiveActivity => {
  if (input.hasPendingApproval) return createV2LiveActivity(input.turn.id, "awaiting_input", "Waiting for your approval…")
  const awaitingTerminal = input.terminals.find((terminal) => terminal.awaitingInput || terminal.status === "awaiting_input")
  if (awaitingTerminal) return createV2LiveActivity(input.turn.id, "awaiting_input", "Waiting for Terminal input…")
  const activeTool = [...input.tools].reverse().find((tool) => ["pending", "awaiting_approval", "running"].includes(tool.status))
  if (activeTool) return v2ToolActivity(input.turn.id, activeTool.toolName, activeTool.arguments)
  if (input.turn.status === "routing") return createV2LiveActivity(input.turn.id, "routing", "Finding the right focus…")
  if (input.turn.status === "awaiting_clarification") return createV2LiveActivity(input.turn.id, "awaiting_input", "Waiting for your focus choice…")
  if (input.turn.status === "waiting") return createV2LiveActivity(input.turn.id, "awaiting_input", "Waiting for Terminal…")
  return createV2LiveActivity(input.turn.id, "thinking", "Thinking through your request…")
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}

const safeTarget = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
  if (!normalized) return undefined
  const leaf = path.basename(normalized.replaceAll("\\", "/"))
  const clean = leaf.replace(/\s+/g, " ").slice(0, MAX_TARGET_LENGTH).trim()
  return clean || undefined
}
