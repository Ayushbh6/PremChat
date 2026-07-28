import {
  contextDispositionToolInputSchema,
  contextDispositionToolOutputSchema,
  type ContextDispositionToolInput,
  type ContextDispositionToolOutput,
} from "@socrates/contracts"
import { SocratesError } from "@socrates/shared"
import type { SocratesTool } from "./types"

export const contextDispositionTool: SocratesTool<ContextDispositionToolInput, ContextDispositionToolOutput> = {
  name: "context_disposition",
  displayName: "Context disposition",
  description:
    "Release unneeded large temporary result handles from the current model-visible turn. Call only alongside at least one normal tool call, never alone and never before a final answer. Pass release with one or more exact R handles from result-local notices. Omit handles that are still needed. Release never deletes exact audit evidence.",
  inputSchema: contextDispositionToolInputSchema,
  resultSchema: contextDispositionToolOutputSchema,
  permission: "read",
  executeLane: "parallel",
  category: "other",
  decidePolicy: () => ({ type: "auto" }),
  execute: async (input, context) => {
    if (!context.applyContextDisposition) {
      throw new SocratesError("context_disposition_unavailable", "Current-turn context disposition is unavailable.", { recoverable: true })
    }
    return context.applyContextDisposition(input)
  },
  summary: (output) => output.summary,
  resultPreview: (output) => output.summary,
}
