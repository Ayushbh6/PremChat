import path from "node:path"
import { config as loadEnvFile } from "dotenv"
import { z } from "zod"
import {
  AgentInstance,
  defineAgent,
  TitleGeneratorAgent,
  ToolRegistry,
  type ToolExecutors,
} from "@socrates/core"
import { createDefaultModelProvider } from "@socrates/providers"
import { currentTimeTool } from "../../../packages/core/src/tools/currentTimeTool"
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
const modelId = process.env.AGENT_CORE_DEEPSEEK_MODEL?.trim() || "deepseek/deepseek-v4-pro"
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

const title = await new TitleGeneratorAgent().run({
  provider,
  modelSettings: {
    providerId: "openrouter",
    authMode: "api_key",
    modelId,
    thinkingEnabled: false,
    thinkingEffort: "none",
  },
  userContent: "We are establishing one canonical provider-neutral shared agent runtime and its enforceable role contracts.",
  projectId: "agent_core_acceptance",
  conversationId: "agent_core_title",
  sessionId: "agent_core_title",
  turnId: "agent_core_title",
  workspacePath: socratesHome,
})
if (!title.output.title.trim()) throw new Error("The production Title Generator returned an empty title.")

const acceptanceSchema = z.object({
  observedTimeZone: z.literal("Europe/Vienna"),
  runtime: z.literal("shared-agent-core"),
}).strict()
const acceptanceDefinition = defineAgent<undefined, z.infer<typeof acceptanceSchema>>({
  id: "agent-core-provider-acceptance",
  role: "agent_core_provider_acceptance",
  modelRole: "acceptance",
  prompt: {
    id: "agent-core-provider-acceptance-v1",
    buildSystem: () => [
      "You are verifying the canonical shared Socrates agent core.",
      "Call current_time exactly once with {} before finishing.",
      "Use its exact timeZone in the strict structured result and set runtime to shared-agent-core.",
    ].join(" "),
  },
  completion: { mode: "streaming_tools_structured_final", schema: acceptanceSchema },
  roleManifest: { id: "agent-core-provider-acceptance-tools-v1", modelTools: ["current_time"] },
  contextProfile: {
    id: "agent-core-provider-acceptance-context-v1",
    stages: ["stable_prompt", "exact_messages", "tool_definitions"],
  },
  limits: { maxToolCalls: 1, timeoutMs: 120_000, maxOutputRepairAttempts: 1 },
  persistenceScope: "none",
})
const toolResults: unknown[] = []
const result = await new AgentInstance(acceptanceDefinition).run({
  provider,
  providerId: "openrouter",
  modelId,
  runtimeConfig,
  promptContext: undefined,
  userContent: "Run the shared-agent acceptance check now.",
  toolRegistry: new ToolRegistry([currentTimeTool]),
  toolExecutors: {
    current_time: async () => ({
      currentDate: "2026-07-27",
      currentDateTime: "2026-07-27T20:00:00.000+02:00",
      timeZone: "Europe/Vienna",
      source: "system" as const,
    }),
  } as unknown as ToolExecutors,
  projectId: "agent_core_acceptance",
  conversationId: "agent_core_tool",
  sessionId: "agent_core_tool",
  turnId: "agent_core_tool",
  workspacePath: socratesHome,
  onToolResult: ({ output }) => toolResults.push(output),
})
if (result.mode !== "streaming_tools_structured_final") {
  throw new Error(`Unexpected completion mode: ${result.mode}`)
}
if (result.toolCalls !== 1 || toolResults.length !== 1) {
  throw new Error(`Expected exactly one real model tool call, received ${result.toolCalls}.`)
}

console.log(JSON.stringify({
  ok: true,
  providerId: "openrouter",
  modelId,
  productionDefinition: {
    id: "title-generator",
    title: title.output.title,
  },
  sharedRuntimeProbe: {
    definitionId: acceptanceDefinition.id,
    completionMode: result.mode,
    toolCalls: result.toolCalls,
    output: result.output,
  },
}, null, 2))
