import { editToolInputSchema, editToolOutputSchema } from "@socrates/contracts"
import type { SocratesTool } from "./types"
import { decideAccess } from "./accessPolicy"

const previewEdit = (input: typeof editToolInputSchema._type): string => {
  if ("content" in input) {
    return `write: ${input.path}`
  }
  return `replace: ${input.path}`
}

const decideEditPolicy: SocratesTool<typeof editToolInputSchema._type, typeof editToolOutputSchema._type>["decidePolicy"] = async (
  input,
  context,
) => {
  if ((!context.filesystemAuthorization && context.runtimeConfig.approvalMode === "approve_all") || decideAccess({
    authorization: context.filesystemAuthorization,
    action: "structured_write",
    targetPath: input.path,
    workspacePath: context.workspacePath,
  }) === "automatic") {
    return { type: "auto" }
  }

  const preview = await context.executors.edit(input, { ...context, previewOnly: true })

  return {
    type: "approval_required",
    request: {
      actionKind: "file_write",
      title: "Approve file edit",
      description: "Socrates wants to apply this exact file change outside the task's automatic write scope.",
      actionPreview: preview.diff.trim().length > 0 ? preview.diff : previewEdit(input),
      risk: "medium",
    },
  }
}

export const editTool: SocratesTool<typeof editToolInputSchema._type, typeof editToolOutputSchema._type> = {
  name: "edit",
  description:
    "Create or modify one governed resource or file inside the current filesystem access scope. Relative paths use the working path; authorized absolute paths are supported. Read an existing target in the current turn before editing it. Durable Socrates memory, notes, and repo docs require an exact section URI; their base document URIs are read/search only. For existing text, send one edits array; every oldString is matched against the same original version, overlapping edits are rejected, and the write is atomic. Set replaceAll only when every occurrence should change. Use content for new files, or content with overwrite: true only for a deliberate full rewrite. Identity, user profile, tool guidance, and installed skills are read-only here; propose identity/profile memory through memory_note and manage skills through capability_manager.",
  inputSchema: editToolInputSchema,
  resultSchema: editToolOutputSchema,
  permission: "mutate",
  executeLane: "mutation",
  category: "patch",
  decidePolicy: decideEditPolicy,
  execute: (input, context) => context.executors.edit(input, context),
  summary: (output) => summarizeEditOutput(output),
  resultPreview: (output) => output.diff,
  metrics: (output) => ({ filesEdited: output.changedFiles.length }),
}

const summarizeEditOutput = (output: typeof editToolOutputSchema._type): string => {
  const paths = Array.from(new Set(output.changedFiles.map((file) => file.path)))
  const verb = output.dryRun ? "Prepared" : "Edited"
  const onlyPath = paths[0]
  if (paths.length === 1 && onlyPath) {
    return `${verb} ${basename(onlyPath)}.`
  }
  return `${verb} ${paths.length} files.`
}

const basename = (path: string): string => path.split(/[\\/]/).pop() ?? path
