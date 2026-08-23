import {
  traceRetrieveMainToolInputSchema,
  type TraceRetrieveGlobalToolInput,
  type TraceRetrieveGlobalToolOutput,
  type TraceRetrieveMainToolInput,
  type TraceRetrieveMainToolOutput,
} from "@socrates/contracts"

type UnifiedTraceAuthority = {
  scope: "presented_context" | "current_goal" | "project"
  presentedConversationId: string
  goalId: string
  currentTurnId: string
  projectIds?: readonly string[]
}

export const retrieveUnifiedMainToolTraces = async (
  retrieveGlobal: (
    input: TraceRetrieveGlobalToolInput,
    authority: UnifiedTraceAuthority,
  ) => Promise<TraceRetrieveGlobalToolOutput>,
  input: {
    projectId: string
    projectIds?: readonly string[]
    presentedConversationId: string
    goalId: string
    currentTurnId: string
    request: TraceRetrieveMainToolInput
  },
): Promise<TraceRetrieveMainToolOutput> => {
  const request = traceRetrieveMainToolInputSchema.parse(input.request)
  const projectIds = [...new Set([input.projectId, ...(input.projectIds ?? [])])]
  const output = await retrieveGlobal(toGlobalInput(projectIds, request), {
    scope: request.operation === "inspect" ? "project" : request.scope ?? "project",
    presentedConversationId: input.presentedConversationId,
    goalId: input.goalId,
    currentTurnId: input.currentTurnId,
    projectIds,
  })
  return {
    results: output.results.map(({ projectTitle: _projectTitle, turnId: _turnId, ...result }) => result),
    totalMatches: output.totalMatches,
    ...(output.truncation ? { truncation: output.truncation } : {}),
    ...(output.warnings ? { warnings: output.warnings } : {}),
  }
}

const toGlobalInput = (
  projectIds: readonly string[],
  request: TraceRetrieveMainToolInput,
): TraceRetrieveGlobalToolInput => {
  if (request.operation === "inspect") {
    return {
      operation: "inspect",
      ...(request.result ? { result: request.result } : {}),
      ...(request.resultNumber ? { resultNumber: request.resultNumber } : {}),
      ...(request.conversationTitle ? { conversationTitle: request.conversationTitle } : {}),
      ...(request.turnNo ? { turnNo: request.turnNo } : {}),
      ...(request.offset !== undefined ? { offset: request.offset } : {}),
      ...(request.charLimit ? { charLimit: request.charLimit } : {}),
    }
  }
  const selectedProjects = [...new Set(projectIds)]
  const common = {
    scope: selectedProjects.length > 1 ? "all_projects" as const : "project" as const,
    projectId: selectedProjects.length > 1 ? selectedProjects : selectedProjects[0]!,
    ...(request.conversationTitle ? { conversationTitle: request.conversationTitle } : {}),
    ...(request.role ? { role: request.role } : {}),
    ...(request.createdAfter ? { createdAfter: request.createdAfter } : {}),
    ...(request.createdBefore ? { createdBefore: request.createdBefore } : {}),
    ...(request.limit ? { limit: request.limit } : {}),
  }
  if (request.mode === "audit") {
    return {
      ...common,
      mode: "audit",
      query: request.query,
      ...(request.include ? { include: request.include } : {}),
      ...(request.paths ? { paths: request.paths } : {}),
      ...(request.command ? { command: request.command } : {}),
      ...(request.toolNames ? { toolNames: request.toolNames } : {}),
    }
  }
  if (request.mode === "semantic" || request.mode === "combined") {
    return { ...common, mode: request.mode, query: request.query }
  }
  return {
    ...common,
    mode: "lexical",
    ...(request.query ? { query: request.query } : {}),
    ...("turnNo" in request && request.turnNo ? { turnNo: request.turnNo } : {}),
  }
}
