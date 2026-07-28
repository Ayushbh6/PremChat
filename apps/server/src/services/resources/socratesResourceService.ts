import crypto from "node:crypto"
import type {
  EditToolInput,
  EditToolOutput,
  ReadToolInput,
  ReadToolOutput,
  RepoDocFile,
  SearchToolInput,
  SearchToolOutput,
} from "@socrates/contracts"
import { capabilityCatalog, socratesMainAgentDefinition, type FileFreshnessTracker } from "@socrates/core"
import type { McpRuntime } from "@socrates/mcp"
import {
  limitModelOutputText,
  MAX_MODEL_OUTPUT_TOKEN_LIMIT,
  resolveModelOutputCharLimit,
  SocratesError,
} from "@socrates/shared"
import { applyTextEdits } from "@socrates/workspace"
import type { SocratesStore } from "../store"

const RESOURCE_PREFIX = "socrates://"
const DEFAULT_CHAR_LIMIT = 16_000
const REPO_DOCS = new Set<RepoDocFile>(["CORE_IDEA.md", "REPO_NAVIGATION.md", "REPO_RULES.md", "CONTRACTS.md"])

type ResourceContext = Readonly<{
  store: SocratesStore
  projectId: string
  workspacePath: string
  mcpRuntime?: McpRuntime
  fileFreshness?: FileFreshnessTracker
  previewOnly?: boolean
}>

export const isSocratesResourcePath = (value: string): boolean => value.startsWith(RESOURCE_PREFIX)

export const readSocratesResource = async (
  input: ReadToolInput,
  context: ResourceContext,
): Promise<ReadToolOutput> => {
  const fullContent = await resolveResourceContent(input.path, context)
  const hash = hashText(fullContent)
  context.fileFreshness?.record(input.path, hash, context.workspacePath)
  const limited = limitModelOutputText(fullContent, {
    ...(input.charLimit !== undefined ? { charLimit: input.charLimit } : {}),
    ...(input.tokenLimit !== undefined ? { tokenLimit: input.tokenLimit } : {}),
    defaultCharLimit: DEFAULT_CHAR_LIMIT,
    ...(input.offset !== undefined ? { offset: input.offset } : {}),
  })
  return {
    path: input.path,
    kind: "resource",
    content: limited.text,
    contentHash: hash,
    sizeBytes: Buffer.byteLength(fullContent, "utf8"),
    truncation: limited.truncation,
  }
}

export const searchSocratesResources = async (
  input: SearchToolInput,
  context: ResourceContext,
): Promise<SearchToolOutput> => {
  const roots = input.path && input.path !== RESOURCE_PREFIX
    ? [input.path]
    : [
        "socrates://capabilities",
        "socrates://skills",
        "socrates://tool-guidance",
        "socrates://identity",
        "socrates://user/profile",
        "socrates://project/resources",
        "socrates://project/memory",
        "socrates://project/notes",
        "socrates://project/repo-docs",
      ]
  const settled = await Promise.allSettled(roots.map(async (resourcePath) => ({
    path: resourcePath,
    content: await resolveResourceContent(resourcePath, context),
  })))
  const regex = input.regex ? compileRegex(input.query, input.caseSensitive) : undefined
  const needle = input.caseSensitive ? input.query : input.query.toLowerCase()
  const matches: SearchToolOutput["matches"] = []
  const maxResults = Math.min(input.maxResults ?? 20, 50)
  let shortenedLines = 0
  for (const result of settled) {
    if (result.status !== "fulfilled") continue
    const { path, content } = result.value
    if (input.mode === "files") {
      const haystack = input.caseSensitive ? path : path.toLowerCase()
      if (regex ? regex.test(path) : haystack.includes(needle)) matches.push({ path })
      continue
    }
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      const haystack = input.caseSensitive ? line : line.toLowerCase()
      if (regex ? regex.test(line) : haystack.includes(needle)) {
        if (line.length > 1_000) shortenedLines += 1
        matches.push({ path, line: index + 1, text: line.slice(0, 1_000) })
        if (matches.length >= maxResults) break
      }
    }
    if (matches.length >= maxResults) break
  }
  const serialized = JSON.stringify(matches)
  const charLimit = resolveModelOutputCharLimit({
    ...(input.charLimit !== undefined ? { charLimit: input.charLimit } : {}),
    tokenLimit: MAX_MODEL_OUTPUT_TOKEN_LIMIT,
    defaultCharLimit: DEFAULT_CHAR_LIMIT,
    defaultTokenLimit: MAX_MODEL_OUTPUT_TOKEN_LIMIT,
  })
  let bounded = matches
  while (bounded.length > 0 && JSON.stringify(bounded).length > charLimit) bounded = bounded.slice(0, -1)
  const resultLimitReached = matches.length >= maxResults
  const warnings = [
    ...(input.maxResults && input.maxResults > 50 ? ["Search maxResults was capped at 50. Narrow the resource path or query."] : []),
    ...(resultLimitReached ? [`Search results reached the ${maxResults}-result limit. Narrow the resource path or query.`] : []),
    ...(shortenedLines > 0 ? [`${shortenedLines} oversized matching line${shortenedLines === 1 ? " was" : "s were"} shortened to 1,000 characters. Read the exact resource and offset for full text.`] : []),
    ...(settled.some((result) => result.status === "rejected") ? ["One or more governed resource surfaces were unavailable."] : []),
  ]
  return {
    mode: input.mode,
    query: input.query,
    matches: bounded,
    totalMatches: matches.length,
    truncation: {
      truncated: bounded.length < matches.length || resultLimitReached || shortenedLines > 0,
      charLimit,
      originalLength: serialized.length,
      returnedLength: JSON.stringify(bounded).length,
    },
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}

