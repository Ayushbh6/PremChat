import { describe, expect, it } from "vitest"
import type { ModelProvider, StructuredModelRequest } from "@socrates/providers"
import {
  V2ContextPolicyError,
  addV2ContextItem,
  appendImmutableV2Evidence,
  applyV2ContextDispositions,
  assembleV2GoalWorkingContext,
  capsuleRefreshReason,
  createImmutableEvidenceRecord,
  createV2ContextItem,
  deriveV2ContextBudget,
  getV2ContextReviewRequirements,
  planV2GoalRoutingTransition,
  refreshV2GoalCapsule,
  resolveSocratesGoal,
  selectV2GoalRoutingCandidates,
  type ImmutableEvidenceRecord,
  type V2ContextItem,
  type V2ContextState,
  type V2FlowContextMessage,
  type V2Goal,
} from "../v2"
import { capabilityCatalog } from "../capabilities/CapabilityCatalog"
import { socratesGoalResolutionPhaseManifest, socratesMainAgentDefinition } from "../agent/agentDefinitions"
import { SocratesAgent } from "../agent/SocratesAgent"

const flowId = "flow_1"

describe("V2 Flow goal routing", () => {
  it("uses one main Socrates capability catalog without mutable goal authority", () => {
    const mainTools = capabilityCatalog.resolve(socratesMainAgentDefinition.roleManifest).list().map((capability) => capability.tool.name)
    expect(mainTools).toContain("handover_to_frontier")
    expect(mainTools).toContain("trace_retrieve")
    expect(mainTools).not.toContain("focus_ledger")
    expect(mainTools).not.toContain("turn_evidence")
    expect(capabilityCatalog.resolve(socratesGoalResolutionPhaseManifest).modelDefinitions()).toEqual([])
    expect(capabilityCatalog.inventory().map((capability) => capability.modelToolName)).not.toContain("goal_search")
    expect(capabilityCatalog.inventory().map((capability) => capability.modelToolName)).not.toContain("memory_search")
  })

  it("bounds a 30-goal Flow to five cards and honors retrieved goal ids without deciding semantically", () => {
    const goals: V2Goal[] = [goal("goal_0", "foreground", "Current implementation")]
    for (let index = 1; index < 30; index += 1) {
      goals.push(goal(`goal_${index}`, "parked", index === 27 ? "Vienna travel itinerary" : `Parked topic ${index}`))
    }
    const selected = selectV2GoalRoutingCandidates({
      flowId,
      userMessage: "resume the Vienna travel itinerary",
      goals,
      parkedCandidateLimit: 5,
      candidateGoalIds: ["goal_27"],
    })

    expect(selected.candidates).toHaveLength(5)
    expect(selected.parked).toHaveLength(4)
    expect(selected.totalEligibleParked).toBe(29)
    expect(selected.parked[0]?.goal.id).toBe("goal_27")
    expect(selected.foreground?.goal.id).toBe("goal_0")
  })

  it("keeps the selected completed goal first and protects the immediately previous goal from semantic displacement", () => {
    const goals = [
      goal("selected", "completed", "Review and improve focus ledger"),
      goal("previous", "parked", "Review memory ledger"),
      goal("semantic", "parked", "Unrelated semantic hit"),
      goal("recent", "parked", "Recent work"),
    ]
    const selected = selectV2GoalRoutingCandidates({
      flowId,
      userMessage: "Okay, now add the requested information",
      goals,
      selectedGoalId: "selected",
      previousGoalId: "previous",
      candidateGoalIds: ["semantic"],
    })
    expect(selected.candidates.map((candidate) => candidate.goal.id).slice(0, 3)).toEqual(["selected", "previous", "semantic"])
  })

  it("uses the same Socrates prompt and resolves current, older, new, and clarify", async () => {
    const decisions = [
      { decision: "current" },
      { decision: "older", candidate: 2 },
      { decision: "new", title: "Design the release checklist" },
      { decision: "clarify", question: "Should I continue API work or presentation work?" },
    ] as const
    const requests: StructuredModelRequest<unknown>[] = []
    let call = 0
    const provider = providerWithStructured(async <TOutput>(request: StructuredModelRequest<TOutput>) => {
      requests.push(request as StructuredModelRequest<unknown>)
      return { output: decisions[call++] as TOutput }
    })
    const agent = new SocratesAgent(provider)
    const base = {
      agent,
      projectId: "project_1",
      conversationId: flowId,
      sessionId: "session_1",
      flowId,
      workspacePath: "/workspace",
      runtimeConfig: runtimeConfig(),
      goals: [goal("active", "foreground", "API work"), goal("slides", "parked", "Presentation")],
      selectedGoalId: "active",
      previousGoalId: "slides",
      selectedGoalTurns: [{ goalId: "active", user: "Review the API", assistant: "The API review is complete." }],
    }
    const current = await resolveSocratesGoal({ ...base, turnId: "turn_1", userMessage: "Now fix the issue we found." })
    const older = await resolveSocratesGoal({ ...base, turnId: "turn_2", userMessage: "Return to the slides." })
    const fresh = await resolveSocratesGoal({ ...base, turnId: "turn_3", userMessage: "Let's design release checks." })
    const clarify = await resolveSocratesGoal({ ...base, turnId: "turn_4", userMessage: "What about the other one?" })

    expect(current.decision).toEqual({ action: "continue", primaryGoalId: "active" })
    expect(older.decision).toEqual({ action: "resume", primaryGoalId: "slides" })
    expect(fresh.decision).toEqual({ action: "create", title: "Design the release checklist" })
    expect(clarify.decision).toMatchObject({ action: "clarify", clarificationQuestion: "Should I continue API work or presentation work?" })
    expect(requests.every((request) => request.system.includes("You are Socrates"))).toBe(true)
    expect(requests.every((request) => request.system.includes("<socrates_goal_resolution_phase>"))).toBe(true)
    expect(requests.every((request) => request.system.includes("Never guess the first older candidate"))).toBe(true)
    expect(capabilityCatalog.resolve(socratesGoalResolutionPhaseManifest).modelDefinitions()).toEqual([])
    expect(JSON.stringify(requests[0]?.messages)).toContain("The API review is complete.")
  })

  it("falls back conservatively to current or clarification when the same-Socrates phase fails", async () => {
    const agent = new SocratesAgent(providerWithStructured(async () => { throw new Error("provider unavailable") }))
    const common = {
      agent,
      projectId: "project_1",
      conversationId: flowId,
      sessionId: "session_1",
      flowId,
      workspacePath: "/workspace",
      runtimeConfig: runtimeConfig(),
      userMessage: "Can you take another look?",
    }
    const current = await resolveSocratesGoal({
      ...common,
      turnId: "turn_current",
      goals: [goal("active", "foreground", "Build V2")],
      selectedGoalId: "active",
    })
    const empty = await resolveSocratesGoal({ ...common, turnId: "turn_empty", goals: [] })

    expect(current.source).toBe("fallback")
    expect(current.decision).toEqual({ action: "continue", primaryGoalId: "active" })
    expect(empty.source).toBe("fallback")
    expect(empty.decision.action).toBe("clarify")
  })

  it("repairs one invalid same-Socrates resolution and aggregates both usages", async () => {
    let attempts = 0
    let systemPrompt = ""
    const provider = providerWithStructured(async <TOutput>(request: StructuredModelRequest<TOutput>) => {
      attempts += 1
      systemPrompt = request.system
      if (attempts === 1) {
        return {
          output: {
            decision: "older",
            candidate: 99,
          } as TOutput,
          usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 },
        }
      }
      return {
        output: {
          decision: "current",
        } as TOutput,
        usage: { inputTokens: 9, outputTokens: 2, totalTokens: 11 },
      }
    })

    const result = await resolveSocratesGoal({
      agent: new SocratesAgent(provider),
      projectId: "project_1",
      conversationId: flowId,
      sessionId: "session_1",
      flowId,
      turnId: "turn_repair",
      workspacePath: "/workspace",
      userMessage: "keep going",
      goals: [goal("active", "foreground", "Build V2")],
      selectedGoalId: "active",
      runtimeConfig: runtimeConfig(),
    })

    expect(attempts).toBe(2)
    expect(systemPrompt).toContain("You are Socrates")
    expect(systemPrompt).toContain("<socrates_goal_resolution_phase>")
    expect(result.source).toBe("model")
    expect(result.decision).toMatchObject({ action: "continue", primaryGoalId: "active" })
    expect(result.modelAttempt?.usage).toMatchObject({ inputTokens: 17, outputTokens: 4, totalTokens: 21 })
  })

  it("plans exactly one foreground when resuming", () => {
    const plan = planV2GoalRoutingTransition({
      flowId,
      goals: [goal("active", "foreground", "Build V2"), goal("travel", "parked", "Travel"), goal("voice", "parked", "Voice")],
      decision: {
        action: "resume",
        primaryGoalId: "travel",
      },
    })

    expect(plan.foregroundGoalId).toBe("travel")
    expect(plan.transitions).toEqual([
      { goalId: "active", from: "foreground", to: "parked" },
      { goalId: "travel", from: "parked", to: "foreground" },
    ])
  })
})

