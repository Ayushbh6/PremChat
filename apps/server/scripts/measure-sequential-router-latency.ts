import os from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { MemoryRouterAgent, routeV2Goal, type V2Goal } from "@socrates/core"
import type { WorkerModelSettings } from "@socrates/contracts"
import { createDefaultModelProvider } from "@socrates/providers"
import { ProviderCredentialStore } from "../src/services/providerCredentials"

const rounds = Math.max(1, Math.min(5, Number.parseInt(process.argv[2] ?? "3", 10) || 3))
const socratesHome = process.env.SOCRATES_HOME?.trim() || path.join(os.homedir(), ".Socrates")
const dbPath = process.env.SOCRATES_DB_PATH?.trim() || path.join(socratesHome, "socrates.sqlite")
const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true })
const settings = new Map(
  (sqlite.prepare("SELECT worker_id, provider_id, auth_mode, model_id, thinking_enabled, thinking_effort FROM worker_model_settings WHERE worker_id IN ('goal_router', 'memory_router')").all() as WorkerRow[])
    .map((row) => [row.worker_id, workerSettings(row)]),
)
sqlite.close()

const goalSettings = requiredSetting(settings, "goal_router")
const memorySettings = requiredSetting(settings, "memory_router")
const credentials = new ProviderCredentialStore({ socratesHome })
for (const setting of [goalSettings, memorySettings]) {
  const status = credentials.check(setting.providerId, setting.authMode ?? "api_key")
  if (!status.configured) throw new Error(`${setting.providerId}/${setting.authMode ?? "api_key"} is not configured.`)
}
const provider = createDefaultModelProvider(credentials)
const samples: Sample[] = []
const sampleGoal: V2Goal = {
  id: "goal_lifecycle_ledger",
  flowId: "latency_flow",
  projectId: "latency_project",
  ordinal: 1,
  title: "Review and improve the focus ledger",
  summary: "The lifecycle and selected-view state need to be separated.",
  kind: "work",
  status: "foreground",
  origin: "router",
  priority: 50,
  pinned: false,
  lastActiveAt: "2026-07-25T12:00:00.000Z",
  createdAt: "2026-07-25T12:00:00.000Z",
  updatedAt: "2026-07-25T12:00:00.000Z",
}

for (let round = 1; round <= rounds; round += 1) {
  const sequenceStarted = performance.now()
  const goalStarted = performance.now()
  let goalSearchCalls = 0
  const goalResult = await routeV2Goal({
    projectId: "latency_project",
    flowId: "latency_flow",
    turnId: `latency_turn_${round}`,
    workspacePath: process.cwd(),
    userMessage: "Okay, continue the focus-ledger review and explain the next change.",
    goals: [sampleGoal],
    selectedGoalId: sampleGoal.id,
    recentTurns: [{ goalId: sampleGoal.id, user: "Review the focus ledger.", assistant: "The lifecycle and selection state are currently coupled." }],
    selectedGoalTurns: [{ goalId: sampleGoal.id, user: "Review the focus ledger.", assistant: "The lifecycle and selection state are currently coupled." }],
    goalSearch: async () => {
      goalSearchCalls += 1
      return []
    },
    provider,
    model: { ...goalSettings, timeoutMs: 30_000 },
  })
  const goalMs = performance.now() - goalStarted

  let memoryRunStart = ""
  let memoryRunEnd = ""
  let memoryStatus = "completed"
  const memoryStarted = performance.now()
  await new MemoryRouterAgent(provider).routePreTurn({
    modelSettings: memorySettings,
    projectId: "latency_project",
    conversationId: "latency_flow",
    sessionId: `latency_turn_${round}`,
    turnId: `latency_turn_${round}`,
    workspacePath: process.cwd(),
    userMessage: "Okay, continue the focus-ledger review and explain the next change.",
    recentMessages: [
      { role: "user", content: "Review the focus ledger." },
      { role: "assistant", content: "The lifecycle and selection state are currently coupled." },
      { role: "user", content: "Okay, continue the focus-ledger review and explain the next change." },
    ],
    activeGoal: { goalId: sampleGoal.id, title: sampleGoal.title, state: sampleGoal.status, note: sampleGoal.summary ?? "" },
    automaticMemorySearch: async () => ({ results: [], totalMatches: 0 }),
    toolExecutors: { memory_search: async () => ({ results: [], totalMatches: 0 }) } as never,
    recordRun: (run) => {
      memoryRunStart = run.startedAt
      memoryRunEnd = run.completedAt
    },
  }).catch((error) => {
    memoryStatus = error instanceof Error ? `failed:${error.name}` : "failed:unknown"
  })
  const memoryMs = performance.now() - memoryStarted
  samples.push({
    round,
    goalMs: Math.round(goalMs),
    memoryMs: Math.round(memoryMs),
    sequentialTotalMs: Math.round(performance.now() - sequenceStarted),
    goalSearchCalls,
    goalRouteSource: goalResult.source,
    goalRouteAction: goalResult.decision.action,
    memoryStartedAfterGoalCompleted: memoryRunStart >= (goalResult.modelAttempt?.completedAt ?? ""),
    memoryRecordedMs: Date.parse(memoryRunEnd) - Date.parse(memoryRunStart),
    memoryStatus,
  })
}

console.log(JSON.stringify({
  measuredAt: new Date().toISOString(),
  rounds,
  goalRouter: settingLabel(goalSettings),
  memoryRouter: settingLabel(memorySettings),
  samples,
  aggregate: {
    goalMedianMs: median(samples.map((sample) => sample.goalMs)),
    memoryMedianMs: median(samples.map((sample) => sample.memoryMs)),
    sequentialMedianMs: median(samples.map((sample) => sample.sequentialTotalMs)),
    sequentialMinMs: Math.min(...samples.map((sample) => sample.sequentialTotalMs)),
    sequentialMaxMs: Math.max(...samples.map((sample) => sample.sequentialTotalMs)),
  },
}, null, 2))

type WorkerRow = {
  worker_id: WorkerModelSettings["workerId"]
  provider_id: WorkerModelSettings["providerId"]
  auth_mode: WorkerModelSettings["authMode"] | null
  model_id: string
  thinking_enabled: number
  thinking_effort: WorkerModelSettings["thinkingEffort"] | null
}

type Sample = {
  round: number
  goalMs: number
  memoryMs: number
  sequentialTotalMs: number
  goalSearchCalls: number
  goalRouteSource: string
  goalRouteAction: string
  memoryStartedAfterGoalCompleted: boolean
  memoryRecordedMs: number
  memoryStatus: string
}

function workerSettings(row: WorkerRow): WorkerModelSettings {
  return {
    workerId: row.worker_id,
    providerId: row.provider_id,
    ...(row.auth_mode ? { authMode: row.auth_mode } : {}),
    modelId: row.model_id,
    thinkingEnabled: row.thinking_enabled === 1,
    ...(row.thinking_effort ? { thinkingEffort: row.thinking_effort } : {}),
    updatedAt: new Date(0).toISOString(),
  }
}

function requiredSetting(settings: Map<string, WorkerModelSettings>, workerId: string): WorkerModelSettings {
  const setting = settings.get(workerId)
  if (!setting) throw new Error(`Missing configured ${workerId} worker setting.`)
  return setting
}

function settingLabel(setting: WorkerModelSettings) {
  return {
    providerId: setting.providerId,
    authMode: setting.authMode ?? "api_key",
    modelId: setting.modelId,
    thinkingEnabled: setting.thinkingEnabled,
    thinkingEffort: setting.thinkingEffort ?? null,
  }
}

function median(values: number[]): number {
  return [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)] ?? 0
}
