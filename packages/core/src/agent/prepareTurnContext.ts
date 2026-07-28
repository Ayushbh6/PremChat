import {
  resolvedTurnContextSchema,
  resolvedTurnContextSeedSchema,
  type CandidateRetrievalStatus,
  type ResolvedTurnContext,
  type ResolvedTurnCapabilityItem,
  type ResolvedTurnContextSeed,
  type ResolvedTurnMemoryItem,
} from "@socrates/contracts"
import type { ModelMessage } from "@socrates/providers"
import type { ActiveGoalCard } from "./goalContext"

export const createResolvedTurnContextSeed = (input: {
  goal: ActiveGoalCard
  messages: readonly ModelMessage[]
  retrieval: CandidateRetrievalStatus
}): ResolvedTurnContextSeed => {
  const latestUserRequest = [...input.messages].reverse().find((message) => message.role === "user")
  const latestExchange = latestCompletedExchange(input.messages)
  const exactTaskRequest = input.goal.taskRequest !== undefined && input.goal.taskRequest.length > 0
    ? input.goal.taskRequest
    : latestUserRequest
      ? messageText(latestUserRequest)
      : input.goal.title
  return resolvedTurnContextSeedSchema.parse({
    goal: {
      title: input.goal.title,
      objective: input.goal.objective?.trim() || input.goal.title,
      state: input.goal.state,
      progress: input.goal.note,
      openDecisions: input.goal.openDecisions ?? [],
      blockers: input.goal.blockers ?? [],
    },
    task: {
      ordinal: input.goal.taskOrdinal ?? 1,
      request: exactTaskRequest,
    },
    ...(latestExchange ? { latestExchange } : {}),
    ...(input.goal.transition ? { transition: input.goal.transition } : {}),
    retrieval: input.retrieval,
  })
}

export const prepareTurnContext = (
  seed: ResolvedTurnContextSeed,
  memory: readonly ResolvedTurnMemoryItem[] = [],
  capabilities: readonly ResolvedTurnCapabilityItem[] = [],
): ResolvedTurnContext => deepFreeze(resolvedTurnContextSchema.parse({
  ...seed,
  memory,
  capabilities,
}))

export const renderResolvedTurnContext = (context: ResolvedTurnContext): string => [
  "<socrates_resolved_turn_context>",
  `CURRENT GOAL\n${context.goal.title}`,
  `GOAL OBJECTIVE\n${context.goal.objective}`,
  `GOAL STATE\n${context.goal.state}`,
  `VERIFIED GOAL PROGRESS\n${context.goal.progress}`,
  ...(context.goal.openDecisions.length ? [`OPEN DECISIONS\n${context.goal.openDecisions.map((item) => `- ${item}`).join("\n")}`] : []),
  ...(context.goal.blockers.length ? [`ACTIVE BLOCKERS\n${context.goal.blockers.map((item) => `- ${item}`).join("\n")}`] : []),
  `CURRENT TASK - ${context.task.ordinal}\n${context.task.request}`,
  ...(context.latestExchange ? [
    `LATEST EXACT EXCHANGE IN THIS GOAL\nUSER:\n${context.latestExchange.user}\n\nSOCRATES:\n${context.latestExchange.assistant}`,
  ] : []),
  ...(context.transition ? [
    `PRECEDING GOAL TRANSITION\nPrevious goal: ${context.transition.previousGoalTitle}\nRelationship: ${context.transition.relationship}\nVerified outcome: ${context.transition.verifiedOutcome}`,
  ] : []),
  ...(context.memory.length ? [
    `SELECTED EXACT MEMORY\n${context.memory.map((item) => `${item.scope}/${item.surface}/${item.reference}\n${item.content}`).join("\n\n")}`,
  ] : []),
  ...(context.capabilities.length ? [
    `RELEVANT CAPABILITIES\n${context.capabilities.map((item) => `${item.kind}/${item.scope}/${item.name}\n${item.description}\nRead: ${item.uri}`).join("\n\n")}`,
  ] : []),
  ...(context.retrieval.warnings.length ? [
    `RECALL STATUS\n${context.retrieval.warnings.map((warning) => `- ${warning}`).join("\n")}`,
  ] : []),
  "The runtime has already bound this task to the goal above. Never expose or infer internal goal/task ids, and finalization cannot select another goal.",
  "This exact goal/task contract is identical in every presentation. Do not infer a different persona, history policy, or working method from the visible view.",
  "</socrates_resolved_turn_context>",
].join("\n\n")

const latestCompletedExchange = (messages: readonly ModelMessage[]): { user: string; assistant: string } | undefined => {
  let pendingUser: string | undefined
  let latest: { user: string; assistant: string } | undefined
  for (const message of messages) {
    if (message.role === "user") pendingUser = messageText(message)
    if (message.role === "assistant" && pendingUser !== undefined) {
      latest = { user: pendingUser, assistant: messageText(message) }
      pendingUser = undefined
    }
  }
  return latest
}

const messageText = (message: ModelMessage): string => typeof message.content === "string"
  ? message.content
  : message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}
