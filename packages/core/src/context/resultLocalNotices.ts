import type { ModelMessage, ModelMessagePart } from "@socrates/providers"

export type ResultLocalNotice = Readonly<{
  kind: "large_result_release" | "socrates_reconciliation"
  key: string
  text: string
}>

type ToolResultPart = Extract<ModelMessagePart, { type: "tool-result" }>

export const appendResultLocalNotice = (part: ToolResultPart, notice: ResultLocalNotice): void => {
  const output: Record<string, unknown> = part.output && typeof part.output === "object" && !Array.isArray(part.output)
    ? { ...(part.output as Record<string, unknown>) }
    : { value: part.output }
  const current = Array.isArray(output.runtimeNotices)
    ? output.runtimeNotices.filter(isResultLocalNotice)
    : []
  output.runtimeNotices = [...current.filter((item) => !(item.kind === notice.kind && item.key === notice.key)), notice]
  part.output = output
}

export const removeResultLocalNotice = (
  part: ToolResultPart,
  kind: ResultLocalNotice["kind"],
  key: string,
): void => {
  if (!part.output || typeof part.output !== "object" || Array.isArray(part.output)) return
  const output = { ...(part.output as Record<string, unknown>) }
  if (!Array.isArray(output.runtimeNotices)) return
  const remaining = output.runtimeNotices
    .filter(isResultLocalNotice)
    .filter((item) => !(item.kind === kind && item.key === key))
  if (remaining.length > 0) output.runtimeNotices = remaining
  else delete output.runtimeNotices
  part.output = output
}

export const appendNoticeToLastSuccessfulToolResult = (
  message: ModelMessage,
  notice: ResultLocalNotice,
): boolean => {
  if (message.role !== "tool" || !Array.isArray(message.content)) return false
  const parts = message.content.filter((part): part is ToolResultPart => part.type === "tool-result")
  const target = [...parts].reverse().find((part) => isSuccessfulToolResult(part.output))
  if (!target) return false
  appendResultLocalNotice(target, notice)
  return true
}

const isResultLocalNotice = (value: unknown): value is ResultLocalNotice => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (record.kind === "large_result_release" || record.kind === "socrates_reconciliation")
    && typeof record.key === "string"
    && typeof record.text === "string"
}

const isSuccessfulToolResult = (value: unknown): boolean =>
  Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).ok === true)
