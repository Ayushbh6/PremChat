import type { ModelUsage } from "@socrates/providers"
import type { V2FlowStore } from "../services/v2/flowStore"

export const actorForRuntimeSource = (
  source: string,
): { type: "user" | "main_agent" | "worker" | "tool" | "system"; label?: string } => {
  if (source === "user") return { type: "user" }
  if (source === "main_agent" || source === "frontier_agent" || source === "goal_resolution") {
    return { type: "main_agent", ...(source === "frontier_agent" ? { label: "Frontier" } : source === "goal_resolution" ? { label: "Goal resolution" } : {}) }
  }
  if (source === "tool" || source === "terminal") return { type: "tool", label: source }
  if (source === "context_compactor") {
    return { type: "worker", label: "Context Compactor" }
  }
  return { type: "system" }
}

export const safeRuntimeStringify = (value: unknown): string => {
  try {
    return typeof value === "string" ? value : JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export const recordV2ModelUsage = (store: V2FlowStore, modelCallId: string, usage: ModelUsage): void => {
  store.recordUsage({
    modelCallId,
    ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
    ...(usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
    ...(usage.cachedInputTokens === undefined ? {} : { cachedInputTokens: usage.cachedInputTokens }),
    ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
    ...(usage.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
    ...(usage.raw === undefined ? {} : { raw: usage.raw }),
  })
}
