import type Database from "better-sqlite3"

export const CANONICAL_PRODUCT_TABLES = [
  "app_state", "settings", "access_roots", "access_snapshots", "goals", "goal_capsule_versions",
  "tasks", "messages", "task_events", "model_calls", "tool_calls", "interaction_requests",
  "terminal_sessions", "terminal_output_chunks", "artifacts", "resources", "resource_locations",
  "resource_bindings", "knowledge_entries", "knowledge_versions", "memory_notes", "background_jobs",
  "capabilities", "capability_versions", "retrieval_sources", "context_compactions",
] as const

export const CANONICAL_MIGRATION_TABLE = "_socrates_migrations" as const
export const CANONICAL_SCHEMA_VERSION = 1
export const CANONICAL_SCHEMA_MARKER = "global-goal-schema-v1" as const

const definitions: Record<(typeof CANONICAL_PRODUCT_TABLES)[number], string> = {
  app_state: `id TEXT PRIMARY KEY CHECK (id = 'global'), foreground_goal_id TEXT, active_root_task_id TEXT,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0), recovery_sequence INTEGER NOT NULL DEFAULT 0 CHECK (recovery_sequence >= 0), updated_at TEXT NOT NULL`,
  settings: `key TEXT PRIMARY KEY, value_json TEXT NOT NULL CHECK (json_valid(value_json)), revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL`,
  access_roots: `id TEXT PRIMARY KEY, label TEXT NOT NULL, canonical_path TEXT NOT NULL UNIQUE, is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
    status TEXT NOT NULL CHECK (status IN ('active','missing','revoked')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revoked_at TEXT`,
  access_snapshots: `id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE, mode TEXT NOT NULL CHECK (mode IN ('read_only','selected','full')),
    revision INTEGER NOT NULL, roots_json TEXT NOT NULL CHECK (json_valid(roots_json)), working_directory TEXT, created_at TEXT NOT NULL`,
  goals: `id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL UNIQUE, title TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active','completed','pinned','archived')),
    latest_capsule_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT, archived_at TEXT`,
  goal_capsule_versions: `id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, version INTEGER NOT NULL, objective TEXT NOT NULL, summary TEXT NOT NULL,
    state TEXT NOT NULL, progress_json TEXT NOT NULL CHECK (json_valid(progress_json)), constraints_json TEXT NOT NULL CHECK (json_valid(constraints_json)),
    decisions_json TEXT NOT NULL CHECK (json_valid(decisions_json)), open_questions_json TEXT NOT NULL CHECK (json_valid(open_questions_json)),
    next_actions_json TEXT NOT NULL CHECK (json_valid(next_actions_json)), resource_refs_json TEXT NOT NULL CHECK (json_valid(resource_refs_json)),
    source_through_event_sequence INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(goal_id, version)`,
  tasks: `id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL UNIQUE, goal_id TEXT, parent_task_id TEXT, access_snapshot_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('routing','running','awaiting_input','completed','failed','cancelled','recovering')),
    request_message_id TEXT NOT NULL, final_message_id TEXT, error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT`,
  messages: `id TEXT PRIMARY KEY, task_id TEXT NOT NULL, ordinal INTEGER NOT NULL, role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
    content TEXT NOT NULL, content_format TEXT NOT NULL DEFAULT 'markdown', attachments_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(attachments_json)),
    feedback_json TEXT CHECK (feedback_json IS NULL OR json_valid(feedback_json)), created_at TEXT NOT NULL, completed_at TEXT, UNIQUE(task_id, ordinal)`,
  task_events: `id TEXT PRIMARY KEY, task_id TEXT, goal_id TEXT, sequence INTEGER NOT NULL UNIQUE CHECK (sequence > 0), type TEXT NOT NULL,
    source TEXT NOT NULL, payload_json TEXT NOT NULL CHECK (json_valid(payload_json)), created_at TEXT NOT NULL`,
  model_calls: `id TEXT PRIMARY KEY, task_id TEXT NOT NULL, role TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
    status TEXT NOT NULL, request_json TEXT NOT NULL CHECK (json_valid(request_json)), response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
    usage_json TEXT CHECK (usage_json IS NULL OR json_valid(usage_json)), error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
    started_at TEXT NOT NULL, completed_at TEXT`,
  tool_calls: `id TEXT PRIMARY KEY, task_id TEXT NOT NULL, model_call_id TEXT, name TEXT NOT NULL, status TEXT NOT NULL,
    input_json TEXT NOT NULL CHECK (json_valid(input_json)), output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
    evidence_json TEXT CHECK (evidence_json IS NULL OR json_valid(evidence_json)), error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
    started_at TEXT NOT NULL, completed_at TEXT`,
  interaction_requests: `id TEXT PRIMARY KEY, task_id TEXT NOT NULL, tool_call_id TEXT, kind TEXT NOT NULL CHECK (kind IN ('approval','credential','clarification','frontier_approval','proposal_acceptance')),
    status TEXT NOT NULL, fingerprint TEXT, prompt TEXT NOT NULL, public_payload_json TEXT NOT NULL CHECK (json_valid(public_payload_json)),
    requested_at TEXT NOT NULL, resolved_at TEXT, resolution_json TEXT CHECK (resolution_json IS NULL OR json_valid(resolution_json))`,
  terminal_sessions: `id TEXT PRIMARY KEY, task_id TEXT NOT NULL, name TEXT NOT NULL, command TEXT NOT NULL, cwd TEXT NOT NULL,
    status TEXT NOT NULL, process_id TEXT, containment_json TEXT NOT NULL CHECK (json_valid(containment_json)), metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT`,
  terminal_output_chunks: `id TEXT PRIMARY KEY, terminal_session_id TEXT NOT NULL, sequence INTEGER NOT NULL, stream TEXT NOT NULL,
    content TEXT NOT NULL, redacted INTEGER NOT NULL DEFAULT 0 CHECK (redacted IN (0,1)), created_at TEXT NOT NULL, UNIQUE(terminal_session_id, sequence)`,
  artifacts: `id TEXT PRIMARY KEY, task_id TEXT, kind TEXT NOT NULL, name TEXT NOT NULL, storage_path TEXT NOT NULL,
    mime_type TEXT, size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0), sha256 TEXT NOT NULL, metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)), created_at TEXT NOT NULL`,
  resources: `id TEXT PRIMARY KEY, label TEXT NOT NULL, kind TEXT NOT NULL, availability TEXT NOT NULL CHECK (availability IN ('available','missing','ambiguous','unavailable')),
    fingerprint_json TEXT CHECK (fingerprint_json IS NULL OR json_valid(fingerprint_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL`,
  resource_locations: `id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, canonical_path TEXT NOT NULL, status TEXT NOT NULL,
    fingerprint_json TEXT CHECK (fingerprint_json IS NULL OR json_valid(fingerprint_json)), valid_from TEXT NOT NULL, valid_to TEXT`,
  resource_bindings: `id TEXT PRIMARY KEY, owner_kind TEXT NOT NULL CHECK (owner_kind IN ('goal','task')), owner_id TEXT NOT NULL,
    resource_id TEXT NOT NULL, resource_location_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active','released')),
    confirmed_by TEXT NOT NULL, created_at TEXT NOT NULL, released_at TEXT`,
  knowledge_entries: `id TEXT PRIMARY KEY, scope_kind TEXT NOT NULL CHECK (scope_kind IN ('global','resource')), resource_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('identity','profile','rule','memory','repo_fact')), stable_key TEXT NOT NULL, active_version INTEGER,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(scope_kind, resource_id, stable_key)`,
  knowledge_versions: `id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('accepted','pending','superseded','deleted')),
    content_json TEXT NOT NULL CHECK (json_valid(content_json)), provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT, UNIQUE(entry_id, version)`,
  memory_notes: `id TEXT PRIMARY KEY, task_id TEXT NOT NULL, content TEXT NOT NULL, importance TEXT NOT NULL,
    evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)), status TEXT NOT NULL, created_at TEXT NOT NULL, processed_at TEXT`,
  background_jobs: `id TEXT PRIMARY KEY, kind TEXT NOT NULL, task_id TEXT, status TEXT NOT NULL, payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    attempts INTEGER NOT NULL DEFAULT 0, available_at TEXT NOT NULL, locked_at TEXT, error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT`,
  capabilities: `id TEXT PRIMARY KEY, scope_kind TEXT NOT NULL CHECK (scope_kind IN ('global','resource')), resource_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('skill','mcp')), name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    active_version INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(scope_kind, resource_id, kind, name)`,
  capability_versions: `id TEXT PRIMARY KEY, capability_id TEXT NOT NULL, version INTEGER NOT NULL, content_hash TEXT NOT NULL,
    config_json TEXT NOT NULL CHECK (json_valid(config_json)), approval_provenance_json TEXT NOT NULL CHECK (json_valid(approval_provenance_json)),
    created_at TEXT NOT NULL, UNIQUE(capability_id, version)`,
  retrieval_sources: `id TEXT PRIMARY KEY, source_kind TEXT NOT NULL, source_id TEXT NOT NULL, parent_id TEXT NOT NULL,
    canonical_hash TEXT NOT NULL, index_status TEXT NOT NULL, indexed_at TEXT, metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)), UNIQUE(source_kind, source_id, canonical_hash)`,
  context_compactions: `id TEXT PRIMARY KEY, task_id TEXT NOT NULL, model_call_id TEXT, scope_kind TEXT NOT NULL,
    source_range_json TEXT NOT NULL CHECK (json_valid(source_range_json)), provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
    token_counts_json TEXT NOT NULL CHECK (json_valid(token_counts_json)), content TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)), created_at TEXT NOT NULL`,
}

