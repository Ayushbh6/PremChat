import type { MemoryCandidate, ResolvedTurnMemoryItem } from "@socrates/contracts"
import type { ActiveGoalCard } from "../agent/goalContext"

const ALREADY_ATTACHED_SECTIONS = new Set([
  "always_apply_rules",
  "global_always_apply_rules",
  "core_identity",
  "voice_and_presence",
  "relationship_to_user",
])

const BACKEND_ONLY_SECTIONS = new Set(["runtime_context", "state_ledger"])

export const selectExactMemoryCandidates = (input: {
  candidates: readonly MemoryCandidate[]
  userMessage: string
  goal: ActiveGoalCard
  limit?: number
}): ResolvedTurnMemoryItem[] => {
  const limit = Math.max(0, Math.min(8, Math.floor(input.limit ?? 8)))
  if (limit === 0) return []
  const queryTerms = lexicalTerms([
    input.userMessage,
    input.goal.title,
    input.goal.objective ?? "",
    input.goal.taskRequest ?? "",
  ].join("\n"))
  const seen = new Set<string>()
  const eligible = input.candidates.flatMap((candidate, sourceIndex) => {
    if (ALREADY_ATTACHED_SECTIONS.has(candidate.sectionId) || BACKEND_ONLY_SECTIONS.has(candidate.sectionId)) return []
    const key = `${candidate.scope}:${candidate.surface}:${candidate.fileName}:${candidate.sectionId}`
    if (seen.has(key)) return []
    seen.add(key)
    const contentTerms = lexicalTerms(`${candidate.sectionHeading}\n${candidate.content}`)
    const overlap = [...queryTerms].reduce((total, term) => total + (contentTerms.has(term) ? 1 : 0), 0)
    return [{ candidate, sourceIndex, overlap }]
  })
  eligible.sort((left, right) =>
    right.overlap - left.overlap
    || left.candidate.resultNumber - right.candidate.resultNumber
    || left.sourceIndex - right.sourceIndex,
  )

  const selected: typeof eligible = []
  const selectedSurfaces = new Set<string>()
  for (const item of eligible) {
    if (selected.length >= limit) break
    if (selectedSurfaces.has(item.candidate.surface)) continue
    selected.push(item)
    selectedSurfaces.add(item.candidate.surface)
  }
  for (const item of eligible) {
    if (selected.length >= limit) break
    if (selected.includes(item)) continue
    selected.push(item)
  }
  return selected.map(({ candidate }) => ({
    surface: candidate.surface,
    reference: `${candidate.fileName}/${candidate.sectionId}`,
    scope: candidate.scope,
    content: candidate.content,
  }))
}

const lexicalTerms = (value: string): Set<string> => new Set(
  value.toLocaleLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3),
)