export const editSocratesResource = async (
  input: EditToolInput,
  context: ResourceContext,
): Promise<EditToolOutput> => {
  if (!("edits" in input)) {
    throw new SocratesError("resource_edit_requires_targeted_edits", "Governed Socrates documents require targeted edits against an existing resource.", { recoverable: true })
  }
  const target = parseWritableTarget(input.path)
  const current = await resolveResourceContent(input.path, context)
  const beforeHash = hashText(current)
  if (!context.fileFreshness) {
    throw new SocratesError("edit_stale_content", `read() has not been called on ${input.path} in this turn.`, { recoverable: true })
  }
  context.fileFreshness.validate(input.path, beforeHash, context.workspacePath)
  const next = applyTextEdits(current, input.edits, input.path)
  const dryRun = context.previewOnly ?? false
  if (!dryRun) {
    if (target.kind === "project") {
      if (target.sectionId) {
        context.store.runProjectDocsTool(context.projectId, context.workspacePath, {
          operation: "patch_section",
          area: target.area,
          sectionId: target.sectionId,
          oldText: current,
          newText: next,
        })
      } else {
        context.store.runProjectDocsTool(context.projectId, context.workspacePath, {
          operation: "edit",
          area: target.area,
          editMode: "replace",
          oldText: current,
          newText: next,
        })
      }
    } else {
      if (target.sectionId) {
        context.store.runRepoDocsTool(context.projectId, context.workspacePath, {
          operation: "patch_section",
          path: target.file,
          sectionId: target.sectionId,
          oldText: current,
          newText: next,
        })
      } else {
        context.store.runRepoDocsTool(context.projectId, context.workspacePath, {
          operation: "edit",
          path: target.file,
          oldText: current,
          newText: next,
        })
      }
    }
    const persisted = await resolveResourceContent(input.path, context)
    if (persisted !== next) throw new SocratesError("edit_verification_failed", "Governed resource edit did not persist exactly.")
  }
  const afterHash = hashText(next)
  const fullDiff = renderReplacementDiff(input.path, current, next)
  const limitedDiff = limitModelOutputText(fullDiff, {
    charLimit: DEFAULT_CHAR_LIMIT,
    tokenLimit: MAX_MODEL_OUTPUT_TOKEN_LIMIT,
    defaultTokenLimit: MAX_MODEL_OUTPUT_TOKEN_LIMIT,
  })
  return {
    changedFiles: [{
      path: input.path,
      operation: "edited",
      ...(dryRun ? {} : { verification: "verified" as const }),
      contentHashBefore: beforeHash,
      contentHashAfter: afterHash,
      sizeBytesBefore: Buffer.byteLength(current, "utf8"),
      sizeBytesAfter: Buffer.byteLength(next, "utf8"),
      lineDelta: lineCount(next) - lineCount(current),
    }],
    diff: limitedDiff.text,
    dryRun,
    truncation: limitedDiff.truncation,
  }
}

