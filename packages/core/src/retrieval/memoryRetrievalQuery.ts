const MEMORY_QUERY_MAX_CHARS = 1_000

export type MemoryGoalQueryContext = Readonly<{
  goalId: string
  title: string
  objective?: string
  note?: string
  decisions?: readonly string[]
  openDecisions?: readonly string[]
  nextActions?: readonly string[]
  blockers?: readonly string[]
}>

export const buildGoalAwareMemoryQuery = (input: {
  userMessage: string
  goal?: MemoryGoalQueryContext
  phase: "broad" | "bound"
}): string => {
  const task = normalizeQueryText(input.userMessage)
  const goalLines = input.goal ? [
    `Goal: ${normalizeQueryText(input.goal.title)}`,
    ...(input.goal.objective ? [`Objective: ${normalizeQueryText(input.goal.objective)}`] : []),
    ...(input.goal.note ? [`Current state: ${normalizeQueryText(input.goal.note)}`] : []),
    ...(input.goal.decisions?.length ? [`Decisions: ${normalizeQueryText(input.goal.decisions.join("; "))}`] : []),
    ...(input.goal.openDecisions?.length ? [`Open decisions: ${normalizeQueryText(input.goal.openDecisions.join("; "))}`] : []),
    ...(input.goal.nextActions?.length ? [`Next actions: ${normalizeQueryText(input.goal.nextActions.join("; "))}`] : []),
    ...(input.goal.blockers?.length ? [`Blockers: ${normalizeQueryText(input.goal.blockers.join("; "))}`] : []),
  ] : []
  const taskLine = `Task: ${task}`
  const prioritizedLines = input.phase === "bound"
    ? [...goalLines, taskLine]
    : [taskLine, ...goalLines]
  const fullQuery = prioritizedLines.join("\n")
  if (fullQuery.length <= MEMORY_QUERY_MAX_CHARS) return fullQuery
  if (goalLines.length === 0) return projectWholeTerms([taskLine], MEMORY_QUERY_MAX_CHARS)
  const primaryLines = input.phase === "bound" ? goalLines : [taskLine]
  const secondaryLines = input.phase === "bound" ? [taskLine] : goalLines
  const primary = projectWholeTerms(primaryLines, 600)
  const secondary = projectWholeTerms(secondaryLines, MEMORY_QUERY_MAX_CHARS - primary.length - 1)
  return `${primary}\n${secondary}`
}

const normalizeQueryText = (value: string): string => value.trim().replace(/\s+/g, " ")

// Automatic retrieval queries are disposable search projections. Exact task and
// capsule text remains canonical and is attached independently to model context.
const projectWholeTerms = (lines: readonly string[], maxChars: number): string => {
  const terms = lines.flatMap((line) => line.split(/\s+/u)).filter(Boolean)
  const selected: string[] = []
  let length = 0
  for (const term of terms) {
    if (term.length > maxChars) continue
    const nextLength = length + (selected.length === 0 ? 0 : 1) + term.length
    if (nextLength > maxChars) continue
    selected.push(term)
    length = nextLength
  }
  return selected.join(" ") || "Task"
}
