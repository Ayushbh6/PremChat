import type { ModelMessage } from "@socrates/providers"

export const EXACT_GOAL_HISTORY_MAX_RECENT_MESSAGES = 12
export const EXACT_GOAL_HISTORY_MAX_RETRIEVED_ITEMS = 3

export type RetrievedExactGoalHistoryItem = Readonly<{
  resultNumber: number
  conversationTitle: string
  turnNumber: number
  occurredAt: string
  content: string
}>

export const selectExactGoalHistory = (
  messages: readonly ModelMessage[],
  retrieved: readonly RetrievedExactGoalHistoryItem[] = [],
): ModelMessage[] => {
  const currentUserIndex = messages.map((message) => message.role).lastIndexOf("user")
  const currentChain = currentUserIndex >= 0 ? messages.slice(currentUserIndex) : messages.slice(-1)
  const prior = currentUserIndex >= 0 ? messages.slice(0, currentUserIndex) : messages.slice(0, -1)
  const recent = prior.slice(-EXACT_GOAL_HISTORY_MAX_RECENT_MESSAGES)
  const older = retrieved.slice(0, EXACT_GOAL_HISTORY_MAX_RETRIEVED_ITEMS)
  const olderMessage: ModelMessage[] = older.length === 0 ? [] : [{
    role: "developer",
    content: [
      "<exact_older_goal_history>",
      "These are complete backend-selected older exchanges in the bound goal.",
      ...older.map((item, index) => `${index + 1}. ${item.conversationTitle}, task ${item.turnNumber}, ${item.occurredAt}\n${item.content}`),
      "</exact_older_goal_history>",
    ].join("\n\n"),
  }]
  return [...olderMessage, ...recent, ...currentChain]
}
