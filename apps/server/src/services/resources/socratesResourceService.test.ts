import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { FileFreshnessTracker } from "@socrates/workspace"
import type { SocratesStore } from "../store"
import {
  editSocratesResource,
  readSocratesResource,
  searchSocratesResources,
} from "./socratesResourceService"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const testContext = (input: { identity?: string; notes?: string } = {}) => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-governed-resource-"))
  roots.push(workspacePath)
  let notes = input.notes ?? "Keep the capability catalog canonical."
  const store = {
    runSoulTool: () => ({ content: input.identity ?? "Socrates identity", truncation: { truncated: false, charLimit: 80_000, returnedLength: 18 } }),
    runUserProfileTool: () => ({ content: "User profile", truncation: { truncated: false, charLimit: 80_000, returnedLength: 12 } }),
    runToolDocsTool: () => ({ results: [{ path: "tool_usage/read_search.md", content: "Read and search guidance" }] }),
    runSkillsTool: (_projectId: string, input: { operation: string; name?: string }) => input.operation === "list"
      ? { operation: "list", skills: [{ scope: "project", name: "build-protocol", description: "Follow the canonical build protocol.", enabled: true }], totalMatches: 1, truncation: { truncated: false, charLimit: 80_000, returnedLength: 1 } }
      : { operation: "read", skills: [], totalMatches: 1, content: "---\nname: build-protocol\ndescription: Follow the canonical build protocol.\n---", truncation: { truncated: false, charLimit: 80_000, returnedLength: 1 } },
    listResources: () => [],
    runProjectDocsTool: (_projectId: string, _workspacePath: string, input: { operation: string; area: string; oldText?: string; newText?: string }) => {
      if (input.operation === "edit" || input.operation === "patch_section") {
        if (input.oldText !== notes) throw new Error("stale test edit")
        notes = input.newText ?? notes
      }
      return { content: notes, section: { content: notes }, truncation: { truncated: false, charLimit: 80_000, returnedLength: notes.length } }
    },
    runRepoDocsTool: () => ({ content: "Repo rules", truncation: { truncated: false, charLimit: 80_000, returnedLength: 10 } }),
  } as unknown as SocratesStore
  return {
    context: { store, projectId: "project-test", workspacePath, fileFreshness: new FileFreshnessTracker() },
    notes: () => notes,
  }
}

describe("governed Socrates resources", () => {
  it("reads identity and finds installed capabilities through the shared read/search tools", async () => {
    const { context } = testContext()
    const identity = await readSocratesResource({ path: "socrates://identity" }, context)
    const capabilities = await searchSocratesResources({ mode: "text", query: "build protocol", path: "socrates://capabilities" }, context)

    expect(identity.kind).toBe("resource")
    expect(identity.content).toBe("Socrates identity")
    expect(capabilities.matches.some((match) => match.text?.includes("build protocol"))).toBe(true)
  })

  it("hard-caps governed reads and continues by exact character offset", async () => {
    const { context } = testContext({ identity: "x".repeat(30_000) })
    const first = await readSocratesResource({
      path: "socrates://identity",
      charLimit: 80_000,
      tokenLimit: 80_000,
    }, context)
    const second = await readSocratesResource({
      path: "socrates://identity",
      charLimit: 80_000,
      tokenLimit: 80_000,
      offset: first.truncation.nextOffset ?? 0,
    }, context)

    expect(first.content).toHaveLength(24_000)
    expect(first.truncation.nextOffset).toBe(24_000)
    expect(second.content).toHaveLength(6_000)
    expect(second.truncation.truncated).toBe(false)
  })

  it("matches every consecutive regex line and bounds oversized resource search output", async () => {
    const identity = [
      `needle-${"x".repeat(4_000)}`,
      `needle-${"y".repeat(4_000)}`,
      `needle-${"z".repeat(4_000)}`,
    ].join("\n")
    const { context } = testContext({ identity })
    const result = await searchSocratesResources({
      mode: "text",
      query: "^needle-",
      regex: true,
      path: "socrates://identity",
      maxResults: 50,
      charLimit: 2_000,
    }, context)

    expect(result.totalMatches).toBe(3)
    expect(JSON.stringify(result.matches).length).toBeLessThanOrEqual(2_000)
    expect(result.matches.every((match) => (match.text?.length ?? 0) <= 1_000)).toBe(true)
    expect(result.truncation.truncated).toBe(true)
    expect(result.warnings?.some((warning) => warning.includes("oversized matching lines"))).toBe(true)
  })

  it("edits governed project notes atomically after reading the exact URI", async () => {
    const { context, notes } = testContext()
    const resourcePath = "socrates://project/notes"
    await readSocratesResource({ path: resourcePath }, context)
    const output = await editSocratesResource({
      path: resourcePath,
      edits: [{ oldString: "canonical", newString: "single-source" }],
    }, context)

    expect(notes()).toBe("Keep the capability catalog single-source.")
    expect(output.changedFiles[0]).toMatchObject({ path: resourcePath, operation: "edited", verification: "verified" })
  })

  it("bounds governed edit diffs while preserving the full atomic edit", async () => {
    const original = "A".repeat(20_000)
    const replacement = "B".repeat(30_000)
    const { context, notes } = testContext({ notes: original })
    const resourcePath = "socrates://project/notes"
    await readSocratesResource({ path: resourcePath }, context)
    const output = await editSocratesResource({
      path: resourcePath,
      edits: [{ oldString: original, newString: replacement }],
    }, context)

    expect(notes()).toBe(replacement)
    expect(output.diff.length).toBeLessThanOrEqual(16_000)
    expect(output.truncation.truncated).toBe(true)
    expect(output.truncation.nextOffset).toBe(16_000)
  })

  it("keeps identity, profile, tool guidance, capabilities, and skills read-only", async () => {
    const { context } = testContext()
    await readSocratesResource({ path: "socrates://identity" }, context)
    await expect(editSocratesResource({
      path: "socrates://identity",
      edits: [{ oldString: "identity", newString: "changed" }],
    }, context)).rejects.toMatchObject({ code: "resource_read_only" })
  })
})
