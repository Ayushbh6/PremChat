import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"
import {
  assertCutoverIdle,
  createVerifiedCutoverArchive,
  databaseNeedsProductionCutover,
  listVerifiedCutoverArchives,
} from "./cutoverArchive"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const releasedHome = () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-cutover-"))
  roots.push(home)
  const databasePath = path.join(home, "socrates.sqlite")
  const db = new Database(databasePath)
  db.exec(`
    CREATE TABLE schema_migrations (version INTEGER, name TEXT);
    INSERT INTO schema_migrations VALUES (34, 'released');
    CREATE TABLE turns (id TEXT PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE terminal_sessions (id TEXT PRIMARY KEY, status TEXT NOT NULL);
  `)
  db.close()
  fs.mkdirSync(path.join(home, "skills", "global", "example"), { recursive: true })
  fs.writeFileSync(path.join(home, "skills", "global", "example", "SKILL.md"), "# exact legacy skill\n")
  fs.writeFileSync(path.join(home, "identity.md"), "# exact identity\n")
  fs.mkdirSync(path.join(home, "secrets"), { recursive: true })
  fs.writeFileSync(path.join(home, "secrets", "dev.env"), "SECRET=not-for-manifest\n", { mode: 0o600 })
  return { home, databasePath }
}

describe("production cutover archive", () => {
  it("refuses active foreground or Terminal state", () => {
    const { databasePath } = releasedHome()
    const db = new Database(databasePath)
    db.prepare("INSERT INTO turns VALUES (?, ?)").run("turn_active", "running")
    expect(() => assertCutoverIdle(db)).toThrowError(/Finish or stop active Socrates work/)
    db.prepare("DELETE FROM turns").run()
    db.prepare("INSERT INTO terminal_sessions VALUES (?, ?)").run("terminal_active", "detached")
    expect(() => assertCutoverIdle(db)).toThrowError(/Finish or stop active Socrates work/)
    db.close()
  })

  it("creates a permission-restricted byte-verified whole-state archive", () => {
    const { home, databasePath } = releasedHome()
    expect(databaseNeedsProductionCutover(databasePath)).toBe(true)
    const archived = createVerifiedCutoverArchive({ databasePath, socratesHome: home, now: new Date("2026-07-30T20:00:00.000Z") })
    expect(archived.manifest.integrity).toBe("verified")
    expect(archived.manifest.sourceSchemaVersion).toBe("34:released")
    expect(archived.manifest.files.map((file) => file.relativePath)).toEqual(expect.arrayContaining([
      "identity.md",
      "secrets/dev.env",
      "skills/global/example/SKILL.md",
      "socrates.sqlite",
    ]))
    const manifestText = fs.readFileSync(path.join(archived.archivePath, "manifest.json"), "utf8")
    expect(manifestText).not.toContain("not-for-manifest")
    expect(fs.statSync(archived.archivePath).mode & 0o777).toBe(0o700)
    expect(fs.statSync(path.join(archived.archivePath, "old-state", "secrets", "dev.env")).mode & 0o777).toBe(0o600)
    expect(listVerifiedCutoverArchives(home)).toHaveLength(1)
  })

  it("is idempotent for an already staged timestamp", () => {
    const { home, databasePath } = releasedHome()
    const now = new Date("2026-07-30T20:30:00.000Z")
    const first = createVerifiedCutoverArchive({ databasePath, socratesHome: home, now })
    const second = createVerifiedCutoverArchive({ databasePath, socratesHome: home, now })
    expect(second.archivePath).toBe(first.archivePath)
    expect(second.manifest.manifestSha256).toBe(first.manifest.manifestSha256)
  })
})
