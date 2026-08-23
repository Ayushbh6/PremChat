import { describe, expect, it } from "vitest"
import type { ModelProvider, StructuredModelRequest } from "@socrates/providers"
import {
  capsuleRefreshReason,
  planSocratesGoalRoutingTransition,
  refreshSocratesGoalCapsule,
  resolveSocratesGoal,
  selectSocratesGoalRoutingCandidates,
  type SocratesGoal,
} from "../socrates"
import { capabilityCatalog } from "../capabilities/CapabilityCatalog"
import { socratesGoalResolutionPhaseManifest, socratesMainAgentDefinition } from "../agent/agentDefinitions"
import { SocratesAgent } from "../agent/SocratesAgent"

const socratesTaskScope = "global_socrates"

describe("global Socrates goal routing", () => {
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

  it("bounds 30 global goals to five cards and honors retrieved goal ids without deciding semantically", () => {
    const goals: SocratesGoal[] = [goal("goal_0", "foreground", "Current implementation")]
    for (let index = 1; index < 30; index += 1) {
      goals.push(goal(`goal_${index}`, "parked", index === 27 ? "Vienna travel itinerary" : `Parked topic ${index}`))
    }
    const selected = selectSocratesGoalRoutingCandidates({
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
    const selected = selectSocratesGoalRoutingCandidates({
      userMessage: "Okay, now add the requested information",
      goals,
      selectedGoalId: "selected",
      previousGoalId: "previous",
      candidateGoalIds: ["semantic"],
    })
    expect(selected.candidates.map((candidate) => candidate.goal.id).slice(0, 3)).toEqual(["selected", "previous", "semantic"])
  })

  it("keeps an explicitly selected canonical global goal", () => {
    const foreign = goal("foreign", "foreground", "Global goal")
    const selected = selectSocratesGoalRoutingCandidates({
      userMessage: "Continue the foreign-owned goal",
      goals: [foreign, goal("transport", "parked", "Transport-local goal")],
      selectedGoalId: foreign.id,
      candidateGoalIds: [foreign.id],
    })

    expect(selected.foreground?.goal).toMatchObject({ id: "foreign" })
    expect(selected.candidates.map((candidate) => candidate.goal.id)).toEqual(["foreign", "transport"])
  })

  it("uses the same Socrates prompt and resolves current, older, new, and clarify", async () => {
    const decisions = [
      { decision: "current", candidate: null, title: null, question: null },
      { decision: "older", candidate: 2, title: null, question: null },
      { decision: "new", candidate: null, title: "Design the release checklist", question: null },
      { decision: "clarify", candidate: null, title: null, question: "Should I continue API work or presentation work?" },
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
      conversationId: socratesTaskScope,
      sessionId: "session_1",
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
    expect(requests.every((request) => request.system.includes("explicit request to return to, resume, switch back to, or reopen"))).toBe(true)
    expect(requests.every((request) => request.system.includes("Never guess the first older candidate"))).toBe(true)
    expect(capabilityCatalog.resolve(socratesGoalResolutionPhaseManifest).modelDefinitions()).toEqual([])
    expect(JSON.stringify(requests[0]?.messages)).toContain("The API review is complete.")
  })

  it("falls back conservatively to current or clarification when the same-Socrates phase fails", async () => {
    const agent = new SocratesAgent(providerWithStructured(async () => { throw new Error("provider unavailable") }))
    const common = {
      agent,
      projectId: "project_1",
      conversationId: socratesTaskScope,
      sessionId: "session_1",
      workspacePath: "/workspace",
      runtimeConfig: runtimeConfig(),
      userMessage: "Can you take another look?",
    }
    const current = await resolveSocratesGoal({
      ...common,
      turnId: "turn_current",
      goals: [goal("active", "foreground", "Build Socrates")],
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
            title: null,
            question: null,
          } as TOutput,
          usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 },
        }
      }
      return {
        output: {
          decision: "current",
          candidate: null,
          title: null,
          question: null,
        } as TOutput,
        usage: { inputTokens: 9, outputTokens: 2, totalTokens: 11 },
      }
    })

    const result = await resolveSocratesGoal({
      agent: new SocratesAgent(provider),
      projectId: "project_1",
      conversationId: socratesTaskScope,
      sessionId: "session_1",
      turnId: "turn_repair",
      workspacePath: "/workspace",
      userMessage: "keep going",
      goals: [goal("active", "foreground", "Build Socrates")],
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
    const plan = planSocratesGoalRoutingTransition({
      goals: [goal("active", "foreground", "Build Socrates"), goal("travel", "parked", "Travel"), goal("voice", "parked", "Voice")],
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

describe("global Socrates goal capsules", () => {
  it("refreshes immutable capsule versions on material boundaries and staleness", () => {
    const active = goal("active", "foreground", "Build Socrates")
    const first = refreshSocratesGoalCapsule({
      capsuleId: "capsule_1",
      goal: active,
      patch: { summary: "Router complete", nextActions: ["Add context policy"] },
      sourceThroughSequence: 2,
      tokenEstimate: 12,
      createdAt: "2026-07-17T10:00:00.000Z",
    })
    const second = refreshSocratesGoalCapsule({
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

const goal = (id: string, status: SocratesGoal["status"], title: string): SocratesGoal => ({
  id,
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
