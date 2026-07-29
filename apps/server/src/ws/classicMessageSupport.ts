import type { ModelUsage } from "@socrates/providers"
import type { RuntimeConfig } from "@socrates/contracts"
import type { SocratesStore } from "../services/store"

export type ClassicTerminalTaskContinuation = Readonly<{
  projectId: string
  conversationId: string
  sessionId: string
  turnId: string
  turnOrdinal: number
  runtimeConfigId: string
  runtimeConfig: RuntimeConfig
  resumedFromTurnId: string
  wakeContext: string
}>

export const withLateDeveloperContext = (
  history: ReturnType<SocratesStore["getConversationModelMessages"]>,
  terminalContext: string | undefined,
  wakeContext?: string,
): ReturnType<SocratesStore["getConversationModelMessages"]> => {
  const sections = terminalContext?.trim()
    ? [`<terminal_context>\n${terminalContext.trim()}\n</terminal_context>`]
    : []
  if (wakeContext?.trim()) sections.push(`<terminal_wake_context>\n${wakeContext.trim()}\n</terminal_wake_context>`)
  if (sections.length === 0) return history

  const message = {
    role: "developer" as const,
    content: `<socrates_runtime_context>\n${sections.join("\n\n")}\n</socrates_runtime_context>`,
  }
  const latestUserIndexFromEnd = [...history].reverse().findIndex((item) => item.role === "user")
  if (latestUserIndexFromEnd === -1) return [...history, message]
  const insertIndex = history.length - latestUserIndexFromEnd - 1
  return [...history.slice(0, insertIndex), message, ...history.slice(insertIndex)]
}

export const providerCacheKey = (projectId: string, conversationId: string): string =>
  `project:${projectId}:conversation:${conversationId}`

export const ensureParagraphBoundary = (text: string): string => (text.endsWith("\n\n") ? "" : "\n\n")

export const toContractUsage = (usage: ModelUsage) => ({
  ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
  ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
  ...(usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
  ...(usage.cachedInputTokens === undefined ? {} : { cachedInputTokens: usage.cachedInputTokens }),
  ...(usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: usage.cacheWriteTokens }),
  ...(usage.uncachedInputTokens === undefined ? {} : { uncachedInputTokens: usage.uncachedInputTokens }),
  ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
  ...(usage.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
  ...(usage.costSource === undefined ? {} : { costSource: usage.costSource }),
})

export const toStoredUsage = (usage: ModelUsage) => ({
  ...toContractUsage(usage),
  ...(usage.routedProvider === undefined ? {} : { routedProvider: usage.routedProvider }),
  ...(usage.pricingSnapshot === undefined ? {} : { pricingSnapshot: usage.pricingSnapshot }),
  ...(usage.providerMetadata === undefined ? {} : { providerMetadata: usage.providerMetadata }),
  ...(usage.raw === undefined ? {} : { raw: usage.raw }),
})

export const isBashOutput = (
  output: unknown,
): output is {
  operation?: string
  cwd: string
  exitCode: number | null
  signal?: string | null
  durationMs: number
  shell: { platform: string; kind: string; executable: string }
  process?: { processId: string; status: string; nextOutputSequence?: number }
  terminal?: {
    terminalId: string
    name: string
    status: string
    autoDetached?: boolean
    awaitingInput?: boolean
    lastPrompt?: string
  }
} =>
  typeof output === "object" &&
  output !== null &&
  "cwd" in output &&
  "stdout" in output &&
  "stderr" in output &&
  "durationMs" in output &&
  "shell" in output

export const isEditOutput = (output: unknown): output is { changedFiles: Array<{ path: string; operation: string }>; diff: string } =>
  typeof output === "object" && output !== null && "changedFiles" in output && "diff" in output
