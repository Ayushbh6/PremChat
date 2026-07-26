import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const productionRoots = [
  path.join(repoRoot, "packages/contracts/src"),
  path.join(repoRoot, "packages/core/src"),
  path.join(repoRoot, "apps/server/src"),
]
const excludedSegments = [
  `${path.sep}test${path.sep}`,
  `${path.sep}db${path.sep}migrations${path.sep}`,
  `${path.sep}memory${path.sep}defaults${path.sep}`,
]
const bannedAuthorities = [
  "post-evidence",
  "post_evidence",
  "pendingFocusCompletion",
  "focus_ledger",
  "turn_evidence",
  "createV2ToolRegistry",
  "finalAnswerMode",
  "routePostTurn",
]

const sourceFiles = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const fullPath = path.join(directory, entry.name)
  if (excludedSegments.some((segment) => fullPath.includes(segment))) return []
  if (entry.isDirectory()) return sourceFiles(fullPath)
  return entry.isFile() && fullPath.endsWith(".ts") && !fullPath.endsWith(".test.ts") ? [fullPath] : []
})

describe("Flow convergence Phase 1 authority absence", () => {
  it("keeps removed post-turn and mutable goal authorities out of production source", () => {
    const violations = productionRoots.flatMap(sourceFiles).flatMap((file) => {
      const content = fs.readFileSync(file, "utf8")
      return bannedAuthorities
        .filter((authority) => content.includes(authority))
        .map((authority) => `${path.relative(repoRoot, file)}: ${authority}`)
    })

    expect(violations).toEqual([])
  })
})
