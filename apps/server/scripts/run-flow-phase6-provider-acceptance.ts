import path from "node:path"
import { config as loadEnvFile } from "dotenv"
import { z } from "zod"
import { AgentRuntime, capabilityCatalog, SocratesAgent, socratesMainAgentDefinition, type ToolExecutors } from "@socrates/core"
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
const modelId = process.env.PHASE6_DEEPSEEK_MODEL?.trim() || "deepseek/deepseek-v4-flash"
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

const toolResults: Array<{ input: unknown; output: unknown }> = []
const malformedRecovery = await new AgentRuntime().run({
  provider,
  providerId: "openrouter",
  modelId,
  runtimeConfig,
  system: [
    "This is a production tool-recovery acceptance run.",
    "On the first step you MUST call current_time with exactly {\"unsupported\":true}.",
    "After the tool reports invalid_tool_input, call current_time again with exactly {}.",
    "Only after the successful second tool result, return the strict structured result.",
  ].join(" "),
  userContent: "Exercise invalid tool-input recovery and report the observed time zone.",
  completion: {
    mode: "structured",
    schema: z.object({ recovered: z.literal(true), observedTimeZone: z.string().min(1) }).strict(),
  },
  capabilitySet: capabilityCatalog.resolve({
    id: "flow-phase6-provider-acceptance-v2",
    role: socratesMainAgentDefinition.roleManifest.role,
    capabilityIds: ["tool.current_time"],
  }),
  toolExecutors: {
    current_time: async () => ({
      currentDate: "2026-07-26",
      currentDateTime: "2026-07-26T14:00:00.000+02:00",
      timeZone: "Europe/Vienna",
      source: "system" as const,
    }),
  } as unknown as ToolExecutors,
  maxToolCalls: 3,
  projectId: "phase6_project",
  conversationId: "phase6_recovery",
  sessionId: "phase6_recovery",
  turnId: "phase6_recovery",
  workspacePath: process.cwd(),
  onToolResult: ({ input, output }) => toolResults.push({ input, output }),
})

const firstError = toolResults[0]?.output as { error?: { code?: string } } | undefined
if (toolResults.length !== 2 || firstError?.error?.code !== "invalid_tool_input") {
  throw new Error(`DeepSeek did not traverse the required malformed-tool recovery path: ${JSON.stringify(toolResults)}`)
}
if (malformedRecovery.output.observedTimeZone !== "Europe/Vienna") {
  throw new Error("DeepSeek did not preserve the successful tool result in its structured completion.")
}

const integrityMarker = "FLOW-PHASE6-INTEGRITY-726"
let finalResult: { finalAnswer: string; goalFinalization: { state: string; note: string } } | undefined
let answerDeltaCount = 0
let modelCallCount = 0
const agent = new SocratesAgent(provider)
for await (const event of agent.streamTurn({
  providerId: "openrouter",
  modelId,
  runtimeConfig,
  messages: [{
    role: "user",
    content: `Return the exact integrity marker ${integrityMarker} and mark this acceptance task completed.`,
  }],
  activeGoal: {
    goalId: "phase6_goal",
    title: "Verify final-answer integrity",
    state: "foreground",
    note: "A bounded real-provider acceptance task.",
  },
  completionMode: "main_structured",
  projectId: "phase6_project",
  conversationId: "phase6_integrity",
  sessionId: "phase6_integrity",
  turnId: "phase6_integrity",
  workspacePath: process.cwd(),
})) {
  if (event.type === "model.answer.delta") answerDeltaCount += 1
  if (event.type === "model.started") modelCallCount += 1
  if (event.type === "agent.final_result") finalResult = event.result
}

if (!finalResult?.finalAnswer.includes(integrityMarker)) throw new Error("Validated final answer lost the integrity marker.")
if (finalResult.goalFinalization.state !== "completed") throw new Error("Validated final answer did not complete the bound goal.")
if (answerDeltaCount !== 0) throw new Error("A provisional answer delta escaped before validated finalization.")

console.log(JSON.stringify({
  ok: true,
  providerId: "openrouter",
  modelId,
  malformedToolRecovery: {
    toolCalls: malformedRecovery.toolCalls,
    firstErrorCode: firstError.error?.code,
    observedTimeZone: malformedRecovery.output.observedTimeZone,
  },
  finalAnswerIntegrity: {
    modelCalls: modelCallCount,
    answerDeltaCount,
    markerPresent: finalResult.finalAnswer.includes(integrityMarker),
    finalState: finalResult.goalFinalization.state,
  },
}, null, 2))
