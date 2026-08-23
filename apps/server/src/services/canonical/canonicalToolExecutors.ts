import path from "node:path"
import type { FilesystemAuthorizationSnapshot, MemoryNoteToolInput, MemoryNoteToolOutput } from "@socrates/contracts"
import type { ToolExecutorContext, ToolExecutors } from "@socrates/core"
import { SocratesError } from "@socrates/shared"
import {
  applyPatchWorkspace,
  editWorkspace,
  FileFreshnessTracker,
  readWorkspacePath,
  searchWorkspace,
} from "@socrates/workspace"
import { fetchUrlForTool } from "../../ws/urlFetch"
import type { CanonicalSocratesStore } from "./canonicalSocratesStore"

/**
 * Filesystem executors for the fresh goal/task runtime. The core policy sees
 * the immutable task authorization. These executors use a short-lived
 * execution resolver only after that policy has either allowed an action or
 * the user has approved its exact preview; it is not a second access policy.
 *
 * Confirmed resources choose the task working directory. Selected paths are
 * intentionally not consulted here, because they grant write autonomy only.
 */
export const createCanonicalToolExecutors = (input: {
  store: CanonicalSocratesStore
  taskId: string
  filesystemAuthorization: FilesystemAuthorizationSnapshot
}): ToolExecutors => {
  const fileFreshness = new FileFreshnessTracker()
  const executionContext = (context: ToolExecutorContext) => ({
    workspacePath: context.workspacePath,
    filesystemAuthorization: executionAuthorization(input.filesystemAuthorization, context.workspacePath),
    ...(context.runtimeConfig ? { runtimeConfig: { providerId: context.runtimeConfig.providerId, modelId: context.runtimeConfig.modelId } } : {}),
    fileFreshness,
  })
  const assertSafePath = (workspacePath: string, requestedPath?: string) => assertNoRepoLocalSocrates(workspacePath, requestedPath)

  return {
    read: async (toolInput, context) => {
      assertSafePath(context.workspacePath, toolInput.path)
      return readWorkspacePath(toolInput, executionContext(context))
    },
    search: async (toolInput, context) => {
      assertSafePath(context.workspacePath, toolInput.path)
      return searchWorkspace(toolInput, executionContext(context))
    },
    url_fetch: (toolInput, context) => fetchUrlForTool(toolInput, context.abortSignal),
    edit: async (toolInput, context) => {
      assertSafePath(context.workspacePath, toolInput.path)
      return editWorkspace(toolInput, { ...executionContext(context), ...(context.previewOnly ? { previewOnly: true } : {}) })
    },
    apply_patch: async (toolInput, context) => {
      assertPatchHasNoRepoLocalSocrates(toolInput.patchText)
      return applyPatchWorkspace(toolInput, {
        workspacePath: context.workspacePath,
        fileFreshness,
        ...(context.previewOnly ? { previewOnly: true } : {}),
      })
    },
    bash: async () => {
      // Do not route canonical Terminal calls through the old supervisor or a
      // plain child process. The canonical persistent Terminal runner must
      // persist terminal_sessions/output and establish native containment
      // before it can execute any command. In particular, Full can never
      // silently fall back to an uncontained launch.
      throw new SocratesError(
        "canonical_terminal_runner_required",
        "Terminal is unavailable until the canonical contained Terminal runner is initialized.",
        { recoverable: true },
      )
    },
    current_time: async () => systemTime(),
    trace_retrieve: async () => {
      throw new SocratesError(
        "canonical_trace_retrieval_required",
        "Exact canonical trace retrieval is not initialized for this task.",
        { recoverable: true },
      )
    },
    memory_note: async (toolInput, context) => createCanonicalMemoryNote(input.store, input.taskId, toolInput, context),
  }
}

const executionAuthorization = (
  authorization: FilesystemAuthorizationSnapshot,
  workspacePath: string,
): FilesystemAuthorizationSnapshot => ({
  ...authorization,
  // `decideAccess` ran with the original snapshot before an executor is
  // reached. The workspace package needs a resolver that can execute the
  // already-authorized exact target, including global reads and approved
  // writes outside a Selected root.
  mode: "full",
  workingRootPath: workspacePath,
})

const assertNoRepoLocalSocrates = (workspacePath: string, requestedPath?: string): void => {
  if (!requestedPath) return
  if (requestedPath.startsWith("socrates://")) {
    throw new SocratesError("legacy_socrates_resource_unavailable", "Repo-local Socrates resources are not part of global Socrates.", { recoverable: true })
  }
  const candidate = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(workspacePath, requestedPath)
  if (candidate.split(path.sep).includes(".socrates")) {
    throw new SocratesError("repo_local_socrates_ignored", "Repo-local .socrates directories are not read or written by global Socrates.", { recoverable: true })
  }
}

const assertPatchHasNoRepoLocalSocrates = (patchText: string): void => {
  const headers = patchText
    .split(/\r?\n/)
    .filter((line) => /^(?:\*\*\* (?:Add|Delete|Update) File:|--- |\+\+\+ )/.test(line))
  if (headers.some((line) => /(?:^|[\\/])\.socrates(?:[\\/]|$)/.test(line))) {
    throw new SocratesError("repo_local_socrates_ignored", "Repo-local .socrates directories are not read or written by global Socrates.", { recoverable: true })
  }
}

const createCanonicalMemoryNote = async (
  store: CanonicalSocratesStore,
  taskId: string,
  toolInput: MemoryNoteToolInput,
  _context: ToolExecutorContext,
): Promise<MemoryNoteToolOutput> => store.createMemoryNote({
  taskId,
  note: toolInput.note,
  importance: toolInput.importance ?? "normal",
})

const systemTime = () => {
  const date = new Date()
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "system-local"
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value
  return {
    currentDate: `${part("year") ?? date.getUTCFullYear()}-${part("month") ?? String(date.getUTCMonth() + 1).padStart(2, "0")}-${part("day") ?? String(date.getUTCDate()).padStart(2, "0")}`,
    currentDateTime: date.toISOString(),
    timeZone,
    source: "system" as const,
  }
}
