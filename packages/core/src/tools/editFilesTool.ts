import { editFilesToolInputSchema, editFilesToolOutputSchema } from "@socrates/contracts"
import { SocratesError } from "@socrates/shared"
import type { SocratesTool } from "./types"

export const editFilesTool: SocratesTool<typeof editFilesToolInputSchema._type, typeof editFilesToolOutputSchema._type> = {
  name: "edit_files",
  description:
    'Write global memory-agent targets through scoped names only. Identity and user-profile replacements require sectionId plus exact section-local oldText/newText; whole-document replacements are invalid. Use move with exact sourceText, canonical destinationText, source/destination section ids, and evidence rationale. target="skill" creates only a user-approved Skill Writer proposal. Tool docs are read-only and arbitrary paths are never accepted.',
  inputSchema: editFilesToolInputSchema,
  resultSchema: editFilesToolOutputSchema,
  permission: "mutate",
  executeLane: "mutation",
  category: "file",
  decidePolicy: () => ({ type: "auto" }),
  execute: (input, context) => {
    if (!context.executors.edit_files) {
      throw new SocratesError("edit_files_tool_unavailable", "edit_files is not available in this runtime.", { recoverable: true })
    }
    return context.executors.edit_files(input, context)
  },
  summary: (output) => `${output.status} ${output.target}${output.name ? `/${output.name}` : ""}.`,
  resultPreview: (output) => output.diff ?? `${output.status}: ${output.path}`,
  metrics: (output) => ({ filesEdited: output.changed ? 1 : 0 }),
}
