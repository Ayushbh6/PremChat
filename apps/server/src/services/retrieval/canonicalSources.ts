import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { MemoryRetrievalFile, MemoryRetrievalSection, MemoryRetrievalSurface, TraceRetrieveVisibleStatus } from "@socrates/contracts"
import { chunkMarkdown, retrievalChunkId } from "@socrates/core"
import YAML from "yaml"
import type { DatabaseHandle } from "../../db/client"
import type { RetrievalIndexRow } from "./types"

const VISIBLE_CONVERSATION_STATUSES = ["active", "archived"]
const INDEXED_TURN_STATUSES = ["completed", "failed", "cancelled"]
const SKIPPED_MEMORY_SECTION_IDS = new Set(["always_apply_rules", "global_always_apply_rules"])
const LOW_PRIORITY_MEMORY_SECTION_IDS = new Set(["runtime_context", "legacy_content", "scratch_notes", "completed_archive"])

type CanonicalTurnRow = {
  runtimeKind: "classic" | "socrates"
  goalId: string
  projectId: string
  conversationId: string
  conversationTitle: string | null
  turnId: string
  turnStatus: string
  turnNumber: number
  startedAt: string
  completedAt: string | null
  failedAt: string | null
  cancelledAt: string | null
  userContent: string | null
  assistantContent: string | null
}

type CanonicalMemorySectionRow = {
  scope: string
  projectId: string
  path: string
  docType: string
  sectionId: string
  heading: string
  content: string
  updatedAt: string
}

type CanonicalGoalRow = {
  projectId: string
  goalId: string
  title: string
  status: string
  summary: string | null
  capsuleSummary: string | null
  updatedAt: string
}

