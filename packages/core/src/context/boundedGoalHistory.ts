import type { ModelMessage } from "@socrates/providers"

export const BOUNDED_GOAL_HISTORY_MAX_RECENT_MESSAGES = 12
export const BOUNDED_GOAL_HISTORY_MAX_RETRIEVED_ITEMS = 3
export const BOUNDED_GOAL_HISTORY_MAX_CHARS = 60_000

export type RetrievedGoalHistoryItem = Readonly<{
  resultNumber: number
  conversationTitle: string
  turnNumber: number
  occurredAt: string
  content: string
}>

export const selectBoundedGoalHistory = (
  messages: readonly ModelMessage[],
  retrieved: readonly RetrievedGoalHistoryItem[] = [],
): ModelMessage[] => {
  const currentUserIndex = messages.map((message) => message.role).lastIndexOf("user")
  const currentChain = currentUserIndex >= 0 ? messages.slice(currentUserIndex) : messages.slice(-1)
  const prior = currentUserIndex >= 0 ? messages.slice(0, currentUserIndex) : messages.slice(0, -1)
  const recent = prior.slice(-BOUNDED_GOAL_HISTORY_MAX_RECENT_MESSAGES)
  const older = retrieved.slice(0, BOUNDED_GOAL_HISTORY_MAX_RETRIEVED_ITEMS)
  const olderMessage: ModelMessage[] = older.length === 0 ? [] : [{
    role: "developer",
    content: [
      "<bounded_older_goal_history>",
      "These are backend-selected older current-goal excerpts. Use trace_retrieve and inspect(resultNumber) when exact evidence is needed.",
      ...older.map((item, index) => `${index + 1}. ${item.conversationTitle}, task ${item.turnNumber}, ${item.occurredAt}\n${item.content.slice(0, 4_000)}`),
      "</bounded_older_goal_history>",
    ].join("\n\n"),
  }]
  const selected = [...olderMessage, ...recent, ...currentChain]
  let used = 0
  const keep = new Array<boolean>(selected.length).fill(false)
  for (let index = selected.length - 1; index >= 0; index -= 1) {
    const size = messageChars(selected[index]!)
    const isCurrent = index >= olderMessage.length + recent.length
    if (isCurrent || used + size <= BOUNDED_GOAL_HISTORY_MAX_CHARS) {
      keep[index] = true
      used += size
    }
  }
  return selected.filter((_message, index) => keep[index])
}

const messageChars = (message: ModelMessage): number => typeof message.content === "string"
  ? message.content.length
  : message.content.reduce((total, part) => total + (part.type === "text" ? part.text.length : 2_000), 0)
