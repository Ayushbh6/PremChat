import type { Message } from "@socrates/contracts"
import {
  goalIdForFlowExchange,
  groupFlowExchanges,
  type FlowExchange,
} from "./flowTranscriptWindow"

export interface FlowQueryNavigationItem {
  id: string
  label: string
  turnId?: string
  isCurrent: boolean
  exchange: FlowExchange
}

export const flowQueriesForGoal = (input: {
  messages: Message[]
  goalIdByMessageId: Readonly<Record<string, string | undefined>>
  goalId?: string
  activeTurnId?: string
}): FlowQueryNavigationItem[] => {
  if (!input.goalId) return []
  const exchanges = groupFlowExchanges(input.messages)
    .filter((exchange) => {
      const exchangeGoalId = goalIdForFlowExchange(exchange, input.goalIdByMessageId)
      return exchangeGoalId === input.goalId
        || (exchange.turnId === input.activeTurnId && exchangeGoalId === undefined)
    })
  const current = input.activeTurnId
    ? exchanges.find((exchange) => exchange.turnId === input.activeTurnId) ?? exchanges.at(-1)
    : exchanges.at(-1)
  return exchanges.map((exchange) => ({
    id: exchange.key,
    label: exchange.label,
    ...(exchange.turnId ? { turnId: exchange.turnId } : {}),
    isCurrent: exchange.key === current?.key,
    exchange,
  }))
}

export const flowQueryCountsByGoal = (
  messages: Message[],
  goalIdByMessageId: Readonly<Record<string, string | undefined>>,
): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>()
  for (const exchange of groupFlowExchanges(messages)) {
    const goalId = goalIdForFlowExchange(exchange, goalIdByMessageId)
    if (goalId) counts.set(goalId, (counts.get(goalId) ?? 0) + 1)
  }
  return counts
}