describe("V2 Flow capsules", () => {
  it("refreshes immutable capsule versions on material boundaries and staleness", () => {
    const active = goal("active", "foreground", "Build V2")
    const first = refreshV2GoalCapsule({
      capsuleId: "capsule_1",
      goal: active,
      patch: { summary: "Router complete", nextActions: ["Add context policy"] },
      sourceThroughSequence: 2,
      tokenEstimate: 12,
      createdAt: "2026-07-17T10:00:00.000Z",
    })
    const second = refreshV2GoalCapsule({
      capsuleId: "capsule_2",
      goal: active,
      previous: first,
      patch: { summary: "Context policy complete" },
      sourceThroughSequence: 3,
      tokenEstimate: 14,
      createdAt: "2026-07-17T10:01:00.000Z",
    })

    expect(first.version).toBe(1)
    expect(second.version).toBe(2)
    expect(first.summary).toBe("Router complete")
    expect(capsuleRefreshReason({ capsule: second, event: { kind: "goal_parked", sequence: 3 } })).toBe("parked")
    expect(capsuleRefreshReason({ capsule: second, event: { kind: "turn_completed", sequence: 9 } })).toBe("stale")
  })
})

describe("V2 Flow context disposition policy", () => {
  it("caps unresolved evidence at five and requires review after three subsequent completed turns", () => {
    let state: V2ContextState = { evidence: [], items: [] }
    for (let index = 0; index < 6; index += 1) state = addEvidenceAndItem(state, index)
    const firstFive = state.items.slice(0, 5).map((item) => ({ contextItemId: item.id, disposition: "unresolved" as const }))
    const unresolved = applyV2ContextDispositions({ state, decisions: firstFive, completedTurn: 10 })

    expect(getV2ContextReviewRequirements(unresolved.items, 12)).toMatchObject({
      remainingUnresolvedSlots: 0,
      dueNowIds: [],
    })
    expect(() => applyV2ContextDispositions({
      state: unresolved,
      decisions: [{ contextItemId: "item_5", disposition: "unresolved" }],
      completedTurn: 11,
    })).toThrowError(expect.objectContaining({ code: "unresolved_limit_exceeded" }))
    expect(getV2ContextReviewRequirements(unresolved.items, 13).dueNowIds).toHaveLength(5)
    expect(() => applyV2ContextDispositions({ state: unresolved, decisions: [], completedTurn: 13 })).toThrowError(
      expect.objectContaining({ code: "unresolved_review_due" }),
    )

    const reviewed = applyV2ContextDispositions({
      state: unresolved,
      decisions: unresolved.items.slice(0, 5).map((item) => ({ contextItemId: item.id, disposition: "release" as const })),
      completedTurn: 13,
    })
    expect(getV2ContextReviewRequirements(reviewed.items, 13).unresolvedIds).toEqual([])
  })

  it("releases only the active-context copy and retains immutable source evidence", () => {
    const initial = addEvidenceAndItem({ evidence: [], items: [] }, 1)
    const evidenceArray = initial.evidence
    const released = applyV2ContextDispositions({
      state: initial,
      decisions: [{ contextItemId: "item_1", disposition: "release" }],
      completedTurn: 2,
    })

    expect(released.evidence).toBe(evidenceArray)
    expect(released.evidence[0]?.exactContent).toBe("exact evidence 1")
    expect(released.items[0]).toMatchObject({ disposition: "release", active: false })
    expect(Object.isFrozen(released.evidence[0]?.ref)).toBe(true)
  })

  it("never permits replacement of an existing immutable evidence id", () => {
    const evidence = evidenceRecord(1)
    const state = appendImmutableV2Evidence({ evidence: [], items: [] }, evidence)
    expect(() => appendImmutableV2Evidence(state, evidenceRecord(1))).toThrowError(
      expect.objectContaining({ code: "duplicate_evidence" } satisfies Partial<V2ContextPolicyError>),
    )
  })
})

