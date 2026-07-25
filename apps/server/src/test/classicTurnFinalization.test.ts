import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { nowIso } from "@socrates/shared"
import { openDatabase, runMigrations, type DatabaseHandle } from "../db/client"
import { SocratesStore } from "../services/store"

const handles: DatabaseHandle[] = []
const roots: string[] = []

afterEach(async () => {
  for (const handle of handles.splice(0)) handle.close()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("Classic final-answer commit", () => {
  it("rolls back the assistant answer when goal finalization fails", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-classic-finalization-"))
    roots.push(root)
    const handle = openDatabase(path.join(root, "socrates.sqlite"))
    handles.push(handle)
    runMigrations(handle)
    const now = nowIso()
    handle.sqlite.prepare(
      "INSERT INTO users (id, display_name, onboarding_completed, created_at, updated_at) VALUES ('user_atomic', 'Atomic User', 1, ?, ?)",
    ).run(now, now)
    handle.sqlite.prepare(
      "INSERT INTO projects (id, user_id, name, status, created_at, updated_at) VALUES ('proj_atomic', 'user_atomic', 'Atomic project', 'active', ?, ?)",
    ).run(now, now)
    handle.sqlite.prepare(
      "INSERT INTO conversations (id, project_id, user_id, title, status, created_at, updated_at) VALUES ('conv_atomic', 'proj_atomic', 'user_atomic', 'Atomic chat', 'active', ?, ?)",
    ).run(now, now)
    handle.sqlite.prepare(
      "INSERT INTO sessions (id, project_id, conversation_id, status, created_at, updated_at) VALUES ('sess_atomic', 'proj_atomic', 'conv_atomic', 'active', ?, ?)",
    ).run(now, now)
    handle.sqlite.prepare(
      "INSERT INTO turns (id, session_id, conversation_id, status, started_at) VALUES ('turn_atomic', 'sess_atomic', 'conv_atomic', 'running', ?)",
    ).run(now)
    const store = new SocratesStore(handle, undefined, undefined, { socratesHome: path.join(root, "home") })

    expect(() => store.completeAgentTurnAtomically({
      conversationId: "conv_atomic",
      sessionId: "sess_atomic",
      turnId: "turn_atomic",
      content: "Validated answer",
      afterPersist: () => {
        throw new Error("forced goal finalization failure")
      },
    })).toThrow("forced goal finalization failure")

    const turn = handle.sqlite.prepare("SELECT status, assistant_message_id AS assistantMessageId FROM turns WHERE id = 'turn_atomic'").get() as {
      status: string
      assistantMessageId: string | null
    }
    const assistantCount = handle.sqlite.prepare("SELECT COUNT(*) AS count FROM messages WHERE turn_id = 'turn_atomic' AND role = 'assistant'").get() as { count: number }
    expect(turn).toEqual({ status: "running", assistantMessageId: null })
    expect(assistantCount.count).toBe(0)
  })
})
