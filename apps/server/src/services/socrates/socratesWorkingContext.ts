import type { ModelMessage } from "@socrates/providers"
import type { SocratesStore } from "../store"
import type { GlobalSocratesStore } from "../socrates/socratesStore"

export const buildSocratesWorkingMessages = async (
  store: GlobalSocratesStore,
  sharedStore: SocratesStore,
  input: {
    projectId: string
    goalId: string
    query: string
    includeImages: boolean
    lateDeveloperContext?: string
  },
): Promise<ModelMessage[]> => {
  const history = store.getModelMessages(input.goalId, input.includeImages)
  // The shared compactor owns history reduction. A viewport adapter must never
  // silently truncate a separate tail or manufacture a second authority.
  const retained = await sharedStore.prepareExactGoalHistory({
    projectId: store.getGoalHomeProjectId(input.goalId),
    projectIds: store.goalRetrievalParentGroups(input.goalId).map((group) => group.projectId),
    goalId: input.goalId,
    query: input.query,
    messages: history,
  })
  if (!input.lateDeveloperContext) return retained
  const developer: ModelMessage = {
    role: "developer",
    content: `<socrates_runtime_context>\n<terminal_wake_context>${input.lateDeveloperContext}</terminal_wake_context>\n</socrates_runtime_context>`,
  }
  // Wake evidence must be the latest instruction. Putting it before the root
  // request can cause a model to repeat already-completed Terminal work.
  return [...retained, developer]
}
