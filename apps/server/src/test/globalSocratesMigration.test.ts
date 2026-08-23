import fs from "node:fs"
import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"

const migrationsDirectory = fileURLToPath(new URL("../../drizzle", import.meta.url))
const migrationStatements = (fileName: string): string[] => fs
  .readFileSync(new URL(`../../drizzle/${fileName}`, import.meta.url), "utf8")
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean)

const applyStatements = (database: Database.Database, statements: readonly string[]): void => {
  database.transaction(() => {
    for (const statement of statements) database.exec(statement)
  })()
}

const applyReleasedMigrations = (database: Database.Database): void => {
  const files = fs.readdirSync(migrationsDirectory)
    .filter((fileName) => /^\d{4}_.+\.sql$/.test(fileName) && fileName < "0035_")
    .sort()
  for (const fileName of files) applyStatements(database, migrationStatements(fileName))
}

const seedReleasedFlowData = (database: Database.Database): void => {
  database.exec(`
    INSERT INTO users (id, display_name, onboarding_completed, created_at, updated_at, metadata_json)
    VALUES ('user_1', 'Fixture', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL);
    INSERT INTO projects (id, user_id, name, status, created_at, updated_at, metadata_json)
    VALUES
      ('project_a', 'user_1', 'A', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '{"internalGlobalCompatibilityProject":{"hidden":true,"version":1},"preserve":"yes"}'),
      ('project_b', 'user_1', 'B', 'active', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', NULL);
    INSERT INTO v2_flows (id, project_id, status, foreground_goal_id, context_policy_json, revision, last_event_sequence, created_at, updated_at, metadata_json)
    VALUES
      ('flow_a', 'project_a', 'active', 'goal_a', '{}', 3, 1, '2026-01-01T00:00:00.000Z', '2026-01-03T00:00:00.000Z', NULL),
      ('flow_b', 'project_b', 'active', 'goal_b', '{}', 7, 1, '2026-01-02T00:00:00.000Z', '2026-01-04T00:00:00.000Z', NULL);
    INSERT INTO v2_goals (id, flow_id, project_id, ordinal, title, summary, kind, status, origin, priority, pinned, last_active_at, created_at, updated_at, metadata_json)
    VALUES
      ('goal_a', 'flow_a', 'project_a', 1, 'Goal A', 'Exact summary A', 'work', 'foreground', 'user', 50, 0, '2026-01-03T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-03T00:00:00.000Z', NULL),
      ('goal_b', 'flow_b', 'project_b', 1, 'Goal B', 'Exact summary B', 'work', 'foreground', 'user', 50, 0, '2026-01-04T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-04T00:00:00.000Z', NULL);
    INSERT INTO v2_goal_capsules (id, flow_id, goal_id, version, status, summary, decisions_json, open_questions_json, next_actions_json, evidence_handles_json, source_through_sequence, token_estimate, created_at, metadata_json)
    VALUES
      ('capsule_a', 'flow_a', 'goal_a', 1, 'active', 'Capsule A', '[]', '[]', '[]', '[]', 1, 3, '2026-01-03T00:00:00.000Z', NULL),
      ('capsule_b', 'flow_b', 'goal_b', 1, 'active', 'Capsule B', '[]', '[]', '[]', '[]', 1, 3, '2026-01-04T00:00:00.000Z', NULL);
    INSERT INTO v2_turns (id, flow_id, project_id, goal_id, ordinal, user_message_id, assistant_message_id, status, started_at, updated_at, completed_at, metadata_json)
    VALUES
      ('turn_a', 'flow_a', 'project_a', 'goal_a', 1, 'message_a_user', 'message_a_assistant', 'completed', '2026-01-03T00:00:00.000Z', '2026-01-03T00:01:00.000Z', '2026-01-03T00:01:00.000Z', NULL),
      ('turn_b', 'flow_b', 'project_b', 'goal_b', 1, 'message_b_user', 'message_b_assistant', 'completed', '2026-01-04T00:00:00.000Z', '2026-01-04T00:01:00.000Z', '2026-01-04T00:01:00.000Z', NULL);
    INSERT INTO v2_messages (id, flow_id, project_id, goal_id, turn_id, ordinal, role, kind, content, content_format, status, created_at, completed_at, metadata_json)
    VALUES
      ('message_a_user', 'flow_a', 'project_a', 'goal_a', 'turn_a', 1, 'user', 'standard', 'Exact request A', 'markdown', 'completed', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z', NULL),
      ('message_a_assistant', 'flow_a', 'project_a', 'goal_a', 'turn_a', 2, 'assistant', 'standard', 'Exact answer A', 'markdown', 'completed', '2026-01-03T00:01:00.000Z', '2026-01-03T00:01:00.000Z', NULL),
      ('message_b_user', 'flow_b', 'project_b', 'goal_b', 'turn_b', 1, 'user', 'standard', 'Exact request B', 'markdown', 'completed', '2026-01-04T00:00:00.000Z', '2026-01-04T00:00:00.000Z', NULL),
      ('message_b_assistant', 'flow_b', 'project_b', 'goal_b', 'turn_b', 2, 'assistant', 'standard', 'Exact answer B', 'markdown', 'completed', '2026-01-04T00:01:00.000Z', '2026-01-04T00:01:00.000Z', NULL);
    INSERT INTO work_tasks (id, project_id, goal_id, source_runtime, source_turn_id, started_at, created_at, updated_at, metadata_json)
    VALUES
      ('task_a', 'project_a', 'goal_a', 'v2_flow', 'turn_a', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z', '2026-01-03T00:01:00.000Z', NULL),
      ('task_b', 'project_b', 'goal_b', 'v2_flow', 'turn_b', '2026-01-04T00:00:00.000Z', '2026-01-04T00:00:00.000Z', '2026-01-04T00:01:00.000Z', NULL);
    INSERT INTO work_messages (id, task_id, source_runtime, source_message_id, role, source_created_at, created_at)
    VALUES
      ('work_message_a', 'task_a', 'v2_flow', 'message_a_user', 'user', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z'),
      ('work_message_b', 'task_b', 'v2_flow', 'message_b_user', 'user', '2026-01-04T00:00:00.000Z', '2026-01-04T00:00:00.000Z');
    INSERT INTO v2_runtime_events (id, flow_id, project_id, goal_id, turn_id, sequence, type, source, payload_json, created_at)
    VALUES
      ('event_a', 'flow_a', 'project_a', 'goal_a', 'turn_a', 1, 'v2.turn.updated', 'main_agent', '{}', '2026-01-03T00:01:00.000Z'),
      ('event_b', 'flow_b', 'project_b', 'goal_b', 'turn_b', 1, 'v2.turn.updated', 'main_agent', '{}', '2026-01-04T00:01:00.000Z');
    INSERT INTO v2_evidence_items (id, handle, flow_id, project_id, goal_id, turn_id, source_kind, title, content, content_hash, created_at, metadata_json)
    VALUES ('evidence_b', 'E1', 'flow_b', 'project_b', 'goal_b', 'turn_b', 'tool_result', 'Exact evidence B', 'evidence bytes', 'hash_b', '2026-01-04T00:00:30.000Z', NULL);
  `)
}

