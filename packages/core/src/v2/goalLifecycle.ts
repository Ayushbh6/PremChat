import { type ProviderId, type RuntimeConfig, type SocratesGoalResolutionOutput } from "@socrates/contracts"
import type { ModelUsage } from "@socrates/providers"
import type { SocratesAgent } from "../agent/SocratesAgent"
import type {
  V2Goal,
  V2GoalCapsule,
  V2GoalRoutingCandidate,
  V2GoalRoutingCandidateSet,
  V2GoalRoutingDecision,
  V2GoalRoutingPlan,
  V2GoalStatus,
} from "./types"

export const DEFAULT_V2_PARKED_GOAL_CANDIDATE_LIMIT = 5
export const MAX_V2_PARKED_GOAL_CANDIDATE_LIMIT = 5
export type SocratesGoalResolutionResult = Readonly<{
  decision: V2GoalRoutingDecision
  candidates: V2GoalRoutingCandidateSet
  source: "model" | "fallback"
  fallbackReason?: "structured_generation_unavailable" | "timeout" | "provider_error" | "invalid_output"
  modelAttempt?: Readonly<{
    providerId: ProviderId
    modelId: string
    status: "completed" | "failed"
    startedAt: string
    completedAt: string
    durationMs: number
    usage?: ModelUsage
    errorCode?: "timeout" | "provider_error" | "invalid_output"
    errorMessage?: string
  }>
}>

export const selectV2GoalRoutingCandidates = (input: {
  flowId: string
  userMessage: string
  goals: readonly V2Goal[]
  selectedGoalId?: string
  previousGoalId?: string
  capsules?: readonly V2GoalCapsule[]
  parkedCandidateLimit?: number
  candidateGoalIds?: readonly string[]
}): V2GoalRoutingCandidateSet => {
  const goals = input.goals.filter((goal) => goal.flowId === input.flowId)
  const foregroundGoals = goals.filter((goal) => goal.status === "foreground").sort(compareGoalIdentity)
  if (foregroundGoals.length > 1) {
    throw new Error(`V2 Flow ${input.flowId} has more than one foreground goal.`)
  }

  const capsulesByGoal = latestCapsuleByGoal(input.capsules ?? [])
  const toCandidate = (goal: V2Goal, candidate: number): V2GoalRoutingCandidate => {
    const capsule = capsulesByGoal.get(goal.id)
    return { goal, ...(capsule ? { capsule } : {}), candidate }
  }
  const parkedCandidateLimit = clampInteger(
    input.parkedCandidateLimit ?? DEFAULT_V2_PARKED_GOAL_CANDIDATE_LIMIT,
    0,
    MAX_V2_PARKED_GOAL_CANDIDATE_LIMIT,
  )
  const eligibleParked = goals
    .filter((goal) => goal.status === "parked" || goal.status === "blocked" || goal.status === "completed" || goal.status === "discarded")
    .sort(compareRecentGoals)
  const parkedById = new Map(eligibleParked.map((goal) => [goal.id, goal]))
  const retrieved = uniqueStrings(input.candidateGoalIds ?? []).flatMap((goalId) => {
    const goal = parkedById.get(goalId)
    return goal ? [goal] : []
  })
  const orderedParked = [...retrieved, ...eligibleParked.filter((goal) => !retrieved.some((item) => item.id === goal.id))]
  const foregroundGoal = input.selectedGoalId
    ? goals.find((goal) => goal.id === input.selectedGoalId)
    : foregroundGoals[0]
  const previousGoal = input.previousGoalId && input.previousGoalId !== foregroundGoal?.id
    ? goals.find((goal) => goal.id === input.previousGoalId)
    : undefined
  const totalLimit = Math.min(5, parkedCandidateLimit)
  const selectedGoals = [...(foregroundGoal ? [foregroundGoal] : []), ...(previousGoal ? [previousGoal] : []), ...orderedParked]
    .filter((goal, index, all) => all.findIndex((candidate) => candidate.id === goal.id) === index)
    .slice(0, totalLimit)
  const candidates = selectedGoals.map((goal, index) => toCandidate(goal, index + 1))
  const foreground = foregroundGoal ? candidates.find((candidate) => candidate.goal.id === foregroundGoal.id) : undefined
  const parked = candidates.filter((candidate) => candidate.goal.id !== foregroundGoal?.id)
  return {
    ...(foreground ? { foreground } : {}),
    parked,
    candidates,
    totalEligibleParked: eligibleParked.length,
    parkedCandidateLimit,
  }
}