describe("V2 Flow Socrates context policy", () => {
  it("keeps one fixed 170k/180k policy regardless of selected model metadata", () => {
    const budget = deriveV2ContextBudget()

    expect(budget.compactionTriggerTokens).toBe(170_000)
    expect(budget.hardInputLimitTokens).toBe(180_000)
    expect(budget.recentGoalTailTokens).toBe(50_000)
  })

  it("assembles only foreground-linked or Flow-global history and bounds exact retrieval", async () => {
    const currentEvidence = evidenceRecord(1)
    const unrelatedEvidence = evidenceRecord(2)
    let state: V2ContextState = { evidence: [], items: [] }
    state = appendImmutableV2Evidence(state, currentEvidence)
    state = appendImmutableV2Evidence(state, unrelatedEvidence)
    state = addV2ContextItem(state, createV2ContextItem({
      id: "current_item",
      flowId,
      goalId: "goal_a",
      evidenceRef: currentEvidence.ref,
      completedTurn: 1,
      priority: 10,
    }))
    state = addV2ContextItem(state, createV2ContextItem({
      id: "unrelated_item",
      flowId,
      goalId: "goal_b",
      evidenceRef: unrelatedEvidence.ref,
      completedTurn: 1,
      priority: 100,
    }))
    const selectedByHook: string[][] = []
    const context = await assembleV2GoalWorkingContext({
      foregroundGoalId: "goal_a",
      query: "show exact evidence",
      messages: flowMessages(),
      contextItems: state.items,
      exactSelector: (candidates) => {
        selectedByHook.push(candidates.map((candidate) => candidate.contextItemId))
        return candidates.map((candidate) => candidate.contextItemId)
      },
      exactRetriever: (refs) => refs.map((ref) => ({
        evidenceRef: ref,
        exactContent: state.evidence.find((record) => record.ref.evidenceId === ref.evidenceId)?.exactContent ?? "",
      })),
    })

    expect(context.messages.map((message) => message.id)).toEqual(["global", "goal_a", "linked_a"])
    expect(context.excludedMessageIds).toContain("goal_b")
    expect(selectedByHook).toEqual([["current_item"]])
    expect(context.requestedExactEvidenceRefs.map((ref) => ref.evidenceId)).toEqual(["evidence_1"])
    expect(context.exactEvidence.map((material) => material.exactContent)).toEqual(["exact evidence 1"])
  })

  it("shares one hard evidence budget across distilled text and lazy exact retrieval", async () => {
    const ref = (index: number) => ({
      evidenceId: `budget_evidence_${index}`,
      flowId,
      sourceType: "retrieval_chunk",
      sourceLocator: `evidence://budget/${index}`,
      contentHash: `hash_${index}`,
      capturedAt: "2026-07-17T10:00:00.000Z",
    })
    const baseItem = (index: number): V2ContextItem => ({
      id: `budget_item_${index}`,
      flowId,
      goalId: "goal_a",
      evidenceRef: ref(index),
      disposition: "keep_exact",
      representation: "exact",
      tokenEstimate: 100,
      active: true,
      priority: 100 - index,
      createdAtCompletedTurn: 1,
      decidedAtCompletedTurn: 1,
    })
    const contextItems: V2ContextItem[] = [
      { ...baseItem(1), disposition: "distill", representation: "distilled", distilledText: "d".repeat(200), tokenEstimate: 50 },
      { ...baseItem(2), disposition: "distill", representation: "distilled", distilledText: "s".repeat(200), tokenEstimate: 50 },
      ...Array.from({ length: 50 }, (_, index) => baseItem(index + 3)),
    ]
    const retrievedBatches: string[][] = []
    const context = await assembleV2GoalWorkingContext({
      foregroundGoalId: "goal_a",
      query: "bounded evidence",
      messages: [],
      contextItems,
      budget: deriveV2ContextBudget(),
      evidenceTokenLimit: 250,
      exactRetriever: (refs) => {
        retrievedBatches.push(refs.map((candidate) => candidate.evidenceId))
        return refs.map((candidate) => ({ evidenceRef: candidate, exactContent: "e".repeat(400) }))
      },
    })

    expect(context.evidenceTokenLimit).toBe(250)
    expect(context.distilledItems).toHaveLength(2)
    expect(context.requestedExactEvidenceRefs).toHaveLength(1)
    expect(retrievedBatches[0]).toHaveLength(1)
    expect(context.exactEvidence).toHaveLength(1)
    expect(context.estimatedTokens).toBeLessThanOrEqual(250)
    expect(context.excludedContextItemIds).toHaveLength(49)
  })
})

