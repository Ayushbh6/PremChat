import { goalSearchInputSchema, goalSearchOutputSchema } from "@socrates/contracts"
import type { SocratesTool } from "./types"

export const goalSearchTool: SocratesTool<typeof goalSearchInputSchema._type, typeof goalSearchOutputSchema._type> = {
  name: "goal_search",
  description:
    "Search older goals in the current project when the five supplied candidates are insufficient. This read-only escape hatch returns at most three numbered goal cards. Prefer the supplied candidates and use this only when needed.",
  inputSchema: goalSearchInputSchema,
  resultSchema: goalSearchOutputSchema,
  permission: "read",
  executeLane: "parallel",
  category: "search",
  decidePolicy: () => ({ type: "auto" }),
  execute: (input, context) => {
    if (!context.executors.goal_search) throw new Error("goal_search executor is unavailable.")
    return context.executors.goal_search(input, context)
  },
  summary: (output) => output.summary,
  resultPreview: (output) => output.results
    .map((result) => `${result.candidate}. ${result.title} (${result.status}): ${result.note.slice(0, 240)}`)
    .join("\n"),
}
