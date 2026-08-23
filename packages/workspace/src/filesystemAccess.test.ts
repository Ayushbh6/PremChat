import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { FilesystemAuthorizationSnapshot } from "@socrates/contracts"
import { resolveAuthorizedPath } from "./tools/common"
import { readWorkspacePath } from "./tools/readTool"
import { searchWorkspace } from "./tools/searchTool"

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const tempRoot = (name: string): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `socrates-path-${name}-`))
  tempRoots.push(root)
  return root
}

const snapshot = (root: string, mode: FilesystemAuthorizationSnapshot["mode"] = "selected"): FilesystemAuthorizationSnapshot => ({
  id: "fsauth_test",
  turnId: "turn_test",
  mode,
  revision: 1,
  roots: [{ id: "fsroot_test", label: "Allowed", path: root }],
  workingRootPath: root,
  createdAt: "2026-07-29T12:00:00.000Z",
})

describe("filesystem access authorization", () => {
  it("allows global exact paths while canonicalizing absolute and symlink targets", () => {
    const allowed = tempRoot("allowed")
    const outside = tempRoot("outside")
    fs.writeFileSync(path.join(allowed, "inside.txt"), "inside")
    fs.writeFileSync(path.join(outside, "outside.txt"), "outside")
    fs.symlinkSync(outside, path.join(allowed, "escape"), "dir")
    const context = { workspacePath: allowed, filesystemAuthorization: snapshot(allowed) }

    const canonicalAllowed = fs.realpathSync.native(allowed)
    expect(resolveAuthorizedPath(context, "inside.txt")).toBe(path.join(canonicalAllowed, "inside.txt"))
    expect(resolveAuthorizedPath(context, "new/nested.txt")).toBe(path.join(canonicalAllowed, "new/nested.txt"))
    expect(resolveAuthorizedPath(context, path.join(outside, "outside.txt"))).toBe(fs.realpathSync.native(path.join(outside, "outside.txt")))
    expect(resolveAuthorizedPath(context, path.join(allowed, "escape", "outside.txt"))).toBe(fs.realpathSync.native(path.join(outside, "outside.txt")))
  })

  it("supports bounded read and search across another selected absolute root", async () => {
    const working = tempRoot("working")
    const selected = tempRoot("selected")
    const file = path.join(selected, "answer.txt")
    fs.writeFileSync(file, "the selected-root answer")
    const authorization: FilesystemAuthorizationSnapshot = {
      ...snapshot(working),
      roots: [snapshot(working).roots[0]!, { id: "fsroot_second", label: "Selected", path: selected }],
    }
    const context = { workspacePath: working, filesystemAuthorization: authorization }

    const read = await readWorkspacePath({ path: file }, context)
    const canonicalFile = fs.realpathSync.native(file)
    expect(read).toMatchObject({ path: canonicalFile, kind: "file", content: "the selected-root answer" })
    const search = await searchWorkspace({ mode: "text", path: selected, query: "selected-root" }, context)
    expect(search.matches[0]).toMatchObject({ path: canonicalFile, line: 1 })
  })

  it("lets Full access resolve outside selected roots without weakening path canonicalization", () => {
    const working = tempRoot("full-working")
    const outside = tempRoot("full-outside")
    const target = path.join(outside, "file.txt")
    fs.writeFileSync(target, "full")
    expect(resolveAuthorizedPath({ workspacePath: working, filesystemAuthorization: snapshot(working, "full") }, target)).toBe(fs.realpathSync.native(target))
  })
})
