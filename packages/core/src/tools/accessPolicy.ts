import fs from "node:fs"
import path from "node:path"
import type { FilesystemAuthorizationSnapshot } from "@socrates/contracts"

export type AccessAction =
  | "structured_read"
  | "structured_write"
  | "terminal_run"
  | "terminal_control"
  | "capability_change"
  | "external_side_effect"
  | "frontier_handoff"
  | "catastrophic"

export type AccessDecision = "automatic" | "approval_required" | "denied"

export const decideAccess = (input: {
  authorization?: FilesystemAuthorizationSnapshot | undefined
  action: AccessAction
  targetPath?: string | undefined
  workspacePath?: string | undefined
}): AccessDecision => {
  if (input.action === "catastrophic") return "denied"
  if (input.action === "frontier_handoff") return "approval_required"
  if (input.action === "structured_read" || input.action === "terminal_control") return "automatic"

  const mode = input.authorization?.mode ?? "selected"
  if (input.action === "terminal_run") return mode === "full" ? "automatic" : "approval_required"
  if (input.action === "capability_change" || input.action === "external_side_effect") {
    return mode === "full" ? "automatic" : "approval_required"
  }
  if (mode === "full") return "automatic"
  if (mode === "read_only") return "approval_required"
  return isInsideSelectedRoot(input.authorization, input.targetPath, input.workspacePath)
    ? "automatic"
    : "approval_required"
}

export const isInsideSelectedRoot = (
  authorization: FilesystemAuthorizationSnapshot | undefined,
  requestedPath: string | undefined,
  workspacePath: string | undefined,
): boolean => {
  if (!authorization || authorization.roots.length === 0) return false
  const base = authorization.workingRootPath ?? workspacePath
  if (!base) return false
  const target = canonicalPath(requestedPath && path.isAbsolute(requestedPath)
    ? requestedPath
    : path.resolve(base, requestedPath ?? "."))
  return authorization.roots.some((root) => isWithin(target, canonicalPath(root.path)))
}

const canonicalPath = (value: string): string => {
  const resolved = path.resolve(value)
  try {
    return fs.realpathSync.native(resolved)
  } catch {
    let ancestor = resolved
    const tail: string[] = []
    while (path.dirname(ancestor) !== ancestor) {
      tail.unshift(path.basename(ancestor))
      ancestor = path.dirname(ancestor)
      try {
        return path.join(fs.realpathSync.native(ancestor), ...tail)
      } catch {
        // Continue to the nearest existing ancestor.
      }
    }
    return resolved
  }
}

const isWithin = (target: string, root: string): boolean =>
  target === root || target.startsWith(`${root}${path.sep}`)
