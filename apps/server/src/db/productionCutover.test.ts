import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"
import { CANONICAL_PRODUCT_TABLES, canonicalTableNames, hasCanonicalSchema, initializeCanonicalDatabase } from "./canonicalSchema"
import { performProductionCutover } from "./productionCutover"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const releasedHome = () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-production-cutover-"))
  roots.push(home)
  const databasePath = path.join(home, "socrates.sqlite")
  const database = new Database(databasePath)
  database.exec(`
    CREATE TABLE schema_migrations (version INTEGER, name TEXT);
    INSERT INTO schema_migrations VALUES (34, 'released');
    CREATE TABLE turns (id TEXT PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE filesystem_access_settings (user_id TEXT PRIMARY KEY, mode TEXT, revision INTEGER, updated_at TEXT);
    INSERT INTO filesystem_access_settings VALUES ('user', 'selected', 4, '2026-07-30T00:00:00.000Z');
    CREATE TABLE filesystem_roots (id TEXT PRIMARY KEY, label TEXT, path TEXT, is_default INTEGER, status TEXT, created_at TEXT, updated_at TEXT, revoked_at TEXT);
    INSERT INTO filesystem_roots VALUES ('root_source', 'Source', '/tmp/source', 1, 'active', '2026-07-30T00:00:00.000Z', '2026-07-30T00:00:00.000Z', NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT);
    INSERT INTO users VALUES ('user', 'Aparajit');
    CREATE TABLE worker_model_settings (worker_id TEXT, provider_id TEXT, auth_mode TEXT, model_id TEXT, thinking_enabled INTEGER, thinking_effort TEXT);
    INSERT INTO worker_model_settings VALUES ('frontier', 'openrouter', 'api_key', 'x-ai/grok-4.5', 1, 'low');
    CREATE TABLE memory_agent_global_settings (provider_id TEXT, auth_mode TEXT, model_id TEXT, thinking_enabled INTEGER, thinking_effort TEXT, enabled INTEGER);
    INSERT INTO memory_agent_global_settings VALUES ('openrouter', 'api_key', 'deepseek/deepseek-v4-flash', 0, NULL, 1);
    CREATE TABLE memory_doc_sections (scope TEXT, path TEXT, section_id TEXT, heading TEXT, content TEXT);
    INSERT INTO memory_doc_sections VALUES ('global', 'user_profile.md', 'cross_project', 'Cross-project memory', 'The user prefers exact evidence.');
  `)
  database.close()
  fs.writeFileSync(path.join(home, "identity.md"), "# Identity\n\nSocrates helps carefully.\n")
  fs.writeFileSync(path.join(home, "user_profile.md"), "# Profile\n\n## Global Always Apply Rules\n\n- Use exact evidence.\n- Preserve user data.\n\n## Other\n\nProfile text.\n")
  fs.mkdirSync(path.join(home, "skills", "global", "review"), { recursive: true })
  fs.writeFileSync(path.join(home, "skills", "global", "review", "SKILL.md"), "# Review\n")
  fs.writeFileSync(path.join(home, "mcp.json"), JSON.stringify({ servers: { search: { command: "node", args: ["server.mjs"], env: { SEARCH_TOKEN: "never-copy-me" } } } }))
  return { home, databasePath }
}

const digest = (filePath: string): string => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")

describe("production fresh-state cutover", () => {
  it("archives the released state, seeds only allowed global setup, and atomically installs exactly the canonical schema", () => {
    const { home, databasePath } = releasedHome()
    const result = performProductionCutover({ databasePath, socratesHome: home, now: new Date("2026-07-30T21:00:00.000Z") })

    expect(result.status).toBe("cut_over")
    expect(result.seed).toEqual({ settings: 4, accessRoots: 1, knowledgeEntries: 5, capabilities: 2 })
    expect(result.archive?.manifest.files.map((file) => file.relativePath)).toEqual(expect.arrayContaining(["socrates.sqlite", "identity.md", "user_profile.md", "skills/global/review/SKILL.md", "mcp.json"]))

    const fresh = new Database(databasePath, { readonly: true })
    expect(hasCanonicalSchema(fresh)).toBe(true)
    expect(canonicalTableNames(fresh)).toEqual([...CANONICAL_PRODUCT_TABLES, "_socrates_migrations"].sort())
    expect(fresh.prepare("SELECT COUNT(*) AS count FROM tasks").get()).toEqual({ count: 0 })
    expect(fresh.prepare("SELECT value_json FROM settings WHERE key = 'access.state'").get()).toEqual({ value_json: JSON.stringify({ mode: "selected", revision: 4, updatedAt: "2026-07-30T00:00:00.000Z" }) })
    expect(fresh.prepare("SELECT kind, stable_key FROM knowledge_entries ORDER BY kind, stable_key").all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "identity", stable_key: "identity" }),
      expect.objectContaining({ kind: "profile", stable_key: "profile" }),
    ]))
    expect(fresh.prepare("SELECT name, kind FROM capabilities ORDER BY kind, name").all()).toEqual([
      { name: "search", kind: "mcp" },
      { name: "review", kind: "skill" },
    ])
    expect(fresh.prepare("SELECT config_json FROM capability_versions WHERE capability_id IN (SELECT id FROM capabilities WHERE kind = 'mcp')").get()).not.toEqual(expect.objectContaining({ config_json: expect.stringContaining("never-copy-me") }))
    fresh.close()

    const archivedDatabase = path.join(result.archive!.archivePath, "old-state", "socrates.sqlite")
    expect(digest(archivedDatabase)).not.toBe(digest(databasePath))
    const archived = new Database(archivedDatabase, { readonly: true })
    expect(archived.prepare("SELECT status FROM turns WHERE id = 'missing'").get()).toBeUndefined()
    expect(archived.prepare("SELECT mode FROM filesystem_access_settings").get()).toEqual({ mode: "selected" })
    archived.close()
  })

  it("leaves the released database intact when seed verification or a post-swap action fails", () => {
    const { home, databasePath } = releasedHome()
    const beforeSeedFailure = digest(databasePath)
    expect(() => performProductionCutover({
      databasePath,
      socratesHome: home,
      now: new Date("2026-07-30T21:01:00.000Z"),
      onStage: (stage) => { if (stage === "seeded") throw new Error("injected seed failure") },
    })).toThrow("injected seed failure")
    expect(digest(databasePath)).toBe(beforeSeedFailure)

    const beforeSwapFailure = digest(databasePath)
    expect(() => performProductionCutover({
      databasePath,
      socratesHome: home,
      now: new Date("2026-07-30T21:02:00.000Z"),
      onStage: (stage) => { if (stage === "swapped") throw new Error("injected swap failure") },
    })).toThrow("injected swap failure")
    expect(digest(databasePath)).toBe(beforeSwapFailure)
  })

  it("does not touch a database that already has the exact canonical schema", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-canonical-"))
    roots.push(home)
    const databasePath = path.join(home, "socrates.sqlite")
    const database = new Database(databasePath)
    initializeCanonicalDatabase(database, "2026-07-30T00:00:00.000Z")
    database.close()

    expect(performProductionCutover({ databasePath, socratesHome: home })).toEqual({ status: "already_canonical", seed: { settings: 0, accessRoots: 0, knowledgeEntries: 0, capabilities: 0 } })
    expect(fs.existsSync(path.join(home, "backups"))).toBe(false)
  })
})
