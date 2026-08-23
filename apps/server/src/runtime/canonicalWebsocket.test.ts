import { EventEmitter } from "node:events"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"
import type { SocratesAgent } from "@socrates/core"
import type { RuntimeConfig } from "@socrates/contracts"
import { initializeCanonicalDatabase } from "../db/canonicalSchema"
import { CanonicalSocratesStore } from "../services/canonical/canonicalSocratesStore"
import { CanonicalSocratesRuntime } from "./canonicalWebsocket"

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })))

const runtimeConfig: RuntimeConfig = {
  providerId: "openrouter",
  modelId: "deepseek/deepseek-v4-pro",
  authMode: "api_key",
  thinkingEnabled: false,
  approvalMode: "manual",
  sandboxMode: "workspace_write",
}

class Socket extends EventEmitter {
  readyState = 1
  readonly messages: unknown[] = []
  send(value: string): void { this.messages.push(JSON.parse(value)) }
}

const waitFor = async (predicate: () => boolean): Promise<void> => {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for canonical runtime.")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe("CanonicalSocratesRuntime", () => {
  it("streams one global task through the same-Socrates goal decision and canonical final commit", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-canonical-ws-"))
    roots.push(root)
    const database = new Database(path.join(root, "socrates.sqlite"))
    initializeCanonicalDatabase(database)
    const store = new CanonicalSocratesStore(database)
    const agent = {
      async resolveGoal() {
        return {
          decision: { decision: "new" as const, title: "Canonical work" },
          source: "model" as const,
          attempt: { providerId: "openrouter" as const, modelId: runtimeConfig.modelId, status: "completed" as const, startedAt: "2026-07-30T00:00:00.000Z", completedAt: "2026-07-30T00:00:01.000Z", durationMs: 1, usages: [] },
        }
      },
      async *streamTurn() {
        yield { type: "agent.final_result", result: { finalAnswer: "Completed canonically.", goalFinalization: { state: "completed", note: "Finished." } } }
      },
    } as unknown as SocratesAgent
    const runtime = new CanonicalSocratesRuntime({ store, agent, socratesHome: root })
    const socket = new Socket()
    runtime.subscribe(socket as never)
    await runtime.dispatch(socket as never, { type: "socrates.global.task.send", payload: { content: "Do the work", runtimeConfig } })
    await waitFor(() => store.getSnapshot().activeTask === undefined)

    const [goal] = store.listGoals()
    expect(goal).toMatchObject({ title: "Canonical work" })
    expect(store.listGoalExchanges(goal!.id)[0]).toMatchObject({ assistantMessage: { content: "Completed canonically." } })
    expect(fs.existsSync(path.join(root, "work"))).toBe(true)
    expect(socket.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "socrates.global.connection.ready" }),
      expect.objectContaining({ type: "socrates.global.snapshot" }),
      expect.objectContaining({ type: "socrates.global.event", payload: expect.objectContaining({ type: "task.activity" }) }),
    ]))
    await runtime.shutdown()
    database.close()
  })

  it("persists an approval, pauses the same task, and resumes without a shadow turn", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-canonical-approval-"))
    roots.push(root)
    const database = new Database(path.join(root, "socrates.sqlite"))
    initializeCanonicalDatabase(database)
    const store = new CanonicalSocratesStore(database)
    const agent = {
      async resolveGoal() {
        return {
          decision: { decision: "new" as const, title: "Approval work" }, source: "model" as const,
          attempt: { providerId: "openrouter" as const, modelId: runtimeConfig.modelId, status: "completed" as const, startedAt: "2026-07-30T00:00:00.000Z", completedAt: "2026-07-30T00:00:01.000Z", durationMs: 1, usages: [] },
        }
      },
      async *streamTurn(input: { requestApproval?: (request: { approvalId: string; toolCallId: string; toolName: "edit"; actionKind: "file_write"; title: string; actionPreview: string; risk: "medium" }) => Promise<{ decision: "approved" | "rejected" }> }) {
        const request = { approvalId: "approval_1", toolCallId: "tool_1", toolName: "edit" as const, actionKind: "file_write" as const, title: "Approve edit", actionPreview: "Edit README", risk: "medium" as const }
        yield { type: "approval.requested", request }
        const decision = await input.requestApproval!(request)
        expect(decision).toEqual({ decision: "approved" })
        yield { type: "agent.final_result", result: { finalAnswer: "Approved and completed.", goalFinalization: { state: "completed", note: "Finished." } } }
      },
    } as unknown as SocratesAgent
    const runtime = new CanonicalSocratesRuntime({ store, agent, socratesHome: root })
    const socket = new Socket()
    runtime.subscribe(socket as never)
    await runtime.dispatch(socket as never, { type: "socrates.global.task.send", payload: { content: "Edit this", runtimeConfig } })
    await waitFor(() => store.getSnapshot().pendingInteractions.length === 1)
    const [interaction] = store.getSnapshot().pendingInteractions
    expect(store.getSnapshot().activeTask).toMatchObject({ status: "awaiting_input" })
    await runtime.dispatch(socket as never, {
      type: "socrates.global.interaction.resolve",
      payload: { interactionId: interaction!.id, input: { decision: "approved" } },
    })
    await waitFor(() => store.getSnapshot().activeTask === undefined)
    expect(database.prepare("SELECT kind, status FROM interaction_requests WHERE id = ?").get(interaction!.id)).toEqual({ kind: "approval", status: "approved" })
    expect(store.listGoalExchanges(store.listGoals()[0]!.id)[0]).toMatchObject({ assistantMessage: { content: "Approved and completed." } })
    await runtime.shutdown()
    database.close()
  })
})