export const resolveSocratesGoal = async (input: {
  agent: SocratesAgent
  projectId: string
  conversationId: string
  sessionId: string
  flowId: string
  turnId: string
  workspacePath: string
  runtimeConfig: RuntimeConfig
  userMessage: string
  goals: readonly V2Goal[]
  selectedGoalId?: string
  previousGoalId?: string
  capsules?: readonly V2GoalCapsule[]
  selectedGoalTurns?: readonly Readonly<{ goalId?: string; user: string; assistant: string }>[]
  clarificationAnswer?: string
  parkedCandidateLimit?: number
  candidateGoalIds?: readonly string[]
  cacheKey?: string
  abortSignal?: AbortSignal
}): Promise<SocratesGoalResolutionResult> => {
  const candidates = selectV2GoalRoutingCandidates(input)
  const current = candidates.foreground ? toSocratesResolutionCandidate(candidates.foreground) : undefined
  const older = candidates.candidates
    .filter((candidate) => candidate.goal.id !== candidates.foreground?.goal.id)
    .map(toSocratesResolutionCandidate)
  const latest = input.selectedGoalTurns?.at(-1)
  const resolved = await input.agent.resolveGoal({
    projectId: input.projectId,
    conversationId: input.conversationId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    workspacePath: input.workspacePath,
    providerId: input.runtimeConfig.providerId,
    modelId: input.runtimeConfig.modelId,
    runtimeConfig: input.runtimeConfig,
    userMessage: input.userMessage,
    ...(current ? { current } : {}),
    older,
    ...(latest ? { latestExchange: { user: latest.user, assistant: latest.assistant } } : {}),
    ...(input.clarificationAnswer ? { clarificationAnswer: input.clarificationAnswer } : {}),
    ...(input.cacheKey ? { cacheKey: input.cacheKey } : {}),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  })
  const usage = aggregateUsages(resolved.attempt.usages)
  const failure = resolved.attempt.error ? classifyGoalResolutionFailure(resolved.attempt.error.code) : undefined
  return {
    decision: toV2GoalResolutionDecision(resolved.decision, candidates),
    candidates,
    source: resolved.source,
    ...(resolved.source === "fallback" && failure ? { fallbackReason: failure } : {}),
    modelAttempt: {
      providerId: resolved.attempt.providerId,
      modelId: resolved.attempt.modelId,
      status: resolved.attempt.status,
      startedAt: resolved.attempt.startedAt,
      completedAt: resolved.attempt.completedAt,
      durationMs: resolved.attempt.durationMs,
      ...(usage ? { usage } : {}),
      ...(resolved.attempt.error ? {
        errorCode: modelAttemptErrorCode(resolved.attempt.error.code),
        errorMessage: resolved.attempt.error.message,
      } : {}),
    },
  }
}

const classifyGoalResolutionFailure = (
  code: string,
): NonNullable<SocratesGoalResolutionResult["fallbackReason"]> => {
  if (code === "structured_agent_output_invalid") return "invalid_output"
  if (code === "structured_generation_unavailable" || code === "provider_structured_generation_unavailable") {
    return "structured_generation_unavailable"
  }
  if (code === "agent_timeout" || code === "model_stream_idle_timeout") return "timeout"
  return "provider_error"
}

const modelAttemptErrorCode = (code: string): "timeout" | "provider_error" | "invalid_output" => {
  const failure = classifyGoalResolutionFailure(code)
  return failure === "structured_generation_unavailable" ? "provider_error" : failure
}

const toSocratesResolutionCandidate = (candidate: V2GoalRoutingCandidate) => ({
  candidate: candidate.candidate,
  status: candidate.goal.status,
  title: candidate.goal.title,
  objective: candidate.goal.summary ?? candidate.goal.title,
  progress: candidate.capsule?.summary ?? candidate.goal.summary ?? "No verified progress recorded yet.",
})

const toV2GoalResolutionDecision = (
  value: SocratesGoalResolutionOutput,
  candidates: V2GoalRoutingCandidateSet,
): V2GoalRoutingDecision => {
  if (value.decision === "new") return { action: "create", title: value.title }
  if (value.decision === "clarify") {
    return {
      action: "clarify",
      clarificationQuestion: value.question,
      clarificationGoalIds: candidates.candidates.map((candidate) => candidate.goal.id),
    }
  }
  const selected = value.decision === "current"
    ? candidates.foreground
    : candidates.candidates.find((candidate) => candidate.candidate === value.candidate)
  if (!selected) throw new Error("Socrates selected an unavailable goal candidate.")
  return {
    action: selected.goal.id === candidates.foreground?.goal.id && selected.goal.status === "foreground" ? "continue" : "resume",
    primaryGoalId: selected.goal.id,
  }
}