const goal = (id: string, status: V2Goal["status"], title: string): V2Goal => ({
  id,
  flowId,
  projectId: "project_1",
  ordinal: Number(id.replace(/\D/g, "")) + 1 || 1,
  title,
  summary: title,
  kind: "work",
  status,
  origin: "user",
  priority: 50,
  pinned: false,
  lastActiveAt: `2026-07-17T10:${id.replace(/\D/g, "").padStart(2, "0").slice(-2)}:00.000Z`,
  createdAt: "2026-07-17T10:00:00.000Z",
  updatedAt: `2026-07-17T10:${id.replace(/\D/g, "").padStart(2, "0").slice(-2)}:00.000Z`,
})

const providerWithStructured = (generateStructured: NonNullable<ModelProvider["generateStructured"]>): ModelProvider => ({
  countTokens: async (request) => ({
    providerId: request.providerId,
    modelId: request.modelId,
    inputTokens: 1,
    baseTokens: 1,
    method: "local_tiktoken",
    safetyMarginPercent: 0,
  }),
  async *stream() {
    yield { type: "model.completed" }
  },
  generateStructured,
})

const runtimeConfig = () => ({
  id: "runtime_goal_resolution",
  providerId: "openrouter" as const,
  authMode: "api_key" as const,
  modelId: "main-socrates-model",
  thinkingEnabled: false,
  approvalMode: "read_only_auto" as const,
  sandboxMode: "read_only" as const,
})

