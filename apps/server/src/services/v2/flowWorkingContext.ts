import type { ModelMessage } from "@socrates/providers"
import type { SocratesStore } from "../store"
import type { V2FlowStore } from "./flowStore"

export const buildFlowWorkingMessages = async (
  store: V2FlowStore,
  sharedStore: SocratesStore,
  input: {
    projectId: string
    flowId: string
    goalId: string
    query: string
    includeImages: boolean
    lateDeveloperContext?: string
  },
): Promise<ModelMessage[]> => {
  const history = store.getModelMessages(input.flowId, input.goalId, input.includeImages)
  // The shared compactor owns history reduction. A view adapter must never
  // silently truncate a separate tail or manufacture a second authority.
  const retained = await sharedStore.prepareExactGoalHistory({
    projectId: input.projectId,
    goalId: input.goalId,
    query: input.query,
    messages: history,
  })
  if (!input.lateDeveloperContext) return retained
  const developer: ModelMessage = {
    role: "developer",
    content: `<socrates_runtime_context>\n<terminal_wake_context>${input.lateDeveloperContext}</terminal_wake_context>\n</socrates_runtime_context>`,
  }
  const lastUserIndex = retained.map((message) => message.role).lastIndexOf("user")
  if (lastUserIndex < 0) return [...retained, developer]
  return [...retained.slice(0, lastUserIndex), developer, ...retained.slice(lastUserIndex)]
}
