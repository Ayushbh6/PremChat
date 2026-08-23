import path from "node:path"
import {
  socratesLiveActivitySchema,
  type SocratesLiveActivity,
  type SocratesLiveActivityPhase,
  type SocratesTerminal,
  type SocratesToolCall,
  type SocratesTurn,
} from "@socrates/contracts"

const MAX_TARGET_LENGTH = 64

export const createSocratesLiveActivity = (
  turnId: string,
  phase: SocratesLiveActivityPhase,
  label: string,
): SocratesLiveActivity => socratesLiveActivitySchema.parse({ turnId, phase, label })

export const socratesToolActivity = (turnId: string, toolName: string, input: unknown): SocratesLiveActivity => {
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
      case "edit":
        return target ? `Updating ${target}…` : "Updating a workspace file…"
      case "apply_patch":
        return "Applying the workspace changes…"
      case "bash":
        return "Running a Terminal command…"
      case "wait":
        return "Waiting for Terminal work…"
      case "capability_manager":
        return "Managing a connected capability…"
      case "memory_note":
        return "Saving a memory lead…"
      case "context_disposition":
        return "Releasing unneeded working context…"
      case "current_time":
        return "Checking the current time…"
      case "handover_to_frontier":
        return "Calling the Frontier model…"
      case "url_fetch":
        return "Reading the requested page…"
      default:
        return toolName.startsWith("mcp__") ? "Using a connected tool…" : "Working with the project tools…"
    }
  })()
  return createSocratesLiveActivity(turnId, "tool", label)
}

export const fallbackSocratesLiveActivity = (input: {
  turn: SocratesTurn
  tools: SocratesToolCall[]
  terminals: SocratesTerminal[]
  hasPendingApproval: boolean
}): SocratesLiveActivity => {
  if (input.hasPendingApproval) return createSocratesLiveActivity(input.turn.id, "awaiting_input", "Waiting for your approval…")
  const awaitingTerminal = input.terminals.find((terminal) => terminal.awaitingInput || terminal.status === "awaiting_input")
  if (awaitingTerminal) return createSocratesLiveActivity(input.turn.id, "awaiting_input", "Waiting for Terminal input…")
  const activeTool = [...input.tools].reverse().find((tool) => ["pending", "awaiting_approval", "running"].includes(tool.status))
  if (activeTool) return socratesToolActivity(input.turn.id, activeTool.toolName, activeTool.arguments)
  if (input.turn.status === "routing") return createSocratesLiveActivity(input.turn.id, "routing", "Finding the right focus…")
  if (input.turn.status === "awaiting_clarification") return createSocratesLiveActivity(input.turn.id, "awaiting_input", "Waiting for your focus choice…")
  if (input.turn.status === "waiting") return createSocratesLiveActivity(input.turn.id, "awaiting_input", "Waiting for Terminal…")
  return createSocratesLiveActivity(input.turn.id, "thinking", "Thinking through your request…")
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