const resolveResourceContent = async (resourcePath: string, context: ResourceContext): Promise<string> => {
  const segments = parseSegments(resourcePath)
  const [root, second, third, ...rest] = segments
  if (!root) return resourceIndex()
  if (root === "identity") {
    const output = context.store.runSoulTool(context.projectId, second
      ? { operation: "read_section", sectionId: second, charLimit: 80_000 }
      : { operation: "read", charLimit: 80_000 })
    return output.section?.content ?? output.content ?? JSON.stringify(output.index ?? {}, null, 2)
  }
  if (root === "user" && second === "profile") {
    const sectionId = third
    const output = context.store.runUserProfileTool(context.projectId, sectionId
      ? { operation: "read_section", sectionId, charLimit: 80_000 }
      : { operation: "read", charLimit: 80_000 })
    return output.section?.content ?? output.content ?? JSON.stringify(output.index ?? {}, null, 2)
  }
  if (root === "tool-guidance") {
    const toolPath = segments.slice(1).join("/") || undefined
    const output = context.store.runToolDocsTool(context.projectId, {
      operation: "read",
      ...(toolPath ? { path: toolPath } : {}),
      charLimit: 80_000,
    })
    return JSON.stringify(output.results, null, 2)
  }
  if (root === "skills") {
    if (!second) return JSON.stringify(context.store.runSkillsTool(context.projectId, { operation: "list", limit: 50 }).skills, null, 2)
    const scope = normalizeSkillScope(second)
    if (!third) return JSON.stringify(context.store.runSkillsTool(context.projectId, { operation: "list", scope, limit: 50 }).skills, null, 2)
    const supportingPath = rest.join("/") || undefined
    const output = context.store.runSkillsTool(context.projectId, {
      operation: "read",
      scope,
      name: decodeURIComponent(third),
      ...(supportingPath ? { path: supportingPath } : {}),
      charLimit: 80_000,
    })
    return output.content ?? JSON.stringify(output.skills, null, 2)
  }
  if (root === "capabilities") return capabilityContent(second ? decodeURIComponent([second, third, ...rest].filter(Boolean).join("/")) : undefined, context)
  if (root === "project" && second === "resources") return JSON.stringify(context.store.listResources(context.projectId), null, 2)
  if (root === "project" && (second === "memory" || second === "notes")) {
    const output = context.store.runProjectDocsTool(context.projectId, context.workspacePath, third
      ? { operation: "read_section", area: second, sectionId: third, charLimit: 80_000 }
      : { operation: "read", area: second, charLimit: 80_000 })
    return output.section?.content ?? output.content ?? JSON.stringify(output.index ?? {}, null, 2)
  }
  if (root === "project" && second === "repo-docs") {
    if (!third) {
      const output = context.store.runRepoDocsTool(context.projectId, context.workspacePath, { operation: "read", charLimit: 80_000 })
      return output.content ?? JSON.stringify(output.indexes ?? output.paths ?? {}, null, 2)
    }
    const file = decodeURIComponent(third) as RepoDocFile
    if (!REPO_DOCS.has(file)) throw resourceMissing(resourcePath)
    const sectionId = rest[0]
    const output = context.store.runRepoDocsTool(context.projectId, context.workspacePath, sectionId
      ? { operation: "read_section", path: file, sectionId, charLimit: 80_000 }
      : { operation: "read", path: file, charLimit: 80_000 })
    return output.section?.content ?? output.content ?? JSON.stringify(output.index ?? {}, null, 2)
  }
  throw resourceMissing(resourcePath)
}

