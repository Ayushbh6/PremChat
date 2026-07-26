import {
  resolvedTurnContextSchema,
  resolvedTurnContextSeedSchema,
  type ResolvedTurnContext,
  type ResolvedTurnContextSeed,
} from "@socrates/contracts"
import type { ModelMessage } from "@socrates/providers"
import type { ActiveGoalCard } from "./MemoryRouterAgent"
import { memoryLoopSectionContent, type MemoryLoopToolRecord } from "./socratesMemorySupport"

const MAX_HISTORY_ITEMS = 10
const MAX_MEMORY_ITEMS = 8

export const createResolvedTurnContextSeed = (input: {
  projectName?: string
  projectDescription?: string
  goal: ActiveGoalCard
  messages: readonly ModelMessage[]
}): ResolvedTurnContextSeed => {
  const latestUserRequest = [...input.messages].reverse().find((message) => message.role === "user")
  return resolvedTurnContextSeedSchema.parse({
  project: {
    name: input.projectName?.trim() || "Current project",
    ...(input.projectDescription?.trim() ? { description: input.projectDescription.trim() } : {}),
  },
  goal: {
    title: input.goal.title,
    objective: input.goal.objective?.trim() || input.goal.title,
    state: input.goal.state,
    progress: input.goal.note,
  },
  task: {
    ordinal: input.goal.taskOrdinal ?? 1,
    request: input.goal.taskRequest?.trim() || (latestUserRequest ? messageText(latestUserRequest) : input.goal.title),
  },
  ...(input.goal.transition ? { transition: input.goal.transition } : {}),
  history: input.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({ role: message.role as "user" | "assistant", content: messageText(message).slice(0, 8_000) }))
    .filter((message) => message.content.trim().length > 0)
    .slice(-MAX_HISTORY_ITEMS),
  })
}

export const prepareTurnContext = (
  seed: ResolvedTurnContextSeed,
  records: readonly MemoryLoopToolRecord[] = [],
): ResolvedTurnContext => deepFreeze(resolvedTurnContextSchema.parse({
  ...seed,
  memory: records.flatMap((record) => {
    if (!record.result.ok) return []
    const content = memoryLoopSectionContent(record.result.output)?.trim()
    if (!content) return []
    return [{
      surface: record.toolName,
      reference: memoryReference(record.input),
      content: content.slice(0, 4_000),
    }]
  }).slice(0, MAX_MEMORY_ITEMS),
}))

export const renderResolvedTurnContext = (context: ResolvedTurnContext): string => [
  "<socrates_resolved_turn_context>",
  `PROJECT\n${context.project.name}`,
  ...(context.project.description ? [`PROJECT DESCRIPTION\n${context.project.description}`] : []),
  `CURRENT GOAL\n${context.goal.title}`,
  `GOAL OBJECTIVE\n${context.goal.objective}`,
  `GOAL STATE\n${context.goal.state}`,
  `GOAL PROGRESS\n${context.goal.progress}`,
  `CURRENT TASK - ${context.task.ordinal}\n${context.task.request}`,
  ...(context.transition ? [
    `PRECEDING GOAL TRANSITION\nPrevious goal: ${context.transition.previousGoalTitle}\nRelationship: ${context.transition.relationship}\nVerified outcome: ${context.transition.verifiedOutcome}`,
  ] : []),
  ...(context.history.length ? [
    `BOUNDED HISTORY\n${context.history.map((item) => `${item.role.toUpperCase()}: ${item.content}`).join("\n\n")}`,
  ] : []),
  ...(context.memory.length ? [
    `RETRIEVED MEMORY\n${context.memory.map((item) => `${item.surface}/${item.reference}\n${item.content}`).join("\n\n")}`,
  ] : []),
  "The runtime has already bound this task to the goal above. Never expose or infer internal goal/task ids, and finalization cannot select another goal.",
  "</socrates_resolved_turn_context>",
].join("\n\n")

const messageText = (message: ModelMessage): string => typeof message.content === "string"
  ? message.content
  : message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")

const memoryReference = (input: unknown): string => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "selected section"
  const value = input as Record<string, unknown>
  return [value.area, value.path, value.sectionId].filter((part): part is string => typeof part === "string" && part.length > 0).join("/") || "selected section"
}

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}
