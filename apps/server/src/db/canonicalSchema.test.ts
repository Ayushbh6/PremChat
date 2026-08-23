import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"
import { CANONICAL_MIGRATION_TABLE, CANONICAL_PRODUCT_TABLES, canonicalTableNames, initializeCanonicalDatabase } from "./canonicalSchema"

describe("canonical global Socrates schema", () => {
  it("creates only the 26 product tables and migration metadata", () => {
    const database = new Database(":memory:")
    initializeCanonicalDatabase(database, "2026-07-30T00:00:00.000Z")
    expect(canonicalTableNames(database)).toEqual([...CANONICAL_PRODUCT_TABLES, CANONICAL_MIGRATION_TABLE].sort())
    expect(database.prepare("SELECT * FROM app_state").get()).toMatchObject({ id: "global", revision: 1, recovery_sequence: 0 })
    database.close()
  })

  it("has no project, workspace, conversation, session, Flow, or V2 table family", () => {
    const database = new Database(":memory:")
    initializeCanonicalDatabase(database)
    expect(canonicalTableNames(database).filter((name) => /project|workspace|conversation|session$|flow|v2/i.test(name))).toEqual([])
    database.close()
  })
})