const capabilityContent = async (requestedId: string | undefined, context: ResourceContext): Promise<string> => {
  const staticEntries = capabilityCatalog.runtimeInventory(socratesMainAgentDefinition.roleManifest)
    .filter((entry) => entry.kind === "model_tool")
    .map((entry) => ({ id: entry.id, name: entry.modelToolName, description: entry.description, source: "built-in" }))
  const skills = context.store.runSkillsTool(context.projectId, { operation: "list", limit: 50 }).skills
    .filter((skill) => skill.enabled !== false)
    .map((skill) => ({ id: `skill:${skill.scope}:${skill.name}`, name: skill.name, description: skill.description, source: "skill", uri: `socrates://skills/${skill.scope}/${encodeURIComponent(skill.name)}` }))
  const mcp = context.mcpRuntime
    ? (await context.mcpRuntime.handleRegistryTool({ operation: "list", n: 35 }, { workspacePath: context.workspacePath })).servers ?? []
    : []
  const servers = mcp.map((server) => ({ id: `mcp:${server.id}`, name: server.label, description: server.description ?? `${server.toolCount ?? 0} MCP tools`, source: "mcp", enabled: server.enabled }))
  const entries = [...staticEntries, ...skills, ...servers]
  if (!requestedId) return JSON.stringify(entries, null, 2)
  const exact = entries.find((entry) => entry.id === requestedId || entry.name === requestedId)
  if (!exact) throw resourceMissing(`socrates://capabilities/${requestedId}`)
  return JSON.stringify(exact, null, 2)
}

const parseWritableTarget = (resourcePath: string):
  | { kind: "project"; area: "memory" | "notes"; sectionId?: string }
  | { kind: "repo"; file: RepoDocFile; sectionId?: string } => {
  const [root, second, third, fourth] = parseSegments(resourcePath)
  if (root === "project" && (second === "memory" || second === "notes")) {
    return { kind: "project", area: second, ...(third ? { sectionId: third } : {}) }
  }
  if (root === "project" && second === "repo-docs" && third && REPO_DOCS.has(third as RepoDocFile)) {
    return { kind: "repo", file: third as RepoDocFile, ...(fourth ? { sectionId: fourth } : {}) }
  }
  throw new SocratesError(
    "resource_read_only",
    "This governed resource is read-only. Identity and profile changes go through memory_note; skill changes go through capability_manager.",
    { recoverable: true, details: { path: resourcePath } },
  )
}

const parseSegments = (resourcePath: string): string[] => {
  if (!isSocratesResourcePath(resourcePath)) throw resourceMissing(resourcePath)
  return resourcePath.slice(RESOURCE_PREFIX.length).split("/").filter(Boolean).map(decodeURIComponent)
}
const normalizeSkillScope = (scope: string): "builtin" | "global" | "project" => {
  if (scope === "path") return "project"
  if (scope === "builtin" || scope === "global" || scope === "project") return scope
  throw resourceMissing(`socrates://skills/${scope}`)
}
const compileRegex = (query: string, caseSensitive = false): RegExp => {
  try {
    return new RegExp(query, caseSensitive ? "" : "i")
  } catch {
    throw new SocratesError("search_regex_invalid", "Search regex is invalid.", { recoverable: true })
  }
}
const resourceMissing = (path: string) => new SocratesError("resource_not_found", `Socrates resource was not found: ${path}`, { recoverable: true })
const hashText = (value: string): string => crypto.createHash("sha256").update(value).digest("hex")
const lineCount = (value: string): number => value.length === 0 ? 0 : value.split(/\r?\n/).length
const renderReplacementDiff = (path: string, before: string, after: string): string => before === after
  ? ""
  : [`--- ${path}`, `+++ ${path}`, `@@ full governed resource @@`, `-${before}`, `+${after}`].join("\n")
const resourceIndex = (): string => [
  "socrates://identity",
  "socrates://user/profile",
  "socrates://tool-guidance",
  "socrates://skills",
  "socrates://capabilities",
  "socrates://project/resources",
  "socrates://project/memory",
  "socrates://project/notes",
  "socrates://project/repo-docs",
].join("\n")
