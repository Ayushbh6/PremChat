import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"
import { SocratesError } from "@socrates/shared"
import { hasCanonicalSchema } from "./canonicalSchema"

export { CANONICAL_SCHEMA_MARKER } from "./canonicalSchema"

export type CutoverArchiveManifest = Readonly<{
  id: string
  createdAt: string
  sourceDatabasePath: string
  sourceSchemaVersion: string
  integrity: "verified"
  files: readonly Readonly<{ relativePath: string; sizeBytes: number; sha256: string }>[]
  totalSizeBytes: number
  manifestSha256: string
}>

export type CutoverArchiveRecord = Readonly<{
  id: string
  archivePath: string
  manifest: CutoverArchiveManifest
}>

const tableExists = (db: Database.Database, table: string): boolean => Boolean(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
).get(table))

const scalarCount = (db: Database.Database, sql: string): number => {
  try {
    const row = db.prepare(sql).get() as { count?: number } | undefined
    return Number(row?.count ?? 0)
  } catch {
    return 0
  }
}

export const databaseNeedsProductionCutover = (databasePath: string): boolean => {
  if (databasePath === ":memory:" || !fs.existsSync(databasePath)) return false
  const db = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    return !hasCanonicalSchema(db)
  } finally {
    db.close()
  }
}

export const assertCutoverIdle = (db: Database.Database): void => {
  const activeWork = ([
    ["tasks", "SELECT COUNT(*) AS count FROM tasks WHERE status IN ('queued','routing','running','waiting','suspended')"],
    ["v2_turns", "SELECT COUNT(*) AS count FROM v2_turns WHERE status IN ('queued','routing','running','waiting','suspended')"],
    ["turns", "SELECT COUNT(*) AS count FROM turns WHERE status IN ('queued','routing','running','waiting','suspended')"],
  ] as const).some(([table, sql]) => tableExists(db, table) && scalarCount(db, sql) > 0)
  const activeTerminal = ([
    ["terminal_sessions", "SELECT COUNT(*) AS count FROM terminal_sessions WHERE status IN ('starting','running','awaiting_input','detached')"],
    ["v2_terminal_sessions", "SELECT COUNT(*) AS count FROM v2_terminal_sessions WHERE status IN ('starting','running','awaiting_input','detached')"],
  ] as const).some(([table, sql]) => tableExists(db, table) && scalarCount(db, sql) > 0)
  if (activeWork || activeTerminal) {
    throw new SocratesError(
      "cutover_runtime_active",
      "Finish or stop active Socrates work and Terminals before the production cutover.",
      { recoverable: true, details: { activeWork, activeTerminal } },
    )
  }
}