const evidenceRecord = (index: number): ImmutableEvidenceRecord => createImmutableEvidenceRecord({
  evidenceId: `evidence_${index}`,
  flowId,
  sourceType: "tool_result",
  sourceLocator: `tool://result/${index}`,
  contentHash: `sha256:${index}`,
  capturedAt: "2026-07-17T10:00:00.000Z",
  exactContent: `exact evidence ${index}`,
})

const addEvidenceAndItem = (state: V2ContextState, index: number): V2ContextState => {
  const evidence = evidenceRecord(index)
  const withEvidence = appendImmutableV2Evidence(state, evidence)
  return addV2ContextItem(withEvidence, createV2ContextItem({
    id: `item_${index}`,
    flowId,
    goalId: "goal_a",
    evidenceRef: evidence.ref,
    completedTurn: 1,
  }))
}

const flowMessages = (): V2FlowContextMessage[] => [
  { id: "global", role: "system", content: "Flow-wide project instruction", occurredAt: "2026-07-17T10:00:00Z", scope: "flow" },
  { id: "goal_a", role: "user", content: "Current goal message", occurredAt: "2026-07-17T10:01:00Z", primaryGoalId: "goal_a" },
  { id: "goal_b", role: "assistant", content: "Unrelated goal history", occurredAt: "2026-07-17T10:02:00Z", primaryGoalId: "goal_b" },
  { id: "linked_a", role: "assistant", content: "Secondary link to current goal", occurredAt: "2026-07-17T10:03:00Z", primaryGoalId: "goal_b", linkedGoalIds: ["goal_a"] },
  { id: "unscoped", role: "assistant", content: "Legacy unscoped Flow message", occurredAt: "2026-07-17T10:04:00Z" },
]
