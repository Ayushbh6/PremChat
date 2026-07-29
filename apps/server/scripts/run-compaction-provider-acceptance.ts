import path from "node:path"
import { config as loadEnvFile } from "dotenv"
import { ContextPipeline, type CompleteCompactionSnapshotInput } from "@socrates/core"
import { createDefaultModelProvider, type ModelMessage } from "@socrates/providers"
import type { ProviderAuthMode, ProviderId, RuntimeConfig, ThinkingEffort } from "@socrates/contracts"
import { ProviderCredentialStore } from "../src/services/providerCredentials"

const socratesHome = process.env.SOCRATES_HOME?.trim()
if (!socratesHome || !path.isAbsolute(socratesHome)) {
  throw new Error("SOCRATES_HOME must be an explicit absolute disposable directory.")
}
loadEnvFile({ path: path.resolve(process.cwd(), "apps/server/.env"), quiet: true })
loadEnvFile({ path: path.resolve(process.cwd(), ".env"), quiet: true })

type Target = {
  id: "deepseek" | "terra"
  providerId: ProviderId
  authMode: ProviderAuthMode
  modelId: string
  thinkingEnabled: boolean
  thinkingEffort: ThinkingEffort
  contextWindowTokens: number
}

const targetName = process.env.COMPACTION_PROVIDER_TARGET?.trim() || "deepseek"
const target: Target = targetName === "terra"
  ? {
      id: "terra",
      providerId: "openai",
      authMode: "chatgpt_subscription",
      modelId: process.env.COMPACTION_TERRA_MODEL?.trim() || "gpt-5.6-terra",
      thinkingEnabled: true,
      thinkingEffort: "low",
      contextWindowTokens: 1_050_000,
    }
  : targetName === "deepseek"
    ? {
        id: "deepseek",
        providerId: "openrouter",
        authMode: "api_key",
        modelId: process.env.COMPACTION_DEEPSEEK_MODEL?.trim() || "deepseek/deepseek-v4-pro",
        thinkingEnabled: false,
        thinkingEffort: "none",
        contextWindowTokens: 200_000,
      }
    : (() => { throw new Error(`Unsupported COMPACTION_PROVIDER_TARGET: ${targetName}`) })()

const credentials = new ProviderCredentialStore({ socratesHome })
const configured = credentials.availableAuthModes().some((candidate) =>
  candidate.providerId === target.providerId && candidate.authMode === target.authMode,
)
if (!configured) throw new Error(`${target.providerId}/${target.authMode} is not configured in the disposable test state.`)
const provider = createDefaultModelProvider(credentials)
const runtimeConfig: RuntimeConfig = {
  providerId: target.providerId,
  authMode: target.authMode,
  modelId: target.modelId,
  thinkingEnabled: target.thinkingEnabled,
  thinkingEffort: target.thinkingEffort,
  approvalMode: "read_only_auto",
  sandboxMode: "read_only",
  contextWindowTokens: target.contextWindowTokens,
}

const turnId = `provider_acceptance_${target.id}`
const batchCount = 12
const messages: ModelMessage[] = [
  {
    role: "user",
    id: "msg_request",
    turnId,
    turnOrdinal: 41,
    content: "Inspect a tool-heavy first turn, preserve this original request exactly, and keep the newest evidence raw.",
  },
  ...Array.from({ length: batchCount }, (_, index): ModelMessage[] => {
    const number = index + 1
    const suffix = String(number).padStart(3, "0")
    return [
      {
        role: "assistant",
        id: `msg_call_${suffix}`,
        turnId,
        turnOrdinal: 41,
        content: [{
          type: "tool-call",
          toolCallId: `tool_${suffix}`,
          toolName: "read",
          input: { path: `reports/segment-${suffix}.md` },
        }],
      },
      {
        role: "tool",
        id: `msg_result_${suffix}`,
        turnId,
        turnOrdinal: 41,
        content: [{
          type: "tool-result",
          toolCallId: `tool_${suffix}`,
          toolName: "read",
          output: {
            content: `${number === batchCount ? "RAW-SUFFIX-012" : `EARLY-EVIDENCE-${suffix}`} ` +
              "The repository check completed successfully and produced exact durable evidence for the compaction acceptance run. ".repeat(18),
          },
        }],
      },
    ]
  }).flat(),
  {
    role: "assistant",
    id: "msg_pending",
    turnId,
    turnOrdinal: 41,
    content: [{ type: "tool-call", toolCallId: "tool_pending", toolName: "wait", input: { terminalNames: ["acceptance"] } }],
  },
]

const snapshots: CompleteCompactionSnapshotInput[] = []
const prepared = await new ContextPipeline().prepare({
  provider,
  providerId: target.providerId,
  modelId: target.modelId,
  runtimeConfig,
  system: "You are Socrates running the natural active-turn compaction acceptance check.",
  messages,
  compression: {
    enabled: true,
    mode: "chat",
    projectId: "compaction_provider_acceptance",
    conversationId: `compaction_provider_acceptance_${target.id}`,
    sessionId: turnId,
    turnId,
    workspacePath: socratesHome,
    thresholds: {
      triggerTokens: 4_000,
      excellentTargetTokens: 2_000,
      preferredTargetTokens: 2_500,
      postCompactionTargetTokens: 3_500,
      minimumReductionTokens: 500,
      recentTailTargetTokens: 900,
    },
    compressorProviderId: target.providerId,
    compressorAuthMode: target.authMode,
    compressorModelId: target.modelId,
    compressorThinkingEnabled: target.thinkingEnabled,
    compressorThinkingEffort: target.thinkingEffort,
    compressorFallbacks: [],
    completeSnapshot: (snapshot) => snapshots.push(snapshot),
  },
})

const packed = JSON.stringify(prepared.messages)
const rawSuffix = JSON.stringify(prepared.messages.slice(1))
const snapshot = snapshots[0]
if (!snapshot) throw new Error("The provider run did not create a compaction snapshot.")
if (!packed.includes("Inspect a tool-heavy first turn")) throw new Error("The exact original request was not kept raw.")
if (!rawSuffix.includes("RAW-SUFFIX-012") || !rawSuffix.includes("tool_pending")) {
  throw new Error("The newest completed batch or pending operation was not kept raw.")
}
if (rawSuffix.includes("EARLY-EVIDENCE-001")) throw new Error("An old completed batch remained in the raw suffix.")
if (!snapshot.sourceHandles.some((source) => source.kind === "active_tool_batch" && source.turnOrdinal === 41)) {
  throw new Error("The snapshot did not persist typed active-tool-batch coordinates.")
}
if (prepared.estimatedTokens > 3_500) throw new Error(`Post-compaction context exceeded target: ${prepared.estimatedTokens}.`)

console.log(JSON.stringify({
  ok: true,
  target: target.id,
  providerId: target.providerId,
  authMode: target.authMode,
  modelId: target.modelId,
  thinkingEffort: target.thinkingEffort,
  sourceToolBatches: batchCount,
  postCompactionTokens: prepared.estimatedTokens,
  compactedSourceCount: snapshot.sourceHandles.filter((source) => source.kind === "active_tool_batch").length,
  keptOriginalRequestRaw: true,
  keptNewestBatchRaw: true,
  keptPendingOperationRaw: true,
}, null, 2))