export const loadCanonicalTraceRows = (handle: DatabaseHandle, projectId: string, turnId?: string): RetrievalIndexRow[] => {
  const placeholders = INDEXED_TURN_STATUSES.map(() => "?").join(",")
  const conversationPlaceholders = VISIBLE_CONVERSATION_STATUSES.map(() => "?").join(",")
  const classicRows = handle.sqlite
    .prepare(
      `WITH numbered_turns AS (
         SELECT t.id AS turnId,
                COALESCE((SELECT wt.goal_id FROM work_tasks wt WHERE wt.source_runtime = 'classic' AND wt.source_turn_id = t.id LIMIT 1), '') AS goalId,
                t.conversation_id AS conversationId,
                t.status AS turnStatus,
                t.started_at AS startedAt,
                t.completed_at AS completedAt,
                t.failed_at AS failedAt,
                t.cancelled_at AS cancelledAt,
                t.user_message_id AS userMessageId,
                t.assistant_message_id AS assistantMessageId,
                c.project_id AS projectId,
                c.title AS conversationTitle,
                COALESCE(t.ordinal, (
                  SELECT COUNT(*) FROM turns prior
                  WHERE prior.conversation_id = t.conversation_id
                    AND (prior.started_at < t.started_at OR (prior.started_at = t.started_at AND prior.id <= t.id))
                )) AS turnNumber
         FROM turns t
         INNER JOIN conversations c ON c.id = t.conversation_id
         WHERE c.project_id = ?
           AND (
             c.status IN (${conversationPlaceholders})
             OR EXISTS (
               SELECT 1 FROM work_tasks wt
               WHERE wt.source_runtime = 'classic'
                 AND wt.source_turn_id = t.id
                 AND wt.goal_id IS NOT NULL
             )
           )
           AND t.status IN (${placeholders})
           AND NOT EXISTS (
             SELECT 1 FROM v2_classic_message_links legacy_link
             WHERE legacy_link.classic_message_id = t.user_message_id
               AND legacy_link.source_runtime = 'v2'
           )
       )
       SELECT 'classic' AS runtimeKind,
              nt.*,
              um.content AS userContent,
              am.content AS assistantContent
       FROM numbered_turns nt
       LEFT JOIN messages um ON um.id = nt.userMessageId AND um.role = 'user'
       LEFT JOIN messages am ON am.id = nt.assistantMessageId AND am.role = 'assistant'
       ${turnId ? "WHERE nt.turnId = ?" : ""}
       ORDER BY nt.startedAt ASC`,
    )
    .all(projectId, ...VISIBLE_CONVERSATION_STATUSES, ...INDEXED_TURN_STATUSES, ...(turnId ? [turnId] : [])) as CanonicalTurnRow[]

  const socratesRows = handle.sqlite
    .prepare(
      `WITH numbered_v2_turns AS (
         SELECT t.id AS turnId,
                COALESCE(t.goal_id, '') AS goalId,
                t.status AS turnStatus,
                t.started_at AS startedAt,
                t.completed_at AS completedAt,
                t.failed_at AS failedAt,
                t.cancelled_at AS cancelledAt,
                COALESCE(t.user_message_id, root_turn.user_message_id) AS userMessageId,
                t.assistant_message_id AS assistantMessageId,
                t.project_id AS projectId,
                COALESCE('Socrates · ' || NULLIF(TRIM(g.title), ''), 'Socrates') AS conversationTitle,
                t.ordinal AS turnNumber
         FROM v2_turns t
         LEFT JOIN v2_goals g ON g.id = t.goal_id
         LEFT JOIN v2_agent_tasks task ON task.current_turn_id = t.id
         LEFT JOIN v2_turns root_turn ON root_turn.id = task.root_turn_id
         WHERE t.project_id = ?
           AND t.status IN (${placeholders})
           AND NOT EXISTS (
             SELECT 1 FROM v2_classic_message_links legacy_link
             WHERE legacy_link.v2_message_id = t.user_message_id
               AND legacy_link.source_runtime = 'classic'
           )
       )
       SELECT 'socrates' AS runtimeKind,
              'global-socrates' AS conversationId,
              nt.*,
              um.content AS userContent,
              am.content AS assistantContent
       FROM numbered_v2_turns nt
       LEFT JOIN v2_messages um ON um.id = nt.userMessageId AND um.role = 'user'
       LEFT JOIN v2_messages am ON am.id = nt.assistantMessageId AND am.role = 'assistant'
       ${turnId ? "WHERE nt.turnId = ?" : ""}
       ORDER BY nt.startedAt ASC`,
    )
    .all(projectId, ...INDEXED_TURN_STATUSES, ...(turnId ? [turnId] : [])) as CanonicalTurnRow[]

  return [...classicRows, ...socratesRows].flatMap((row) => traceChunksForTurn(row))
}

export const loadCanonicalMemoryRows = (handle: DatabaseHandle, projectId: string): RetrievalIndexRow[] => {
  const rows = handle.sqlite
    .prepare(
      `SELECT scope,
              project_id AS projectId,
              path,
              doc_type AS docType,
              section_id AS sectionId,
              heading,
              content,
              updated_at AS updatedAt
       FROM memory_doc_sections
       WHERE project_id IN (?, 'global')
         AND doc_type NOT IN ('tool_doc', 'skill')
       ORDER BY scope, path, section_id`,
    )
    .all(projectId) as CanonicalMemorySectionRow[]

  return rows.flatMap((row) => memoryChunksForSection(projectId, row))
}

export const loadCanonicalGoalRows = (handle: DatabaseHandle, projectId: string, goalId?: string): RetrievalIndexRow[] => {
  const rows = handle.sqlite.prepare(
    `SELECT source.project_id AS projectId,
            g.id AS goalId,
            g.title,
            g.status,
            g.summary,
            c.summary AS capsuleSummary,
            g.updated_at AS updatedAt
     FROM (SELECT DISTINCT project_id, goal_id FROM v2_turns WHERE goal_id IS NOT NULL) source
     INNER JOIN v2_goals g ON g.id = source.goal_id
     LEFT JOIN v2_goal_capsules c ON c.goal_id = g.id AND c.status = 'active'
     WHERE source.project_id = ?
       AND g.status <> 'archived'
       ${goalId ? "AND g.id = ?" : ""}
     ORDER BY g.last_active_at DESC, g.id`,
  ).all(projectId, ...(goalId ? [goalId] : [])) as CanonicalGoalRow[]
  return rows.map(goalCardRow)
}