export const createVerifiedCutoverArchive = (input: {
  databasePath: string
  socratesHome: string
  now?: Date
}): CutoverArchiveRecord => {
  const databasePath = path.resolve(input.databasePath)
  const socratesHome = path.resolve(input.socratesHome)
  if (!databasePath.startsWith(`${socratesHome}${path.sep}`) && databasePath !== path.join(socratesHome, "socrates.sqlite")) {
    throw new SocratesError("cutover_database_scope_invalid", "The Socrates database must be inside the selected Socrates home.")
  }
  const now = input.now ?? new Date()
  const stamp = now.toISOString().replace(/[:.]/g, "-")
  const id = `cutover-${stamp}`
  const backupsRoot = path.join(socratesHome, "backups")
  const finalRoot = path.join(backupsRoot, id)
  const stagedRoot = `${finalRoot}.staging`
  const oldStateRoot = path.join(stagedRoot, "old-state")
  const lockPath = path.join(backupsRoot, ".cutover.lock")
  fs.mkdirSync(backupsRoot, { recursive: true, mode: 0o700 })
  fs.chmodSync(backupsRoot, 0o700)
  if (fs.existsSync(finalRoot)) return readVerifiedCutoverArchive(finalRoot)

  let lock: number | undefined
  try {
    lock = fs.openSync(lockPath, "wx", 0o600)
    const db = new Database(databasePath)
    let sourceSchemaVersion = "released-unknown"
    try {
      assertCutoverIdle(db)
      db.pragma("wal_checkpoint(TRUNCATE)")
      const integrity = db.pragma("integrity_check") as Array<{ integrity_check: string }>
      if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
        throw new SocratesError("cutover_integrity_failed", "The released Socrates database did not pass SQLite integrity verification.")
      }
      if (tableExists(db, "schema_migrations")) {
        const row = db.prepare("SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1").get() as { version?: number; name?: string } | undefined
        if (row) sourceSchemaVersion = `${row.version ?? "unknown"}:${row.name ?? "unknown"}`
      }
    } finally {
      db.close()
    }

    fs.rmSync(stagedRoot, { recursive: true, force: true })
    fs.mkdirSync(oldStateRoot, { recursive: true, mode: 0o700 })
    copyReleasedState(socratesHome, oldStateRoot)
    const files = inventoryFiles(oldStateRoot)
    const manifestBase = {
      id,
      createdAt: now.toISOString(),
      sourceDatabasePath: databasePath,
      sourceSchemaVersion,
      integrity: "verified" as const,
      files,
      totalSizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    }
    const manifestSha256 = sha256(Buffer.from(stableJson(manifestBase)))
    const manifest: CutoverArchiveManifest = { ...manifestBase, manifestSha256 }
    fs.writeFileSync(path.join(stagedRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
    verifyManifest(stagedRoot, manifest)
    fs.renameSync(stagedRoot, finalRoot)
    chmodArchive(finalRoot)
    return { id, archivePath: finalRoot, manifest }
  } catch (error) {
    fs.rmSync(stagedRoot, { recursive: true, force: true })
    throw error
  } finally {
    if (lock !== undefined) fs.closeSync(lock)
    fs.rmSync(lockPath, { force: true })
  }
}

export const listVerifiedCutoverArchives = (socratesHome: string): CutoverArchiveRecord[] => {
  const root = path.join(path.resolve(socratesHome), "backups")
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("cutover-") && !entry.name.endsWith(".staging"))
    .map((entry) => readVerifiedCutoverArchive(path.join(root, entry.name)))
    .sort((left, right) => right.manifest.createdAt.localeCompare(left.manifest.createdAt))
}

export const readVerifiedCutoverArchive = (archivePath: string): CutoverArchiveRecord => {
  const manifestPath = path.join(archivePath, "manifest.json")
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as CutoverArchiveManifest
  verifyManifest(archivePath, manifest)
  return { id: manifest.id, archivePath, manifest }
}

const copyReleasedState = (socratesHome: string, destination: string): void => {
  for (const entry of fs.readdirSync(socratesHome, { withFileTypes: true })) {
    if (entry.name === "backups") continue
    const source = path.join(socratesHome, entry.name)
    const target = path.join(destination, entry.name)
    fs.cpSync(source, target, { recursive: true, dereference: false, preserveTimestamps: true })
  }
}

const inventoryFiles = (root: string): Array<{ relativePath: string; sizeBytes: number; sha256: string }> => {
  const files: Array<{ relativePath: string; sizeBytes: number; sha256: string }> = []
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) {
        const relativePath = path.relative(root, absolute).split(path.sep).join("/")
        const data = fs.readFileSync(absolute)
        files.push({ relativePath, sizeBytes: data.byteLength, sha256: sha256(data) })
      }
    }
  }
  visit(root)
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

const verifyManifest = (archiveRoot: string, manifest: CutoverArchiveManifest): void => {
  const { manifestSha256, ...base } = manifest
  if (sha256(Buffer.from(stableJson(base))) !== manifestSha256) {
    throw new SocratesError("cutover_manifest_checksum_mismatch", "The cutover archive manifest checksum does not match.")
  }
  const oldStateRoot = path.join(archiveRoot, "old-state")
  const actual = inventoryFiles(oldStateRoot)
  if (stableJson(actual) !== stableJson(manifest.files)) {
    throw new SocratesError("cutover_archive_checksum_mismatch", "The staged old-state archive did not verify byte-for-byte.")
  }
}

const chmodArchive = (root: string): void => {
  fs.chmodSync(root, 0o700)
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        fs.chmodSync(absolute, 0o700)
        visit(absolute)
      } else if (entry.isFile()) fs.chmodSync(absolute, 0o600)
    }
  }
  visit(root)
}

const stableJson = (value: unknown): string => JSON.stringify(value)
const sha256 = (value: Buffer): string => crypto.createHash("sha256").update(value).digest("hex")