export const initializeCanonicalDatabase = (database: Database.Database, now = new Date().toISOString()): void => {
  database.pragma("foreign_keys = ON")
  database.transaction(() => {
    database.exec(`CREATE TABLE IF NOT EXISTS ${CANONICAL_MIGRATION_TABLE} (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`)
    for (const table of CANONICAL_PRODUCT_TABLES) database.exec(`CREATE TABLE IF NOT EXISTS ${table} (${definitions[table]})`)
    database.prepare(`INSERT OR IGNORE INTO ${CANONICAL_MIGRATION_TABLE} (version, applied_at) VALUES (?, ?)`).run(CANONICAL_SCHEMA_VERSION, now)
    database.prepare(`INSERT OR IGNORE INTO app_state (id, revision, recovery_sequence, updated_at) VALUES ('global', 1, 0, ?)`).run(now)
    database.prepare(
      `INSERT INTO settings (key, value_json, revision, created_at, updated_at)
       VALUES ('schema.marker', ?, 1, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, revision = excluded.revision, updated_at = excluded.updated_at`,
    ).run(JSON.stringify(CANONICAL_SCHEMA_MARKER), now, now)
  })()
}

export const canonicalTableNames = (database: Database.Database): string[] =>
  (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map(({ name }) => name)

export const hasCanonicalSchema = (database: Database.Database): boolean => {
  const tables = canonicalTableNames(database)
  if (tables.length !== CANONICAL_PRODUCT_TABLES.length + 1) return false
  if (!tables.every((table) => table === CANONICAL_MIGRATION_TABLE || CANONICAL_PRODUCT_TABLES.includes(table as (typeof CANONICAL_PRODUCT_TABLES)[number]))) {
    return false
  }
  try {
    const marker = database.prepare("SELECT value_json FROM settings WHERE key = 'schema.marker' LIMIT 1").get() as { value_json?: string } | undefined
    return marker?.value_json === JSON.stringify(CANONICAL_SCHEMA_MARKER)
  } catch {
    return false
  }
}