export const loadCanonicalCapabilityRows = (handle: DatabaseHandle, projectId: string, socratesHome: string): RetrievalIndexRow[] => {
  const workspace = handle.sqlite.prepare(
    "SELECT path FROM project_workspaces WHERE project_id = ? AND is_primary = 1 AND status IN ('active','missing') ORDER BY updated_at DESC LIMIT 1",
  ).get(projectId) as { path?: string } | undefined
  const skillRoots: Array<{ scope: "builtin" | "global" | "path"; root: string }> = [
    { scope: "builtin", root: bundledSkillsRoot() },
    { scope: "global", root: path.join(socratesHome, "skills") },
    ...(workspace?.path ? [{ scope: "path" as const, root: path.join(workspace.path, ".socrates", "skills") }] : []),
  ]
  const skills = skillRoots.flatMap(({ scope, root }) => loadSkillCards(projectId, scope, root))
  const mcpRoots: Array<{ scope: "global" | "path"; configPath: string; registryPath: string }> = [
    { scope: "global", configPath: path.join(socratesHome, "mcp.json"), registryPath: path.join(socratesHome, "mcp", "registry") },
    ...(workspace?.path ? [{ scope: "path" as const, configPath: path.join(workspace.path, ".socrates", "mcp.json"), registryPath: path.join(workspace.path, ".socrates", "mcp", "registry") }] : []),
  ]
  return [...skills, ...mcpRoots.flatMap(({ scope, configPath, registryPath }) => loadMcpCards(projectId, scope, configPath, registryPath))]
}

export const canonicalMemoryParentId = (input: { scope: string; projectId: string; path: string; sectionId: string }): string =>
  `${input.scope === "global" ? "global" : "project"}:${input.projectId}:${input.path}:${input.sectionId}`

const traceChunksForTurn = (row: CanonicalTurnRow): RetrievalIndexRow[] => {
  const status = visibleStatus(row)
  const occurredAt = row.completedAt ?? row.cancelledAt ?? row.failedAt ?? row.startedAt
  const parentId = row.turnId
  const base = {
    projectId: row.projectId,
    corpusKind: "trace_turn" as const,
    parentId,
    occurredAt,
    priority: 1,
    scope: "project" as const,
    runtimeKind: row.runtimeKind,
    goalId: row.goalId,
    surface: "" as const,
    fileName: "" as const,
    sectionId: "" as const,
    sectionHeading: "",
    conversationId: row.conversationId,
    conversationTitle: row.conversationTitle?.trim() || "Untitled conversation",
    turnId: row.turnId,
    turnNumber: row.turnNumber,
    status,
  }
  const parts: Array<{ role: "user" | "assistant"; content: string }> = []
  if (row.userContent?.trim()) parts.push({ role: "user", content: row.userContent })
  if (row.assistantContent?.trim()) parts.push({ role: "assistant", content: row.assistantContent })
  return parts.flatMap((part) =>
    chunkMarkdown(part.content).map((chunk) => ({
      ...base,
      id: retrievalChunkId({ corpusKind: "trace_turn", parentId, discriminator: part.role, chunkIndex: chunk.chunkIndex, contentHash: chunk.contentHash }),
      discriminator: part.role,
      content: chunk.content,
      contentHash: chunk.contentHash,
      chunkIndex: chunk.chunkIndex,
      tokenCount: chunk.tokenCount,
      matchedRole: part.role,
    })),
  )
}

