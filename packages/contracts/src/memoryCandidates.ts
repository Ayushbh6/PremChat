import { z } from "zod"

export const memoryRetrievalSurfaceSchema = z.enum(["project_notes", "project_memory", "repo_docs", "user_profile", "identity"])
export type MemoryRetrievalSurface = z.infer<typeof memoryRetrievalSurfaceSchema>

export const memoryRetrievalFileSchema = z.enum([
  "PROJECT_NOTES.md",
  "MEMORY.md",
  "CORE_IDEA.md",
  "REPO_NAVIGATION.md",
  "REPO_RULES.md",
  "CONTRACTS.md",
  "user_profile.md",
  "identity.md",
])
export type MemoryRetrievalFile = z.infer<typeof memoryRetrievalFileSchema>

export const memoryRetrievalSectionSchema = z.enum([
  "runtime_context",
  "state_ledger",
  "active_context",
  "active_todos",
  "checked_files",
  "next_commands",
  "scratch_notes",
  "completed_archive",
  "current_state",
  "always_apply_rules",
  "durable_decisions",
  "constraints",
  "project_preferences",
  "blockers",
  "handoff",
  "evidence_anchors",
  "purpose",
  "current_direction",
  "milestones",
  "update_triggers",
  "ownership_map",
  "entry_points",
  "tests",
  "generated_ignored",
  "navigation_rules",
  "hard_rules",
  "workflows",
  "verification",
  "known_pitfalls",
  "tool_contracts",
  "api_contracts",
  "db_event_contracts",
  "frontend_backend",
  "change_log",
  "profile_summary",
  "global_always_apply_rules",
  "stable_preferences",
  "collaboration_style",
  "work_and_projects",
  "personal_interests",
  "boundaries_and_dislikes",
  "evidence_index",
  "core_identity",
  "voice_and_presence",
  "relationship_to_user",
  "operating_principles",
  "safety_boundaries",
  "tool_and_memory_discipline",
])
export type MemoryRetrievalSection = z.infer<typeof memoryRetrievalSectionSchema>

export const MEMORY_SECTIONS_BY_FILE: Record<MemoryRetrievalFile, readonly MemoryRetrievalSection[]> = {
  "PROJECT_NOTES.md": ["runtime_context", "state_ledger", "active_context", "active_todos", "checked_files", "next_commands", "scratch_notes", "completed_archive"],
  "MEMORY.md": ["current_state", "always_apply_rules", "durable_decisions", "constraints", "project_preferences", "blockers", "handoff", "evidence_anchors"],
  "CORE_IDEA.md": ["purpose", "current_direction", "milestones", "update_triggers"],
  "REPO_NAVIGATION.md": ["ownership_map", "entry_points", "tests", "generated_ignored", "navigation_rules"],
  "REPO_RULES.md": ["hard_rules", "workflows", "verification", "known_pitfalls", "update_triggers"],
  "CONTRACTS.md": ["tool_contracts", "api_contracts", "db_event_contracts", "frontend_backend", "change_log"],
  "user_profile.md": ["profile_summary", "global_always_apply_rules", "stable_preferences", "collaboration_style", "work_and_projects", "personal_interests", "boundaries_and_dislikes", "active_context", "evidence_index"],
  "identity.md": ["core_identity", "voice_and_presence", "relationship_to_user", "operating_principles", "safety_boundaries", "tool_and_memory_discipline"],
}
const validSectionsByFile: Record<MemoryRetrievalFile, ReadonlySet<MemoryRetrievalSection>> = Object.fromEntries(
  Object.entries(MEMORY_SECTIONS_BY_FILE).map(([fileName, sections]) => [fileName, new Set(sections)]),
) as unknown as Record<MemoryRetrievalFile, ReadonlySet<MemoryRetrievalSection>>

const validFilesBySurface: Record<MemoryRetrievalSurface, ReadonlySet<MemoryRetrievalFile>> = {
  project_notes: new Set(["PROJECT_NOTES.md"]),
  project_memory: new Set(["MEMORY.md"]),
  repo_docs: new Set(["CORE_IDEA.md", "REPO_NAVIGATION.md", "REPO_RULES.md", "CONTRACTS.md"]),
  user_profile: new Set(["user_profile.md"]),
  identity: new Set(["identity.md"]),
}

const memoryDestinationShape = {
  surface: memoryRetrievalSurfaceSchema,
  fileName: memoryRetrievalFileSchema,
  sectionId: memoryRetrievalSectionSchema,
}

const validateMemoryDestination = (
  input: { surface: MemoryRetrievalSurface; fileName: MemoryRetrievalFile; sectionId: MemoryRetrievalSection },
  context: z.RefinementCtx,
) => {
  if (!validFilesBySurface[input.surface].has(input.fileName)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["fileName"], message: `${input.fileName} is not owned by ${input.surface}.` })
  }
  if (!validSectionsByFile[input.fileName].has(input.sectionId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["sectionId"], message: `${input.sectionId} is not a valid section of ${input.fileName}.` })
  }
}

export const memoryCandidateQuerySchema = z
  .object({
    query: z.string().min(1).max(1_000),
    mode: z.enum(["lexical", "semantic", "combined"]).default("combined"),
    scope: z.enum(["global", "project", "all"]).default("all"),
    limit: z.number().int().positive().max(8).default(8),
  })
  .strict()
export type MemoryCandidateQuery = z.infer<typeof memoryCandidateQuerySchema>

export const memoryCandidateSchema = z
  .object({
    resultNumber: z.number().int().positive(),
    content: z.string().min(1),
    surface: memoryRetrievalSurfaceSchema,
    fileName: memoryRetrievalFileSchema,
    sectionId: memoryRetrievalSectionSchema,
    sectionHeading: z.string().min(1),
    scope: z.enum(["global", "project"]),
  })
  .strict()
  .superRefine(validateMemoryDestination)
export type MemoryCandidate = z.infer<typeof memoryCandidateSchema>

export const memoryCandidateRetrievalSchema = z
  .object({
    results: z.array(memoryCandidateSchema).max(8),
    totalMatches: z.number().int().nonnegative(),
    warnings: z.array(z.string()).optional(),
  })
  .strict()
export type MemoryCandidateRetrieval = z.infer<typeof memoryCandidateRetrievalSchema>
