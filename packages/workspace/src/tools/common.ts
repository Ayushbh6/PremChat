import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  DEFAULT_MODEL_OUTPUT_CHAR_LIMIT,
  DEFAULT_MODEL_OUTPUT_TOKEN_LIMIT,
  limitModelOutputText,
  MAX_MODEL_OUTPUT_CHAR_LIMIT,
  MAX_MODEL_OUTPUT_TOKEN_LIMIT,
  resolveModelOutputCharLimit,
  SocratesError,
} from "@socrates/shared"
import { socratesSurface, type FilesystemAuthorizationSnapshot, type TruncationMetadata } from "@socrates/contracts"

export const DEFAULT_CHAR_LIMIT = DEFAULT_MODEL_OUTPUT_CHAR_LIMIT
export const MAX_CHAR_LIMIT = MAX_MODEL_OUTPUT_CHAR_LIMIT
export const DEFAULT_TOKEN_LIMIT = DEFAULT_MODEL_OUTPUT_TOKEN_LIMIT
export const MAX_TOKEN_LIMIT = MAX_MODEL_OUTPUT_TOKEN_LIMIT

export const clampCharLimit = (charLimit?: number): number => Math.min(charLimit ?? DEFAULT_CHAR_LIMIT, MAX_CHAR_LIMIT)

export const clampTokenLimit = (tokenLimit?: number): number => Math.min(tokenLimit ?? DEFAULT_TOKEN_LIMIT, MAX_TOKEN_LIMIT)

export const charLimitForTokenCap = (tokenLimit?: number): number => resolveModelOutputCharLimit({
  charLimit: MAX_CHAR_LIMIT,
  ...(tokenLimit !== undefined ? { tokenLimit } : {}),
})

export const resolveWorkspacePath = (workspacePath: string, requestedPath?: string): string => {
  const workspaceRoot = path.resolve(workspacePath)
  const normalizedRequest = normalizeWorkspaceRequestPath(requestedPath)
  const target = path.resolve(workspaceRoot, normalizedRequest ?? ".")
  if (target !== workspaceRoot && !target.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new SocratesError("workspace_path_escape", "Tool paths must stay inside the active project workspace", {
      details: { workspacePath: workspaceRoot, requestedPath },
    })
  }
  return target
}

export type AuthorizedPathContext = {
  workspacePath: string
  filesystemAuthorization?: FilesystemAuthorizationSnapshot
}

export const resolveAuthorizedPath = (context: AuthorizedPathContext, requestedPath?: string): string => {
  const authorization = context.filesystemAuthorization
  if (!authorization) return resolveWorkspacePath(context.workspacePath, requestedPath)

  const roots = authorization.roots.map((root) => canonicalTargetPath(root.path))
  const fallbackRoot = roots[0]
  const requestedWorkingRoot = authorization.workingRootPath ?? context.workspacePath
  const workingRoot = authorization.mode === "full" || roots.some((root) => isWithinRoot(canonicalTargetPath(requestedWorkingRoot), root))
    ? canonicalTargetPath(requestedWorkingRoot)
    : fallbackRoot
  if (!workingRoot) {
    throw new SocratesError("filesystem_path_unavailable", "No selected path is available for this turn.", {
      recoverable: true,
    })
  }

  const normalizedRequest = normalizeWorkspaceRequestPath(requestedPath)
  const lexicalTarget = normalizedRequest && path.isAbsolute(normalizedRequest)
    ? path.resolve(normalizedRequest)
    : path.resolve(workingRoot, normalizedRequest ?? ".")
  const target = canonicalTargetPath(lexicalTarget)
  if (authorization.mode !== "full" && !roots.some((root) => isWithinRoot(target, root))) {
    throw new SocratesError("filesystem_path_outside_selected", "Tool paths must stay inside the paths selected in the header.", {
      recoverable: true,
      details: { requestedPath, selectedPaths: authorization.roots.map((root) => root.path) },
    })
  }
  return target
}

export const toAuthorizedDisplayPath = (
  context: AuthorizedPathContext,
  targetPath: string,
): string => {
  const workspaceRoot = canonicalTargetPath(context.filesystemAuthorization?.workingRootPath ?? context.workspacePath)
  const target = canonicalTargetPath(targetPath)
  return isWithinRoot(target, workspaceRoot)
    ? toWorkspaceRelativePath(workspaceRoot, target)
    : target
}

const canonicalTargetPath = (targetPath: string): string => {
  const normalized = path.resolve(targetPath)
  try {
    return fs.realpathSync.native(normalized)
  } catch {
    let ancestor = normalized
    const remainder: string[] = []
    while (path.dirname(ancestor) !== ancestor) {
      try {
        const stat = fs.lstatSync(ancestor)
        if (stat.isSymbolicLink()) {
          throw new SocratesError("filesystem_broken_symlink", "Tool paths cannot traverse an unresolved symbolic link.", {
            recoverable: true,
            details: { path: normalized },
          })
        }
      } catch (error) {
        if (error instanceof SocratesError) throw error
      }
      remainder.unshift(path.basename(ancestor))
      ancestor = path.dirname(ancestor)
      try {
        return path.join(fs.realpathSync.native(ancestor), ...remainder)
      } catch {
        // Keep walking to the nearest existing ancestor.
      }
    }
    return normalized
  }
}

