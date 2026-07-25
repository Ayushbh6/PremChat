import {
  soulConfirmationAgentOutputSchema,
  type ProviderAuthMode,
  type ProviderId,
  type RuntimeConfig,
  type SoulConfirmationAgentOutput,
  type ThinkingEffort,
} from "@socrates/contracts"
import type { ModelProvider, ModelUsage } from "@socrates/providers"
import { buildSoulConfirmationUserContent, SOUL_CONFIRMATION_AGENT_SYSTEM_PROMPT } from "../prompts/soulConfirmationPrompt"
import { createSoulConfirmationToolRegistry } from "../tools/registry"
import { AgentRuntime } from "./AgentRuntime"

export type SoulConfirmationAgentModelSettings = {
  providerId: ProviderId
  authMode?: ProviderAuthMode
  modelId: string
  thinkingEnabled: boolean
  thinkingEffort?: ThinkingEffort
}

export type SoulConfirmationAgentInput = {
  provider: ModelProvider
  modelSettings: SoulConfirmationAgentModelSettings
  targetPath: string
  rationale?: string
  oldText?: string
  newText?: string
  projectId: string
  conversationId: string
  sessionId: string
  turnId: string
  workspacePath: string
  abortSignal?: AbortSignal
}

export type SoulConfirmationAgentResult = {
  output: SoulConfirmationAgentOutput
  usages: ModelUsage[]
}

export class SoulConfirmationAgent {
  private readonly runtime = new AgentRuntime()

  async run(input: SoulConfirmationAgentInput): Promise<SoulConfirmationAgentResult> {
    const result = await this.runtime.run({
      provider: input.provider,
      providerId: input.modelSettings.providerId,
      modelId: input.modelSettings.modelId,
      runtimeConfig: runtimeConfigFor(input.modelSettings),
      system: SOUL_CONFIRMATION_AGENT_SYSTEM_PROMPT,
      userContent: buildSoulConfirmationUserContent(input),
      completion: { mode: "structured", schema: soulConfirmationAgentOutputSchema },
      toolRegistry: createSoulConfirmationToolRegistry(),
      toolExecutors: {},
      maxToolCalls: 0,
      projectId: input.projectId,
      conversationId: input.conversationId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      workspacePath: input.workspacePath,
      cacheKey: `memory:soul-confirmation:${input.turnId}`,
      providerRouting: { omitReasoning: true },
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    })
    return { output: result.output, usages: result.usages }
  }
}

const runtimeConfigFor = (settings: SoulConfirmationAgentModelSettings): RuntimeConfig => ({
  providerId: settings.providerId,
  authMode: settings.authMode ?? "api_key",
  modelId: settings.modelId,
  thinkingEnabled: settings.thinkingEnabled,
  ...(settings.thinkingEffort ? { thinkingEffort: settings.thinkingEffort } : {}),
  approvalMode: "read_only_auto",
  sandboxMode: "read_only",
})