const memoryChunksForSection = (activeProjectId: string, row: CanonicalMemorySectionRow): RetrievalIndexRow[] => {
  if (!row.content.trim() || SKIPPED_MEMORY_SECTION_IDS.has(row.sectionId)) return []
  const mapped = memoryLocation(row)
  if (!mapped) return []
  const scope = row.scope === "global" ? "global" : "project"
  const parentId = canonicalMemoryParentId(row)
  return chunkMarkdown(row.content).map((chunk) => ({
    id: retrievalChunkId({ corpusKind: "memory_section", parentId, discriminator: "section", chunkIndex: chunk.chunkIndex, contentHash: chunk.contentHash }),
    projectId: activeProjectId,
    corpusKind: "memory_section",
    parentId,
    discriminator: "section",
    content: chunk.content,
    contentHash: chunk.contentHash,
    chunkIndex: chunk.chunkIndex,
    tokenCount: chunk.tokenCount,
    occurredAt: row.updatedAt,
    priority: LOW_PRIORITY_MEMORY_SECTION_IDS.has(row.sectionId) ? 0.65 : 1,
    scope,
    runtimeKind: "memory" as const,
    goalId: "",
    surface: mapped.surface,
    fileName: mapped.fileName,
    sectionId: row.sectionId as MemoryRetrievalSection,
    sectionHeading: row.heading,
    conversationId: "",
    conversationTitle: "",
    turnId: "",
    turnNumber: 0,
    matchedRole: "",
    status: "",
  }))
}

const goalCardRow = (row: CanonicalGoalRow): RetrievalIndexRow => {
  const content = [
    `Goal: ${row.title}`,
    `State: ${row.status}`,
    `Note: ${row.capsuleSummary?.trim() || row.summary?.trim() || "No progress note yet."}`,
  ].join("\n")
  const chunk = chunkMarkdown(content)[0]!
  return {
    id: retrievalChunkId({ corpusKind: "goal_card", parentId: row.goalId, discriminator: "goal", chunkIndex: 0, contentHash: chunk.contentHash }),
    projectId: row.projectId,
    corpusKind: "goal_card",
    parentId: row.goalId,
    discriminator: "goal",
    content,
    contentHash: chunk.contentHash,
    chunkIndex: 0,
    tokenCount: chunk.tokenCount,
    occurredAt: row.updatedAt,
    priority: 1,
    scope: "project",
    runtimeKind: "goal",
    goalId: row.goalId,
    surface: "",
    fileName: "",
    sectionId: "",
    sectionHeading: row.title,
    conversationId: "",
    conversationTitle: "",
    turnId: "",
    turnNumber: 0,
    matchedRole: "",
    status: "",
  }
}

const loadSkillCards = (projectId: string, scope: "builtin" | "global" | "path", root: string): RetrievalIndexRow[] => {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
    const skillPath = path.join(root, entry.name, "SKILL.md")
    if (!fs.existsSync(skillPath)) return []
    const provenancePath = path.join(root, entry.name, ".socrates-skill.json")
    try {
      if (fs.existsSync(provenancePath)) {
        const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8")) as { enabled?: boolean }
        if (provenance.enabled === false) return []
      }
      const markdown = fs.readFileSync(skillPath, "utf8")
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1]
      if (!frontmatter) return []
      const parsed = YAML.parse(frontmatter) as { name?: unknown; description?: unknown }
      const name = typeof parsed?.name === "string" ? parsed.name.trim() : ""
      const description = typeof parsed?.description === "string" ? parsed.description.trim() : ""
      if (!name || !description || name !== entry.name) return []
      return capabilityCardRows({ projectId, kind: "skill", scope, name, description, occurredAt: fs.statSync(skillPath).mtime.toISOString() })
    } catch {
      return []
    }
  })
}

