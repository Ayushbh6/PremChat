import { editToolInputSchema, editToolOutputSchema } from "@socrates/contracts"
import type { SocratesTool } from "./types"

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
  if (context.runtimeConfig.sandboxMode === "read_only" || context.runtimeConfig.approvalMode === "read_only_auto") {
    return { type: "denied", reason: "File edits are not allowed in read-only mode." }
  }

  if (isSocratesOwnedWorkingPath(input.path)) {
    return { type: "auto" }
  }

  if (context.runtimeConfig.sandboxMode === "danger_full_access" || context.runtimeConfig.approvalMode === "approve_all") {
    return { type: "auto" }
  }

  const preview = await context.executors.edit(input, { ...context, previewOnly: true })

  return {
    type: "approval_required",
    request: {
      actionKind: "file_write",
      title: "Approve file edit",
      description: "Socrates wants to modify files in the active project workspace.",
      actionPreview: preview.diff.trim().length > 0 ? preview.diff : previewEdit(input),
      risk: "medium",
    },
  }
}

const isSocratesOwnedWorkingPath = (path: string): boolean =>
  path.startsWith(".socrates/") ||
  path === "socrates://project/memory" ||
  path.startsWith("socrates://project/memory/") ||
  path === "socrates://project/notes" ||
  path.startsWith("socrates://project/notes/") ||
  path.startsWith("socrates://project/repo-docs/")

export const editTool: SocratesTool<typeof editToolInputSchema._type, typeof editToolOutputSchema._type> = {
  name: "edit",
  description:
    "Create or modify one governed resource or workspace file. Read an existing target in the current turn before editing it. For existing text, send one edits array; every oldString is matched against the same original version, overlapping edits are rejected, and the write is atomic. Set replaceAll only when every occurrence should change. Use content for new files, or content with overwrite: true only for a deliberate full rewrite. Identity, user profile, tool guidance, and installed skills are read-only here; propose identity/profile memory through memory_note and manage skills through capability_manager.",
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