describe("global Socrates persistence migration", () => {
  it("removes Flow ownership while preserving exact goal, exchange, evidence, and provenance data", () => {
    const database = new Database(":memory:")
    applyReleasedMigrations(database)
    seedReleasedFlowData(database)

    applyStatements(database, migrationStatements("0035_yellow_blindfold.sql"))

    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'v2_flows'").get()).toBeUndefined()
    expect(database.prepare("SELECT foreground_goal_id, revision, last_event_sequence FROM global_socrates_state WHERE id = 'global'").get()).toEqual({
      foreground_goal_id: "goal_b",
      revision: 7,
      last_event_sequence: 2,
    })
    expect(database.prepare("SELECT id, ordinal, title, summary, status FROM v2_goals ORDER BY ordinal").all()).toEqual([
      { id: "goal_a", ordinal: 1, title: "Goal A", summary: "Exact summary A", status: "parked" },
      { id: "goal_b", ordinal: 2, title: "Goal B", summary: "Exact summary B", status: "foreground" },
    ])
    expect(database.prepare("SELECT content FROM v2_messages ORDER BY ordinal").all()).toEqual([
      { content: "Exact request A" },
      { content: "Exact answer A" },
      { content: "Exact request B" },
      { content: "Exact answer B" },
    ])
    expect(database.prepare("SELECT source_runtime, source_turn_id, json_extract(metadata_json, '$.legacyFlowId') AS legacy_flow_id FROM work_tasks ORDER BY id").all()).toEqual([
      { source_runtime: "socrates", source_turn_id: "turn_a", legacy_flow_id: "flow_a" },
      { source_runtime: "socrates", source_turn_id: "turn_b", legacy_flow_id: "flow_b" },
    ])
    expect(database.prepare("SELECT content, content_hash FROM v2_evidence_items WHERE id = 'evidence_b'").get()).toEqual({ content: "evidence bytes", content_hash: "hash_b" })
    expect(database.prepare("SELECT metadata_json FROM projects WHERE id = 'project_a'").get()).toEqual({ metadata_json: '{"preserve":"yes"}' })
    expect(database.prepare("SELECT type FROM v2_runtime_events ORDER BY sequence").all()).toEqual([
      { type: "socrates.turn.updated" },
      { type: "socrates.turn.updated" },
    ])
    expect(() => database.prepare(`
      INSERT INTO v2_runtime_events (id, project_id, sequence, type, source, payload_json, created_at)
      VALUES ('event_new', 'project_b', 3, 'socrates.connection.ready', 'runtime', '{}', '2026-01-04T00:02:00.000Z')
    `).run()).not.toThrow()
    expect(() => database.prepare(`
      INSERT INTO v2_runtime_events (id, project_id, sequence, type, source, payload_json, created_at)
      VALUES ('event_old', 'project_b', 4, 'v2.connection.ready', 'runtime', '{}', '2026-01-04T00:03:00.000Z')
    `).run()).toThrow("v2_runtime_events_type_check")

    for (const table of ["v2_goals", "v2_turns", "v2_messages", "v2_runtime_events", "v2_tool_calls", "v2_terminal_sessions"]) {
      const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      expect(columns.some((column) => column.name === "flow_id"), table).toBe(false)
    }
    database.close()
  })

  it("rolls an interrupted migration back so the released source remains retryable", () => {
    const database = new Database(":memory:")
    applyReleasedMigrations(database)
    seedReleasedFlowData(database)
    const statements = migrationStatements("0035_yellow_blindfold.sql")

    expect(() => database.transaction(() => {
      for (const statement of statements.slice(0, 12)) database.exec(statement)
      throw new Error("simulated interruption")
    })()).toThrow("simulated interruption")

    expect(database.prepare("SELECT COUNT(*) AS count FROM v2_flows").get()).toEqual({ count: 2 })
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'global_socrates_state'").get()).toBeUndefined()

    applyStatements(database, statements)
    expect(database.prepare("SELECT COUNT(*) AS count FROM global_socrates_state").get()).toEqual({ count: 1 })
    database.close()
  })
})