const isWithinRoot = (targetPath: string, rootPath: string): boolean => {
  const target = path.resolve(targetPath)
  const root = path.resolve(rootPath)
  return target === root || target.startsWith(`${root}${path.sep}`)
}

const normalizeWorkspaceRequestPath = (requestedPath?: string): string | undefined => {
  if (!requestedPath) {
    return requestedPath
  }
  return requestedPath.replaceAll("\\", path.sep)
}

export const toWorkspaceRelativePath = (workspacePath: string, targetPath: string): string => {
  const relative = path.relative(path.resolve(workspacePath), path.resolve(targetPath))
  return relative.length === 0 ? "." : relative
}

export const truncateText = (text: string, charLimit = DEFAULT_CHAR_LIMIT, offset = 0): { text: string; truncation: TruncationMetadata } => {
  return limitModelOutputText(text, {
    charLimit,
    tokenLimit: MAX_TOKEN_LIMIT,
    defaultTokenLimit: MAX_TOKEN_LIMIT,
    offset,
  })
}

export const emptyTruncation = (charLimit?: number): TruncationMetadata => ({
  truncated: false,
  charLimit: clampCharLimit(charLimit),
  returnedLength: 0,
})

export const isProbablyBinary = (buffer: Buffer): boolean => {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_000))
  return sample.includes(0)
}

export const isSensitivePath = (targetPath: string): boolean => {
  const base = path.basename(targetPath).toLowerCase()
  if (isEnvTemplatePath(base)) {
    return false
  }
  return (
    isSecretMaterialPath(targetPath) ||
    base.includes("secret") ||
    base.includes("credential")
  )
}

export const isSecretMaterialPath = (targetPath: string): boolean => {
  const base = path.basename(targetPath).toLowerCase()
  if (isEnvTemplatePath(base)) {
    return false
  }
  return (
    base === ".env" ||
    base.startsWith(".env.") ||
    base === ".npmrc" ||
    base === ".netrc" ||
    base === "id_rsa" ||
    base === "id_ed25519" ||
    base.endsWith(".pem") ||
    base.endsWith(".key") ||
    base.endsWith(".p12") ||
    base.endsWith(".pfx")
  )
}