const loadMcpCards = (projectId: string, scope: "global" | "path", configPath: string, registryPath: string): RetrievalIndexRow[] => {
  if (!fs.existsSync(configPath)) return []
  try {
    const document = JSON.parse(fs.readFileSync(configPath, "utf8")) as { servers?: Record<string, { label?: string; enabled?: boolean }> }
    return Object.entries(document.servers ?? {}).filter(([, server]) => server.enabled !== false).flatMap(([id, server]) => {
      const toolsPath = path.join(registryPath, `${id}.tools.json`)
      const tools = readMcpTools(toolsPath)
      const label = server.label?.trim() || id
      const description = [
        `${label} MCP server.`,
        ...tools.map((tool) => `${tool.name ?? "tool"}: ${tool.description ?? "MCP tool"}`),
      ].join("\n")
      return capabilityCardRows({ projectId, kind: "mcp", scope, name: id, description, occurredAt: fs.statSync(configPath).mtime.toISOString() })
    })
  } catch {
    return []
  }
}

const readMcpTools = (toolsPath: string): Array<{ name?: string; description?: string }> => {
  if (!fs.existsSync(toolsPath)) return []
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(toolsPath, "utf8"))
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((tool): tool is { name?: string; description?: string } => Boolean(tool) && typeof tool === "object" && !Array.isArray(tool))
      .slice(0, 40)
  } catch {
    return []
  }
}

const capabilityCardRows = (input: {
  projectId: string
  kind: "skill" | "mcp"
  scope: "builtin" | "global" | "path"
  name: string
  description: string
  occurredAt: string
}): RetrievalIndexRow[] => {
  const parentId = `${input.kind}:${input.scope}:${input.name}`
  const content = `${input.kind === "skill" ? "Skill" : "MCP"}: ${input.name}\nScope: ${input.scope}\n${input.description}`
  return chunkMarkdown(content).map((chunk) => ({
    id: retrievalChunkId({ corpusKind: "capability_card", parentId, discriminator: input.kind, chunkIndex: chunk.chunkIndex, contentHash: chunk.contentHash }),
    projectId: input.projectId,
    corpusKind: "capability_card",
    parentId,
    discriminator: input.kind,
    content: chunk.content,
    contentHash: chunk.contentHash,
    chunkIndex: chunk.chunkIndex,
    tokenCount: chunk.tokenCount,
    occurredAt: input.occurredAt,
    priority: 1,
    scope: input.scope === "path" ? "project" : "global",
    runtimeKind: "capability",
    goalId: "",
    surface: "",
    fileName: "",
    sectionId: "",
    sectionHeading: input.name,
    conversationId: "",
    conversationTitle: "",
    turnId: "",
    turnNumber: 0,
    matchedRole: "",
    status: "",
  }))
}

const bundledSkillsRoot = (): string => {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  return [
    path.resolve(moduleDir, "../../memory/defaults/primary/skills"),
    path.resolve(process.cwd(), "src/memory/defaults/primary/skills"),
    path.resolve(process.cwd(), "dist/memory/defaults/primary/skills"),
  ].find((candidate) => fs.existsSync(candidate)) ?? path.resolve(moduleDir, "../../memory/defaults/primary/skills")
}

const visibleStatus = (row: CanonicalTurnRow): TraceRetrieveVisibleStatus => {
  if (row.turnStatus === "completed") return "complete"
  if (row.turnStatus === "cancelled") return row.assistantContent?.trim() ? "cancelled_partial" : "cancelled_user_only"
  return "failed_user_only"
}

const memoryLocation = (row: CanonicalMemorySectionRow): { surface: MemoryRetrievalSurface; fileName: MemoryRetrievalFile } | undefined => {
  const fileName = path.basename(row.path) as MemoryRetrievalFile
  if (row.docType === "project_notes") return { surface: "project_notes", fileName: "PROJECT_NOTES.md" }
  if (row.docType === "project_memory") return { surface: "project_memory", fileName: "MEMORY.md" }
  if (row.docType === "user_profile") return { surface: "user_profile", fileName: "user_profile.md" }
  if (row.docType === "identity") return { surface: "identity", fileName: "identity.md" }
  if (row.docType.startsWith("repo_")) return { surface: "repo_docs", fileName }
  return undefined
}
