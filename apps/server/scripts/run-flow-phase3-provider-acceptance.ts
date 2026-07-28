import path from "node:path"
import { config as loadEnvFile } from "dotenv"
import {
  createResolvedTurnContextSeed,
  prepareTurnContext,
  selectExactMemoryCandidates,
  SocratesAgent,
  type ActiveGoalCard,
  type SocratesGoalResolutionCandidate,
} from "@socrates/core"
import { createDefaultModelProvider } from "@socrates/providers"
import { ProviderCredentialStore } from "../src/services/providerCredentials"

const socratesHome = process.env.SOCRATES_HOME?.trim()
if (!socratesHome || !path.isAbsolute(socratesHome)) {
  throw new Error("SOCRATES_HOME must be an explicit absolute disposable directory.")
}
loadEnvFile({ path: path.resolve(process.cwd(), "apps/server/.env"), quiet: true })
loadEnvFile({ path: path.resolve(process.cwd(), ".env"), quiet: true })

const credentials = new ProviderCredentialStore({ socratesHome })
if (!credentials.check("openrouter").configured) throw new Error("OpenRouter is not configured.")
const provider = createDefaultModelProvider(credentials)
const modelId = process.env.PHASE3_DEEPSEEK_MODEL?.trim() || "deepseek/deepseek-v4-pro"
const runtimeConfig = {
  providerId: "openrouter" as const,
  authMode: "api_key" as const,
  modelId,
  thinkingEnabled: false,
  thinkingEffort: "none" as const,
  approvalMode: "read_only_auto" as const,
  sandboxMode: "read_only" as const,
  contextWindowTokens: 128_000,
}
const candidate = (
  candidateNumber: number,
  title: string,
  objective: string,
): SocratesGoalResolutionCandidate => ({
  candidate: candidateNumber,
  status: candidateNumber === 1 ? "foreground" : "parked",
  title,
  objective,
  progress: `Verified progress for ${title}.`,
})
const agent = new SocratesAgent(provider)
const common = {
  projectId: "phase3_provider_project",
  conversationId: "phase3_provider_flow",
  sessionId: "phase3_provider_session",
  workspacePath: socratesHome,
  providerId: "openrouter" as const,
  modelId,
  runtimeConfig,
  cacheKey: "phase3-provider-goal-resolution",
}

const cases = [
  {
    name: "current",
    input: {
      ...common,
      turnId: "phase3_current",
      userMessage: "Continue implementing and testing this same unified pre-turn lifecycle phase.",
      current: candidate(1, "Unified pre-turn lifecycle", "Implement Phase 3 end to end."),
      older: [candidate(2, "Email review", "Review today's inbox.")],
      latestExchange: { user: "Implement Phase 3.", assistant: "The shared resolver is now in place." },
    },
    verify: (decision: { decision: string }) => decision.decision === "current",
  },
  {
    name: "older",
    input: {
      ...common,
      turnId: "phase3_older",
      userMessage: "Return to the email review goal and continue checking today's inbox.",
      current: candidate(1, "Unified pre-turn lifecycle", "Implement Phase 3 end to end."),
      older: [candidate(2, "Email review", "Review today's inbox.")],
    },
    verify: (decision: { decision: string; candidate?: number }) => decision.decision === "older" && decision.candidate === 2,
  },
  {
    name: "new",
    input: {
      ...common,
      turnId: "phase3_new",
      userMessage: "Start a new independent goal to design a balcony irrigation schedule.",
      current: candidate(1, "Unified pre-turn lifecycle", "Implement Phase 3 end to end."),
      older: [candidate(2, "Email review", "Review today's inbox.")],
    },
    verify: (decision: { decision: string; title?: string }) => decision.decision === "new" && Boolean(decision.title?.trim()),
  },
  {
    name: "clarify",
    input: {
      ...common,
      turnId: "phase3_clarify",
      userMessage: "Continue the other one.",
      current: candidate(1, "Unified pre-turn lifecycle", "Implement Phase 3 end to end."),
      older: [
        candidate(2, "Email review", "Review today's inbox."),
        candidate(3, "Security audit", "Audit authentication controls."),
      ],
    },
    verify: (decision: { decision: string; question?: string }) => decision.decision === "clarify" && Boolean(decision.question?.trim()),
  },
] as const

const results: Array<{ name: string; decision: unknown; usageItems: number }> = []
for (const testCase of cases) {
  const result = await agent.resolveGoal(testCase.input)
  if (result.source !== "model" || !testCase.verify(result.decision)) {
    throw new Error(`Real-provider ${testCase.name} resolution failed: ${JSON.stringify(result)}`)
  }
  results.push({ name: testCase.name, decision: result.decision, usageItems: result.attempt.usages.length })
}

const exactUser = "BYTE-EXACT-USER  keep  spacing\nsecond line"
const exactAssistant = "BYTE-EXACT-ASSISTANT\nverified outcome"
const exactTask = "  BYTE-EXACT-TASK  do not normalize\n"
const exactMemory = "BYTE-EXACT-MEMORY\n- preserve this source"
const activeGoal: ActiveGoalCard = {
  goalId: "phase3_goal",
  title: "Verify exact context",
  objective: "Prove exact selected context survives assembly.",
  state: "foreground",
  note: "Exact-context acceptance is active.",
  taskOrdinal: 2,
  taskRequest: exactTask,
}
const selectedMemory = selectExactMemoryCandidates({
  candidates: [{
    resultNumber: 1,
    content: exactMemory,
    surface: "project_memory",
    fileName: "MEMORY.md",
    sectionId: "durable_decisions",
    sectionHeading: "Durable Decisions",
    scope: "project",
  }],
  userMessage: exactTask,
  goal: activeGoal,
})
const context = prepareTurnContext(createResolvedTurnContextSeed({
  goal: activeGoal,
  messages: [
    { role: "user", content: exactUser },
    { role: "assistant", content: exactAssistant },
    { role: "user", content: exactTask },
  ],
  retrieval: { goalCandidates: "completed", memoryCandidates: "completed", capabilityCandidates: "completed", warnings: [] },
}), selectedMemory)
if (
  context.task.request !== exactTask
  || context.latestExchange?.user !== exactUser
  || context.latestExchange.assistant !== exactAssistant
  || context.memory[0]?.content !== exactMemory
) {
  throw new Error("Exact context bytes changed during Phase 3 acceptance assembly.")
}

console.log(JSON.stringify({
  ok: true,
  providerId: "openrouter",
  modelId,
  sameSocratesGoalResolution: results,
  exactContext: {
    task: context.task.request,
    latestExchange: context.latestExchange,
    memory: context.memory[0]?.content,
  },
}, null, 2))