export const assertNoSecretMaterialPathMentions = (text: string): void => {
  const tokens = text
    .replaceAll("\\", "/")
    .split(/[\s\0"'`=;|&(){}\[\],<>]+/)
    .map((token) => token.replace(/[.:]+$/, ""))
    .filter(Boolean)
  const match = tokens.find((token) => isSecretMaterialPath(token))
  if (!match) {
    return
  }
  throw new SocratesError(
    "terminal_secret_path_rejected",
    "Terminal commands cannot access real environment, private-key, or credential material. Use the dedicated credential input flow or inspect a safe template file instead.",
    { recoverable: true, details: { path: path.basename(match) } },
  )
}

export const assertNotProjectNotesMutation = (workspacePath: string, targetPath: string, requestedPath?: string): void => {
  const relativePath = toWorkspaceRelativePath(workspacePath, targetPath).replaceAll(path.sep, "/").toLowerCase()
  const memoryPath = socratesSurface("project_memory").path.toLowerCase()
  const notesPath = socratesSurface("project_notes").path.toLowerCase()
  if (relativePath !== notesPath && relativePath !== memoryPath) {
    return
  }
  const area = relativePath === memoryPath ? "memory" : "notes"
  throw new SocratesError(
    "governed_resource_edit_required",
    ".socrates/MEMORY.md and PROJECT_NOTES.md can only be edited through an exact governed section URI such as socrates://project/memory/handoff or socrates://project/notes/active_context. Base document URIs are read/search only.",
    {
      recoverable: true,
      details: { path: requestedPath ?? relativePath, tool: "edit", operation: "edit", area },
    },
  )
}

export const assertNotRepoDocsMutation = (workspacePath: string, targetPath: string, requestedPath?: string): void => {
  const relativePath = toWorkspaceRelativePath(workspacePath, targetPath).replaceAll(path.sep, "/").toLowerCase()
  if (!relativePath.startsWith(socratesSurface("repo_docs").path.toLowerCase()) || !relativePath.endsWith(".md")) {
    return
  }
  throw new SocratesError(
    "governed_resource_edit_required",
    ".socrates/repo_docs/*.md can only be edited through an exact governed socrates://project/repo-docs/<file>/<sectionId> URI. Base document URIs are read/search only.",
    {
      recoverable: true,
      details: { path: requestedPath ?? relativePath, tool: "edit", operation: "edit" },
    },
  )
}

export const assertNotProjectSkillsMutation = (workspacePath: string, targetPath: string, requestedPath?: string): void => {
  const relativePath = toWorkspaceRelativePath(workspacePath, targetPath).replaceAll(path.sep, "/").toLowerCase()
  if (!relativePath.startsWith(socratesSurface("project_skills").path.toLowerCase())) {
    return
  }
  throw new SocratesError(
    "capability_manager_required",
    ".socrates/skills/* can only be changed through capability_manager and the backend Skill Writer. Use read/search with socrates://skills for inspection.",
    {
      recoverable: true,
      details: { path: requestedPath ?? relativePath, tool: "capability_manager", operation: "skill_update" },
    },
  )
}

type ProtectedSocratesPathMention = {
  targetKind: "project_docs" | "repo_docs" | "project_skills" | "global_skills" | "tool_usage" | "soul" | "user_profile"
  pattern: string
}

type ProtectedSocratesPathOptions = {
  homeDir?: string
}

export const findProtectedSocratesPathMentions = (
  text: string,
  options: ProtectedSocratesPathOptions = {},
): ProtectedSocratesPathMention[] => {
  const normalized = normalizeCommandPathText(text)
  const homeDir = options.homeDir ?? os.homedir()
  const patterns = protectedSocratesPathPatterns(homeDir)
  const seen = new Set<string>()
  const matches: ProtectedSocratesPathMention[] = []
  for (const pattern of patterns) {
    if (!containsPathMention(normalized, pattern.pattern)) {
      continue
    }
    const key = `${pattern.targetKind}:${pattern.pattern}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    matches.push(pattern)
  }
  return matches
}

export const assertNoProtectedSocratesPathMentions = (
  text: string,
  options: ProtectedSocratesPathOptions = {},
): void => {
  const matches = findProtectedSocratesPathMentions(text, options)
  if (matches.length === 0) {
    return
  }
  throw new SocratesError(
    "terminal_protected_socrates_path_rejected",
    "Terminal command rejected because it mentions protected Socrates-owned memory, docs, tool guidance, identity, profile, or skill paths. Use read/search on the corresponding socrates:// resource, edit only governed project docs, capability_manager for skills, and memory_note for identity or profile changes.",
    {
      recoverable: true,
      details: {
        matches,
        note: "This is a cross-platform preflight guard for obvious protected path mentions, not an OS process sandbox.",
      },
    },
  )
}

const protectedSocratesPathPatterns = (homeDir: string): ProtectedSocratesPathMention[] => {
  const globalRoots = [
    "~/.socrates",
    "$home/.socrates",
    "${home}/.socrates",
    "$env:home/.socrates",
    "%userprofile%/.socrates",
    "$env:userprofile/.socrates",
    normalizeCommandPathText(homeDir ? path.join(homeDir, ".Socrates") : ""),
  ].filter((item): item is string => item.length > 0)

  return [
    { targetKind: "project_docs", pattern: socratesSurface("project_memory").path.toLowerCase() },
    { targetKind: "project_docs", pattern: socratesSurface("project_notes").path.toLowerCase() },
    { targetKind: "repo_docs", pattern: socratesSurface("repo_docs").path.toLowerCase().replace(/\/$/, "") },
    ...[socratesSurface("project_skills").path, ...(socratesSurface("project_skills").aliases ?? [])].map((pattern) => ({
      targetKind: "project_skills" as const,
      pattern: pattern.toLowerCase().replace(/\/$/, ""),
    })),
    ...globalRoots.flatMap((root) => [
      { targetKind: "global_skills" as const, pattern: `${root}/${globalSurfaceSuffix("global_skills")}` },
      ...globalSurfaceAliasSuffixes("global_skills").map((suffix) => ({ targetKind: "global_skills" as const, pattern: `${root}/${suffix}` })),
      { targetKind: "tool_usage" as const, pattern: `${root}/tool_usage` },
      { targetKind: "soul" as const, pattern: `${root}/${globalSurfaceSuffix("global_identity")}` },
      { targetKind: "user_profile" as const, pattern: `${root}/${globalSurfaceSuffix("global_user_profile")}` },
    ]),
  ]
}

const globalSurfaceSuffix = (id: "global_skills" | "global_identity" | "global_user_profile"): string =>
  socratesSurface(id).path.replace(/^~\/\.Socrates\//i, "").replace(/\/$/, "").toLowerCase()

const globalSurfaceAliasSuffixes = (id: "global_skills"): string[] =>
  (socratesSurface(id).aliases ?? []).map((alias) => alias.replace(/^~\/\.Socrates\//i, "").replace(/\/$/, "").toLowerCase())

const normalizeCommandPathText = (value: string): string =>
  value.replaceAll("\\", "/").replaceAll(/\/+/g, "/").toLowerCase()

const containsPathMention = (text: string, pattern: string): boolean => {
  let index = text.indexOf(pattern)
  while (index >= 0) {
    const after = text.at(index + pattern.length)
    if (after === undefined || !/[a-z0-9._-]/i.test(after)) {
      return true
    }
    index = text.indexOf(pattern, index + pattern.length)
  }
  return false
}

const isEnvTemplatePath = (base: string): boolean =>
  base === ".env.example" ||
  base === ".env.sample" ||
  base === ".env.template" ||
  base.endsWith(".env.example") ||
  base.endsWith(".env.sample") ||
  base.endsWith(".env.template") ||
  base.endsWith(".env.local.example")

export const ensureParentDirectory = (targetPath: string): void => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
}
