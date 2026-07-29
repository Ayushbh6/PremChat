import fs from "node:fs"
import path from "node:path"
import { SocratesError } from "@socrates/shared"
import { toWorkspaceRelativePath } from "./common"

const displayPath = (workspacePath: string, targetPath: string): string => {
  const relative = toWorkspaceRelativePath(workspacePath, targetPath)
  return relative === ".." || relative.startsWith(`..${path.sep}`) ? targetPath : relative
}

const freshnessKey = (targetPath: string): string => {
  const resolved = path.resolve(targetPath)
  try {
    return fs.realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

export class FileFreshnessTracker {
  private readonly hashes = new Map<string, string>()

  record(path: string, contentHash: string | undefined, workspacePath: string): void {
    if (!contentHash) {
      return
    }
    this.hashes.set(freshnessKey(path), contentHash)
  }

  validate(path: string, actualHash: string | undefined, workspacePath: string): void {
    const relativePath = displayPath(workspacePath, path)
    const expected = this.hashes.get(freshnessKey(path))
    if (!expected) {
      throw new SocratesError("edit_stale_content", `read() has not been called on ${relativePath} in this turn. Call read("${relativePath}") first, then retry the edit.`, {
        details: { path: relativePath, actualHash },
        recoverable: true,
      })
    }
    if (actualHash !== expected) {
      throw new SocratesError("edit_stale_content", `File content changed since Socrates last read ${relativePath}. Call read("${relativePath}") again, then retry the edit.`, {
        details: { path: relativePath, expectedBaseContentHash: expected, actualHash },
        recoverable: true,
      })
    }
  }
}
