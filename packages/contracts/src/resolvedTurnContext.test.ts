import { describe, expect, it } from "vitest"
import { resolvedTurnContextSchema, resolvedTurnContextSeedSchema } from "./resolvedTurnContext"
import { socratesGoalResolutionModelOutputSchema, socratesGoalResolutionOutputSchema } from "./turnResolution"

const exact = "x".repeat(30_000)
const seed = {
  goal: { title: "Converge Flow", objective: "Use one lifecycle.", state: "foreground", progress: exact, openDecisions: [], blockers: [] },
  task: { ordinal: 3, request: exact },
  latestExchange: { user: exact, assistant: exact },
  retrieval: { goalCandidates: "completed" as const, memoryCandidates: "completed" as const, capabilityCandidates: "completed" as const, warnings: [] },
}

describe("resolved turn context contracts", () => {
  it("preserves selected exact text without per-item clipping limits", () => {
    expect(resolvedTurnContextSeedSchema.parse(seed)).toEqual(seed)
    const result = resolvedTurnContextSchema.parse({
      ...seed,
      memory: [{ surface: "project_memory", reference: "MEMORY.md/durable_decisions", scope: "project", content: exact }],
      capabilities: [],
    })
    expect(result.task.request).toBe(exact)
    expect(result.latestExchange?.assistant).toBe(exact)
    expect(result.memory[0]?.content).toBe(exact)
  })

  it("rejects view policy and opaque authority fields", () => {
    expect(resolvedTurnContextSeedSchema.safeParse({ ...seed, presentation: { kind: "flow" } }).success).toBe(false)
    expect(resolvedTurnContextSeedSchema.safeParse({ ...seed, goalId: "v2goal_internal" }).success).toBe(false)
  })

  it("accepts only the four semantic goal decisions", () => {
    expect(socratesGoalResolutionOutputSchema.safeParse({ decision: "current" }).success).toBe(true)
    expect(socratesGoalResolutionOutputSchema.safeParse({ decision: "older", candidate: 2 }).success).toBe(true)
    expect(socratesGoalResolutionOutputSchema.safeParse({ decision: "new", title: "Handle today's email" }).success).toBe(true)
    expect(socratesGoalResolutionOutputSchema.safeParse({ decision: "clarify", question: "Which outcome do you mean?" }).success).toBe(true)
    expect(socratesGoalResolutionOutputSchema.safeParse({ decision: "resume", candidate: 2 }).success).toBe(false)
    expect(socratesGoalResolutionOutputSchema.safeParse({ decision: "current", candidate: 1 }).success).toBe(false)
    expect(socratesGoalResolutionOutputSchema.safeParse({ decision: "older" }).success).toBe(false)
    expect(socratesGoalResolutionModelOutputSchema.safeParse({
      decision: "older",
      candidate: 2,
      title: null,
      question: null,
    }).success).toBe(true)
  })
})
