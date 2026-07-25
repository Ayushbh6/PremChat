import { z } from "zod"
import {
  v2GoalRouterOutputSchema,
  type GoalSearchInput,
  type GoalSearchOutput,
  type RuntimeConfig,
  type V2GoalRouterOutput,
  type WorkerModelSettings,
} from "@socrates/contracts"
import type { ModelProvider, ModelUsage } from "@socrates/providers"
import { buildGoalRouterUserContent, GOAL_ROUTER_SYSTEM_PROMPT } from "../prompts/goalRouterPrompt"
import { createGoalRouterToolRegistry } from "../tools/registry"
import type { V2GoalRoutingCandidateSet } from "../v2/types"
import type { ToolExecutors } from "../tools/types"
import { AgentRuntime } from "./AgentRuntime"

export type GoalRouterAgentModelSettings = Pick<
  WorkerModelSettings,
  "providerId" | "authMode" | "modelId" | "thinkingEnabled" | "thinkingEffort"
>

export type GoalRouterAgentInput = Readonly<{
  modelSettings: GoalRouterAgentModelSettings
  projectId: string
  flowId: string
  turnId: string
  workspacePath: string
  userMessage: string
  candidates: V2GoalRoutingCandidateSet
  recentTurns?: readonly Readonly<{ goalId?: string; user: string; assistant: string }>[]
  selectedGoalTurns?: readonly Readonly<{ goalId?: string; user: string; assistant: string }>[]
  clarificationAnswer?: string
  goalSearch: (input: GoalSearchInput) => Promise<GoalSearchOutput>
  cacheKey?: string
  abortSignal?: AbortSignal
  onUsage?: (usage: ModelUsage) => void
}>

export class GoalRouterAgent {
  private readonly runtime = new AgentRuntime()

  constructor(private readonly provider: ModelProvider) {}

  async route(input: GoalRouterAgentInput): Promise<V2GoalRouterOutput> {
    const allowedCandidateNumbers = new Set(input.candidates.candidates.map((candidate) => candidate.candidate))
    const toolExecutors = {
      goal_search: async (searchInput: GoalSearchInput) => {
        const output = await input.goalSearch(searchInput)
        for (const result of output.results) allowedCandidateNumbers.add(result.candidate)
        return output
      },
    } as unknown as ToolExecutors
    const result = await this.runtime.run({
      provider: this.provider,
      providerId: input.modelSettings.providerId,
      modelId: input.modelSettings.modelId,
      runtimeConfig: routerRuntimeConfig(input.modelSettings),
      system: GOAL_ROUTER_SYSTEM_PROMPT,
      userContent: buildGoalRouterUserContent({
        userMessage: input.userMessage,
        candidates: input.candidates,
        ...(input.recentTurns ? { recentTurns: input.recentTurns } : {}),
        ...(input.selectedGoalTurns ? { selectedGoalTurns: input.selectedGoalTurns } : {}),
        ...(input.clarificationAnswer ? { clarificationAnswer: input.clarificationAnswer } : {}),
      }),
      completion: { mode: "structured", schema: createValidatedGoalRouterOutputSchema(allowedCandidateNumbers) },
      toolRegistry: createGoalRouterToolRegistry(),
      toolExecutors,
      maxToolCalls: 3,
      projectId: input.projectId,
      conversationId: input.flowId,
      sessionId: input.flowId,
      turnId: input.turnId,
      workspacePath: input.workspacePath,
      ...(input.cacheKey ? { cacheKey: input.cacheKey } : {}),
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      ...(input.onUsage ? { onUsage: input.onUsage } : {}),
    })
    return result.output
  }
}

const createValidatedGoalRouterOutputSchema = (candidateNumbers: ReadonlySet<number>) => {
  return v2GoalRouterOutputSchema.superRefine((value, context) => {
    if (value.candidates.some((candidate) => !candidateNumbers.has(candidate))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["candidates"], message: "Candidates must be unique numbers from the provided list." })
    }
  })
}

const routerRuntimeConfig = (settings: GoalRouterAgentModelSettings): RuntimeConfig => ({
  providerId: settings.providerId,
  authMode: settings.authMode ?? "api_key",
  modelId: settings.modelId,
  thinkingEnabled: settings.thinkingEnabled,
  ...(settings.thinkingEffort ? { thinkingEffort: settings.thinkingEffort } : {}),
  approvalMode: "read_only_auto",
  sandboxMode: "read_only",
})