export const planV2GoalRoutingTransition = (input: {
  flowId: string
  goals: readonly V2Goal[]
  decision: V2GoalRoutingDecision
  createdGoalId?: string
}): V2GoalRoutingPlan => {
  if (input.decision.action === "clarify") {
    throw new Error("A clarification decision must be resolved before planning a foreground transition.")
  }
  const goals = input.goals.filter((goal) => goal.flowId === input.flowId)
  const currentForeground = goals.filter((goal) => goal.status === "foreground")
  if (currentForeground.length > 1) {
    throw new Error(`V2 Flow ${input.flowId} has more than one foreground goal.`)
  }
  const goalsById = new Map(goals.map((goal) => [goal.id, goal]))
  const selectedId = input.decision.action === "create" ? input.createdGoalId : input.decision.primaryGoalId
  if (!selectedId) throw new Error("A created goal id or primary goal id is required to plan a foreground transition.")
  if (input.decision.action !== "create" && !goalsById.has(selectedId)) {
    throw new Error(`V2 goal ${selectedId} is not part of Flow ${input.flowId}.`)
  }
  if (input.decision.action === "continue" && currentForeground[0]?.id !== selectedId) {
    throw new Error("A continue decision must target the current foreground goal.")
  }
  if (input.decision.action === "resume") {
    const selected = goalsById.get(selectedId)
    if (!selected || (selected.status !== "parked" && selected.status !== "blocked" && selected.status !== "completed" && selected.status !== "discarded")) {
      throw new Error("A resume decision must target a paused or completed focus.")
    }
  }

  const transitions: Array<{ goalId: string; from: V2GoalStatus; to: V2GoalStatus }> = []
  const foreground = currentForeground[0]
  if (foreground && foreground.id !== selectedId) {
    transitions.push({ goalId: foreground.id, from: "foreground", to: "parked" })
  }
  const selected = goalsById.get(selectedId)
  if (selected && selected.status !== "foreground") {
    transitions.push({ goalId: selected.id, from: selected.status, to: "foreground" })
  }

  return {
    action: input.decision.action,
    foregroundGoalId: selectedId,
    createGoal: input.decision.action === "create",
    transitions,
  }
}

const aggregateUsages = (usages: readonly ModelUsage[]): ModelUsage | undefined => {
  if (usages.length === 0) return undefined
  const sum = (field: keyof ModelUsage): number | undefined => {
    const values = usages.map((usage) => usage[field]).filter((value): value is number => typeof value === "number")
    return values.length ? values.reduce((total, value) => total + value, 0) : undefined
  }
  const inputTokens = sum("inputTokens")
  const outputTokens = sum("outputTokens")
  const reasoningTokens = sum("reasoningTokens")
  const cachedInputTokens = sum("cachedInputTokens")
  const cacheWriteTokens = sum("cacheWriteTokens")
  const uncachedInputTokens = sum("uncachedInputTokens")
  const totalTokens = sum("totalTokens")
  const costUsd = sum("costUsd")
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(uncachedInputTokens === undefined ? {} : { uncachedInputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(costUsd === undefined ? {} : { costUsd }),
    raw: { attempts: usages.map((usage) => usage.raw ?? usage.providerMetadata ?? null) },
  }
}

const compareRecentGoals = (left: V2Goal, right: V2Goal): number =>
  Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt) ||
  Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
  left.id.localeCompare(right.id)

const compareGoalIdentity = (left: V2Goal, right: V2Goal): number => left.id.localeCompare(right.id)

const latestCapsuleByGoal = (capsules: readonly V2GoalCapsule[]): Map<string, V2GoalCapsule> => {
  const latest = new Map<string, V2GoalCapsule>()
  for (const capsule of capsules) {
    const current = latest.get(capsule.goalId)
    if (!current || capsule.version > current.version || (capsule.version === current.version && capsule.id.localeCompare(current.id) > 0)) {
      latest.set(capsule.goalId, capsule)
    }
  }
  return latest
}

const uniqueStrings = (values: readonly string[]): string[] => [...new Set(values)]
const clampInteger = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.floor(Number.isFinite(value) ? value : min)))
