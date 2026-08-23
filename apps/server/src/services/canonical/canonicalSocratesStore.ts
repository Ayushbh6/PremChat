import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type Database from "better-sqlite3"
import type { FilesystemAuthorizationSnapshot } from "@socrates/contracts"
import { createId, nowIso, SocratesError } from "@socrates/shared"
import { hasCanonicalSchema } from "../../db/canonicalSchema"

type Json = Record<string, unknown> | readonly unknown[] | string | number | boolean | null
type GoalStatus = "active" | "completed" | "pinned" | "archived"
type TaskStatus = "routing" | "running" | "awaiting_input" | "completed" | "failed" | "cancelled" | "recovering"
type InteractionKind = "approval" | "credential" | "clarification" | "frontier_approval" | "proposal_acceptance"

export type CanonicalResourceBindingInput = Readonly<{
  ownerKind: "goal" | "task"
  ownerId: string
  requestedPath: string
  label?: string
  confirmedBy: "explicit_path" | "user_confirmation" | "relink_confirmation"
}>

export type CanonicalTask = Readonly<{
  id: string
  ordinal: number
  goalId?: string
  status: TaskStatus
  requestMessageId: string
  finalMessageId?: string
  accessSnapshotId: string
  createdAt: string
  updatedAt: string
}>

/**
 * Execution data is resolved once from the task's immutable access snapshot
 * and exact task resource bindings. Access roots are deliberately absent from
 * `resources`: they grant write autonomy only and never become a project or
 * inferred working context.
 */
export type CanonicalTaskExecutionScope = Readonly<{
  task: CanonicalTask
  filesystemAuthorization: FilesystemAuthorizationSnapshot
  resources: readonly CanonicalResource[]
}>

export type CanonicalTerminalSession = Readonly<{
  id: string
  taskId: string
  name: string
  command: string
  cwd: string
  status: "starting" | "running" | "exited" | "stopped" | "missing" | "awaiting_input"
  processId?: string
  containment: Json
  metadata: Json
  createdAt: string
  updatedAt: string
  completedAt?: string
}>

/**
 * The sole persistence owner for fresh global Socrates state. It talks only to
 * the 26-table database, persists whole exact messages, and never reads the
 * released archive, project tables, conversations, or Flow rows.
 */
export class CanonicalSocratesStore {
  constructor(private readonly database: Database.Database) {
    if (!hasCanonicalSchema(database)) {
      throw new SocratesError("canonical_schema_required", "Global Socrates requires the verified canonical database schema.")
    }
  }

  recoverInterruptedTasks(): CanonicalTask[] {
    return this.database.transaction(() => {
      const rows = this.database.prepare("SELECT * FROM tasks WHERE status IN ('routing', 'running', 'awaiting_input') ORDER BY ordinal").all() as CanonicalTaskRow[]
      const timestamp = nowIso()
      for (const task of rows) {
        this.database.prepare("UPDATE tasks SET status = 'recovering', updated_at = ? WHERE id = ?").run(timestamp, task.id)
        this.appendEvent(task.id, task.goal_id ?? undefined, "task.recovery_required", "system", { previousStatus: task.status })
      }
      if (rows.length) this.database.prepare("UPDATE app_state SET recovery_sequence = recovery_sequence + 1, updated_at = ? WHERE id = 'global'").run(timestamp)
      return rows.map((task) => this.asTask(this.requireTask(task.id)))
    })()
  }

  recordSafeActivity(input: { taskId: string; phase: "routing" | "working" | "tool" | "waiting" | "finalizing" | "failed"; sentence: string }): CanonicalEvent {
    const task = this.requireTask(input.taskId)
    const sentence = input.sentence.trim()
    if (!sentence) throw new SocratesError("activity_sentence_required", "A visible activity sentence cannot be empty.")
    const sequence = this.appendEvent(task.id, task.goal_id ?? undefined, "task.activity", "main_agent", { phase: input.phase, sentence })
    return this.listEvents(sequence - 1, 1)[0]!
  }

  createRootTask(input: { content: string; access: { mode: "read_only" | "selected" | "full"; revision: number; roots: readonly { id: string; label: string; path: string }[]; workingDirectory?: string } }): CanonicalTask {
    const content = input.content.trim()
    if (!content) throw new SocratesError("message_content_required", "A Socrates request cannot be empty.", { recoverable: true })
    const createdAt = nowIso()
    const taskId = createId("task")
    const requestMessageId = createId("msg")
    const accessSnapshotId = createId("access")
    return this.database.transaction(() => {
      const ordinal = this.nextOrdinal("tasks")
      this.database.prepare(
        `INSERT INTO access_snapshots (id, task_id, mode, revision, roots_json, working_directory, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(accessSnapshotId, taskId, input.access.mode, input.access.revision, json(input.access.roots), input.access.workingDirectory ?? null, createdAt)
      this.database.prepare(
        `INSERT INTO tasks (id, ordinal, goal_id, parent_task_id, access_snapshot_id, status, request_message_id, created_at, updated_at)
         VALUES (?, ?, NULL, NULL, ?, 'routing', ?, ?, ?)`,
      ).run(taskId, ordinal, accessSnapshotId, requestMessageId, createdAt, createdAt)
      this.database.prepare(
        `INSERT INTO messages (id, task_id, ordinal, role, content, content_format, attachments_json, created_at)
         VALUES (?, ?, 1, 'user', ?, 'markdown', '[]', ?)`,
      ).run(requestMessageId, taskId, content, createdAt)
      this.database.prepare("UPDATE app_state SET active_root_task_id = ?, revision = revision + 1, updated_at = ? WHERE id = 'global'")
        .run(taskId, createdAt)
      this.appendEvent(taskId, undefined, "task.created", "user", { requestMessageId, ordinal })
      return { id: taskId, ordinal, status: "routing" as const, requestMessageId, accessSnapshotId, createdAt, updatedAt: createdAt }
    })()
  }

  /** Reads only the durable access authority used to create the next task's
   * immutable snapshot. Resource bindings and selected roots intentionally
   * remain separate concepts. */
  accessForNextTask(workingDirectory?: string): {
    mode: "read_only" | "selected" | "full"
    revision: number
    roots: Array<{ id: string; label: string; path: string }>
    workingDirectory?: string
  } {
    const saved = this.database.prepare("SELECT value_json FROM settings WHERE key = 'access.state' LIMIT 1").get() as { value_json?: string } | undefined
    const parsed = saved?.value_json ? parseJson(saved.value_json, {}) : {}
    const state = isRecord(parsed) ? parsed : {}
    const mode = state.mode === "read_only" || state.mode === "full" || state.mode === "selected" ? state.mode : "selected"
    const revision = typeof state.revision === "number" && Number.isInteger(state.revision) && state.revision > 0 ? state.revision : 1
    const roots = (this.database.prepare(
      "SELECT id, label, canonical_path FROM access_roots WHERE status = 'active' ORDER BY is_default DESC, created_at ASC",
    ).all() as Array<{ id: string; label: string; canonical_path: string }>).map((root) => ({ id: root.id, label: root.label, path: root.canonical_path }))
    return { mode, revision, roots, ...(workingDirectory ? { workingDirectory } : {}) }
  }

  bindTaskToGoal(input: { taskId: string; decision: "current" | "existing" | "new"; goalId?: string; title?: string; objective?: string }): { task: CanonicalTask; goalId: string } {
    return this.database.transaction(() => {
      const task = this.requireTask(input.taskId)
      if (task.goal_id) throw new SocratesError("task_goal_already_resolved", "This task is already bound to a goal.", { recoverable: true })
      let goalId: string
      if (input.decision === "new") {
        const title = input.title?.trim()
        if (!title) throw new SocratesError("goal_title_required", "A new goal needs the title chosen by the main Socrates decision.")
        goalId = createId("goal")
        const createdAt = nowIso()
        const goalOrdinal = this.nextOrdinal("goals")
        this.database.prepare(
          `INSERT INTO goals (id, ordinal, title, status, latest_capsule_version, created_at, updated_at)
           VALUES (?, ?, ?, 'active', 1, ?, ?)`,
        ).run(goalId, goalOrdinal, title, createdAt, createdAt)
        this.insertCapsule({
          goalId,
          version: 1,
          objective: input.objective?.trim() || this.requireMessage(task.request_message_id).content,
          summary: "",
          state: "active",
          sourceThroughEventSequence: this.currentSequence(),
        })
      } else {
        goalId = input.goalId ?? this.foregroundGoalId() ?? ""
        const goal = this.database.prepare("SELECT id FROM goals WHERE id = ? AND status <> 'archived'").get(goalId) as { id?: string } | undefined
        if (!goal?.id) throw new SocratesError("goal_not_found", "The selected goal is unavailable.", { recoverable: true })
      }
      const updatedAt = nowIso()
      this.database.prepare("UPDATE tasks SET goal_id = ?, status = 'running', updated_at = ? WHERE id = ?").run(goalId, updatedAt, task.id)
      this.database.prepare("UPDATE goals SET status = 'active', updated_at = ? WHERE id = ?").run(updatedAt, goalId)
      this.database.prepare("UPDATE app_state SET foreground_goal_id = ?, active_root_task_id = ?, revision = revision + 1, updated_at = ? WHERE id = 'global'")
        .run(goalId, task.id, updatedAt)
      // A task owns the exact locations it used. A goal owns the current
      // resource set for future tasks. Copy only stable binding references;
      // never infer either side from Selected paths or the active cwd.
      this.copyActiveResourceBindings({ fromKind: "goal", fromId: goalId, toKind: "task", toId: task.id, confirmedBy: "goal_binding" })
      this.copyActiveResourceBindings({ fromKind: "task", fromId: task.id, toKind: "goal", toId: goalId, confirmedBy: "task_binding" })
      this.appendEvent(task.id, goalId, "task.goal_bound", "main_agent", { decision: input.decision, goalId })
      return { task: this.asTask(this.requireTask(task.id)), goalId }
    })()
  }

  /**
   * Returns the only filesystem authority an active canonical task may use.
   * The access state is read from its persisted snapshot, not current
   * Settings, and its resource list comes only from exact task bindings.
   */
  getTaskExecutionScope(taskId: string): CanonicalTaskExecutionScope {
    const task = this.requireTask(taskId)
    const snapshot = this.database.prepare(
      "SELECT id, task_id, mode, revision, roots_json, working_directory, created_at FROM access_snapshots WHERE id = ? AND task_id = ?",
    ).get(task.access_snapshot_id, task.id) as {
      id: string
      task_id: string
      mode: "read_only" | "selected" | "full"
      revision: number
      roots_json: string
      working_directory: string | null
      created_at: string
    } | undefined
    if (!snapshot) throw new SocratesError("task_access_snapshot_missing", "The immutable filesystem access snapshot for this task is unavailable.")
    const roots = parseAuthorizedRoots(snapshot.roots_json)
    return {
      task: this.asTask(task),
      filesystemAuthorization: {
        id: snapshot.id,
        turnId: snapshot.task_id,
        mode: snapshot.mode,
        revision: snapshot.revision,
        roots,
        workingRootPath: snapshot.working_directory,
        createdAt: snapshot.created_at,
      },
      resources: this.listResources({ kind: "task", id: task.id }),
    }
  }

  finalizeTask(input: { taskId: string; answer: string; capsule?: Partial<CanonicalCapsuleInput>; modelEvidence?: Json; toolEvidence?: Json }): CanonicalTask {
    const answer = input.answer.trim()
    if (!answer) throw new SocratesError("final_answer_required", "A final answer cannot be empty.")
    return this.database.transaction(() => {
      const task = this.requireTask(input.taskId)
      if (!task.goal_id) throw new SocratesError("task_goal_required", "A task must be bound to a goal before finalization.")
      if (["completed", "failed", "cancelled"].includes(task.status)) throw new SocratesError("task_already_finalized", "This task has already finished.", { recoverable: true })
      const completedAt = nowIso()
      const finalMessageId = createId("msg")
      this.database.prepare(
        `INSERT INTO messages (id, task_id, ordinal, role, content, content_format, attachments_json, created_at, completed_at)
         VALUES (?, ?, 2, 'assistant', ?, 'markdown', '[]', ?, ?)`,
      ).run(finalMessageId, task.id, answer, completedAt, completedAt)
      if (input.modelEvidence) this.insertModelEvidence(task.id, input.modelEvidence, completedAt)
      if (input.toolEvidence) this.appendEvent(task.id, task.goal_id, "task.tool_evidence", "tool", input.toolEvidence)
      if (input.capsule) {
        const goal = this.requireGoal(task.goal_id)
        const latest = this.latestCapsule(task.goal_id)
        const version = goal.latest_capsule_version + 1
        this.insertCapsule({
          goalId: task.goal_id,
          version,
          objective: input.capsule.objective ?? latest.objective,
          summary: input.capsule.summary ?? latest.summary,
          state: input.capsule.state ?? latest.state,
          progress: input.capsule.progress ?? parseJson(latest.progress_json, []),
          constraints: input.capsule.constraints ?? parseJson(latest.constraints_json, []),
          decisions: input.capsule.decisions ?? parseJson(latest.decisions_json, []),
          openQuestions: input.capsule.openQuestions ?? parseJson(latest.open_questions_json, []),
          nextActions: input.capsule.nextActions ?? parseJson(latest.next_actions_json, []),
          resourceRefs: input.capsule.resourceRefs ?? parseJson(latest.resource_refs_json, []),
          sourceThroughEventSequence: this.currentSequence(),
        })
        this.database.prepare("UPDATE goals SET latest_capsule_version = ?, updated_at = ? WHERE id = ?").run(version, completedAt, task.goal_id)
      }
      this.database.prepare("UPDATE tasks SET status = 'completed', final_message_id = ?, updated_at = ?, completed_at = ? WHERE id = ?")
        .run(finalMessageId, completedAt, completedAt, task.id)
      this.database.prepare("UPDATE app_state SET active_root_task_id = NULL, revision = revision + 1, recovery_sequence = recovery_sequence + 1, updated_at = ? WHERE id = 'global'")
        .run(completedAt)
      this.appendEvent(task.id, task.goal_id, "task.finalized", "main_agent", { finalMessageId })
      return this.asTask(this.requireTask(task.id))
    })()
  }

  recordModelCall(input: { taskId: string; role: string; providerId: string; modelId: string; status: "completed" | "failed"; request: Json; response?: Json; usage?: Json; error?: Json; startedAt: string; completedAt: string }): string {
    this.requireTask(input.taskId)
    const id = createId("model")
    this.database.prepare(
      `INSERT INTO model_calls (id, task_id, role, provider_id, model_id, status, request_json, response_json, usage_json, error_json, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.taskId, input.role, input.providerId, input.modelId, input.status, json(input.request), input.response ? json(input.response) : null, input.usage ? json(input.usage) : null, input.error ? json(input.error) : null, input.startedAt, input.completedAt)
    this.appendEvent(input.taskId, this.requireTask(input.taskId).goal_id ?? undefined, "model.call.recorded", "main_agent", { modelCallId: id, role: input.role, status: input.status })
    return id
  }

  beginModelCall(input: { taskId: string; role: string; providerId: string; modelId: string; request: Json }): string {
    this.requireTask(input.taskId)
    const id = createId("model")
    const timestamp = nowIso()
    this.database.prepare(
      `INSERT INTO model_calls (id, task_id, role, provider_id, model_id, status, request_json, started_at)
       VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`,
    ).run(id, input.taskId, input.role, input.providerId, input.modelId, json(input.request), timestamp)
    return id
  }

  completeModelCall(input: { id: string; usage?: Json; response?: Json; error?: Json }): void {
    this.database.prepare(
      "UPDATE model_calls SET status = ?, usage_json = ?, response_json = ?, error_json = ?, completed_at = ? WHERE id = ?",
    ).run(input.error ? "failed" : "completed", input.usage ? json(input.usage) : null, input.response ? json(input.response) : null, input.error ? json(input.error) : null, nowIso(), input.id)
  }

  finishTaskWithError(input: { taskId: string; status: "failed" | "cancelled"; error: Json }): CanonicalTask {
    return this.database.transaction(() => {
      const task = this.requireTask(input.taskId)
      const timestamp = nowIso()
      this.database.prepare("UPDATE tasks SET status = ?, error_json = ?, updated_at = ?, completed_at = ? WHERE id = ?")
        .run(input.status, json(input.error), timestamp, timestamp, task.id)
      this.database.prepare(
        "UPDATE interaction_requests SET status = 'cancelled', resolved_at = ?, resolution_json = ? WHERE task_id = ? AND status = 'pending'",
      ).run(timestamp, json({ reason: "Task ended before the interaction was resolved." }), task.id)
      this.database.prepare("UPDATE app_state SET active_root_task_id = CASE WHEN active_root_task_id = ? THEN NULL ELSE active_root_task_id END, revision = revision + 1, recovery_sequence = recovery_sequence + 1, updated_at = ? WHERE id = 'global'")
        .run(task.id, timestamp)
      this.appendEvent(task.id, task.goal_id ?? undefined, `task.${input.status}`, "system", input.error)
      return this.asTask(this.requireTask(task.id))
    })()
  }

  startToolCall(input: { id: string; taskId: string; name: string; modelCallId?: string; toolInput?: Json; requiresApproval: boolean }): void {
    this.requireTask(input.taskId)
    const timestamp = nowIso()
    this.database.prepare(
      `INSERT INTO tool_calls (id, task_id, model_call_id, name, status, input_json, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(input.id, input.taskId, input.modelCallId ?? null, input.name, input.requiresApproval ? "awaiting_approval" : "running", json(input.toolInput ?? {}), timestamp)
    this.appendEvent(input.taskId, this.requireTask(input.taskId).goal_id ?? undefined, "tool.call.started", "main_agent", { toolCallId: input.id, name: input.name, requiresApproval: input.requiresApproval })
  }

  completeToolCall(input: { id: string; output: Json; evidence?: Json }): void {
    this.database.prepare("UPDATE tool_calls SET status = 'completed', output_json = ?, evidence_json = ?, completed_at = ? WHERE id = ?")
      .run(json(input.output), input.evidence ? json(input.evidence) : null, nowIso(), input.id)
  }

  failToolCall(input: { id: string; error: Json }): void {
    this.database.prepare("UPDATE tool_calls SET status = 'failed', error_json = ?, completed_at = ? WHERE id = ?").run(json(input.error), nowIso(), input.id)
  }

  bindConfirmedResource(input: CanonicalResourceBindingInput): { resourceId: string; locationId: string; bindingId: string } {
    const canonicalPath = fs.realpathSync.native(path.resolve(input.requestedPath))
    assertNotRepoLocalSocratesPath(canonicalPath)
    const stat = fs.statSync(canonicalPath)
    if (!stat.isDirectory()) throw new SocratesError("resource_root_not_directory", "A resource must be an existing directory.", { recoverable: true })
    return this.database.transaction(() => {
      this.assertBindingOwner(input.ownerKind, input.ownerId)
      const known = this.database.prepare(
        `SELECT resources.id AS resource_id, resource_locations.id AS location_id
         FROM resource_locations JOIN resources ON resources.id = resource_locations.resource_id
         WHERE resource_locations.canonical_path = ? AND resource_locations.valid_to IS NULL LIMIT 1`,
      ).get(canonicalPath) as { resource_id?: string; location_id?: string } | undefined
      const timestamp = nowIso()
      const resourceId = known?.resource_id ?? createId("resource")
      const locationId = known?.location_id ?? createId("rloc")
      if (!known) {
        this.database.prepare(
          `INSERT INTO resources (id, label, kind, availability, fingerprint_json, created_at, updated_at)
           VALUES (?, ?, 'filesystem_root', 'available', ?, ?, ?)`,
        ).run(resourceId, input.label?.trim() || path.basename(canonicalPath), json(resourceFingerprint(canonicalPath)), timestamp, timestamp)
        this.database.prepare(
          `INSERT INTO resource_locations (id, resource_id, canonical_path, status, fingerprint_json, valid_from)
           VALUES (?, ?, ?, 'available', ?, ?)`,
        ).run(locationId, resourceId, canonicalPath, json(resourceFingerprint(canonicalPath)), timestamp)
      }
      const bindingId = createId("binding")
      this.database.prepare(
        `INSERT INTO resource_bindings (id, owner_kind, owner_id, resource_id, resource_location_id, status, confirmed_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      ).run(bindingId, input.ownerKind, input.ownerId, resourceId, locationId, input.confirmedBy, timestamp)
      this.appendEvent(input.ownerKind === "task" ? input.ownerId : undefined, input.ownerKind === "goal" ? input.ownerId : undefined, "resource.bound", "user", { resourceId, locationId, bindingId, confirmedBy: input.confirmedBy })
      return { resourceId, locationId, bindingId }
    })()
  }

  relinkResource(input: { resourceId: string; requestedPath: string; confirmedBy: "relink_confirmation" }): { locationId: string } {
    const canonicalPath = fs.realpathSync.native(path.resolve(input.requestedPath))
    assertNotRepoLocalSocratesPath(canonicalPath)
    const stat = fs.statSync(canonicalPath)
    if (!stat.isDirectory()) throw new SocratesError("resource_root_not_directory", "A resource must be relinked to an existing directory.", { recoverable: true })
    return this.database.transaction(() => {
      this.requireResource(input.resourceId)
      const collision = this.database.prepare("SELECT resource_id FROM resource_locations WHERE canonical_path = ? AND valid_to IS NULL LIMIT 1").get(canonicalPath) as { resource_id?: string } | undefined
      if (collision?.resource_id && collision.resource_id !== input.resourceId) {
        throw new SocratesError("resource_relink_ambiguous", "That path is already associated with another resource. Confirm the intended resource before relinking.", { recoverable: true })
      }
      const timestamp = nowIso()
      const current = this.database.prepare("SELECT id FROM resource_locations WHERE resource_id = ? AND valid_to IS NULL LIMIT 1").get(input.resourceId) as { id?: string } | undefined
      if (current?.id) this.database.prepare("UPDATE resource_locations SET valid_to = ?, status = 'missing' WHERE id = ?").run(timestamp, current.id)
      const locationId = createId("rloc")
      this.database.prepare(
        `INSERT INTO resource_locations (id, resource_id, canonical_path, status, fingerprint_json, valid_from)
         VALUES (?, ?, ?, 'available', ?, ?)`,
      ).run(locationId, input.resourceId, canonicalPath, json(resourceFingerprint(canonicalPath)), timestamp)
      // Goal bindings are the current resource selection for future tasks;
      // task bindings retain their exact historical location unmodified.
      this.database.prepare(
        `UPDATE resource_bindings SET resource_location_id = ?, confirmed_by = ?
         WHERE resource_id = ? AND owner_kind = 'goal' AND status = 'active'`,
      ).run(locationId, input.confirmedBy, input.resourceId)
      this.database.prepare("UPDATE resources SET availability = 'available', fingerprint_json = ?, updated_at = ? WHERE id = ?")
        .run(json(resourceFingerprint(canonicalPath)), timestamp, input.resourceId)
      this.appendEvent(undefined, undefined, "resource.relinked", "user", { resourceId: input.resourceId, locationId })
      return { locationId }
    })()
  }

  reviseKnowledge(input: { scope: "global" | "resource"; resourceId?: string; kind: "identity" | "profile" | "rule" | "memory" | "repo_fact"; stableKey: string; content: Json; status: "accepted" | "pending"; provenance: Json; createdBy: "explicit_user" | "validated_fact" | "memory_agent" | "direct_edit" }): { entryId: string; versionId: string; version: number } {
    if ((input.scope === "resource") !== Boolean(input.resourceId)) throw new SocratesError("knowledge_scope_invalid", "Resource knowledge requires exactly one resource.")
    return this.database.transaction(() => {
      if (input.scope === "resource") this.requireResource(input.resourceId!)
      const existing = this.database.prepare(
        "SELECT id, active_version FROM knowledge_entries WHERE scope_kind = ? AND resource_id IS ? AND stable_key = ?",
      ).get(input.scope, input.resourceId ?? null, input.stableKey) as { id?: string; active_version?: number } | undefined
      if (input.kind === "rule" && input.status === "accepted" && !existing?.id) this.assertActiveRuleCapacity(input.scope, input.resourceId)
      const timestamp = nowIso()
      const entryId = existing?.id ?? createId("knowledge")
      const version = Number((this.database.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM knowledge_versions WHERE entry_id = ?").get(entryId) as { version: number }).version)
      if (!existing) this.database.prepare(
        `INSERT INTO knowledge_entries (id, scope_kind, resource_id, kind, stable_key, active_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
      ).run(entryId, input.scope, input.resourceId ?? null, input.kind, input.stableKey, timestamp, timestamp)
      else if (input.status === "accepted") this.database.prepare("UPDATE knowledge_versions SET status = 'superseded', resolved_at = ? WHERE entry_id = ? AND status = 'accepted'").run(timestamp, entryId)
      const versionId = createId("knowledgev")
      this.database.prepare(
        `INSERT INTO knowledge_versions (id, entry_id, version, status, content_json, provenance_json, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(versionId, entryId, version, input.status, json(input.content), json(input.provenance), input.createdBy, timestamp)
      this.database.prepare("UPDATE knowledge_entries SET active_version = ?, updated_at = ? WHERE id = ?").run(input.status === "accepted" ? version : existing?.active_version ?? null, timestamp, entryId)
      return { entryId, versionId, version }
    })()
  }

  createInteraction(input: { taskId: string; kind: InteractionKind; prompt: string; publicPayload: Json; fingerprint?: string; toolCallId?: string }): string {
    if (input.kind === "frontier_approval" && this.isFrontierRejected(input.taskId)) {
      throw new SocratesError("frontier_rejected_for_task", "Frontier handoff was rejected for this task and remains unavailable for the rest of the turn.", { recoverable: true })
    }
    const id = createId("interaction")
    const timestamp = nowIso()
    this.database.prepare(
      `INSERT INTO interaction_requests (id, task_id, tool_call_id, kind, status, fingerprint, prompt, public_payload_json, requested_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    ).run(id, input.taskId, input.toolCallId ?? null, input.kind, input.fingerprint ?? null, input.prompt, json(input.publicPayload), timestamp)
    this.appendEvent(input.taskId, this.requireTask(input.taskId).goal_id ?? undefined, "interaction.requested", "system", { id, kind: input.kind })
    return id
  }

  /** Queue an evidence-linked lead for the asynchronous Global Memory Agent.
   * Main Socrates cannot write durable knowledge directly. */
  createMemoryNote(input: { taskId: string; note: string; importance: "normal" | "high" }): { noteNumber: number; status: "open"; attachedSource: "current_user_message"; result: "created" | "already_recorded" } {
    const note = input.note.trim()
    if (!note) throw new SocratesError("memory_note_required", "A memory note cannot be empty.", { recoverable: true })
    return this.database.transaction(() => {
      const task = this.requireTask(input.taskId)
      const previous = this.database.prepare(
        "SELECT id FROM memory_notes WHERE task_id = ? AND lower(trim(content)) = lower(trim(?)) ORDER BY created_at LIMIT 1",
      ).get(task.id, note) as { id?: string } | undefined
      const count = Number((this.database.prepare("SELECT COUNT(*) AS count FROM memory_notes WHERE task_id = ?").get(task.id) as { count: number }).count)
      if (previous?.id) {
        return { noteNumber: count, status: "open" as const, attachedSource: "current_user_message" as const, result: "already_recorded" as const }
      }
      if (count >= 2) throw new SocratesError("memory_note_limit_reached", "At most two distinct memory notes may be created for one task.", { recoverable: true })
      const timestamp = nowIso()
      const noteId = createId("memnote")
      this.database.prepare(
        `INSERT INTO memory_notes (id, task_id, content, importance, evidence_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?)`,
      ).run(noteId, task.id, note, input.importance, json({ requestMessageId: task.request_message_id, ...(task.goal_id ? { goalId: task.goal_id } : {}) }), timestamp)
      this.database.prepare(
        `INSERT INTO background_jobs (id, kind, task_id, status, payload_json, attempts, available_at, created_at, updated_at)
         VALUES (?, 'global_memory', ?, 'queued', ?, 0, ?, ?, ?)`,
      ).run(createId("tjob"), task.id, json({ memoryNoteId: noteId }), timestamp, timestamp, timestamp)
      this.appendEvent(task.id, task.goal_id ?? undefined, "memory.note.queued", "main_agent", { memoryNoteId: noteId, importance: input.importance })
      return { noteNumber: count + 1, status: "open" as const, attachedSource: "current_user_message" as const, result: "created" as const }
    })()
  }

  createTerminalSession(input: { taskId: string; name: string; command: string; cwd: string; containment: Json; metadata?: Json }): CanonicalTerminalSession {
    const name = input.name.trim()
    const command = input.command.trim()
    const cwd = input.cwd.trim()
    if (!name || !command || !cwd) throw new SocratesError("terminal_session_invalid", "A Terminal needs a name, command, and working directory.", { recoverable: true })
    return this.database.transaction(() => {
      const task = this.requireTask(input.taskId)
      if (["completed", "failed", "cancelled"].includes(task.status)) throw new SocratesError("terminal_task_finished", "Terminal cannot start for a finished task.", { recoverable: true })
      const active = this.database.prepare(
        "SELECT 1 FROM terminal_sessions WHERE task_id = ? AND name = ? AND status IN ('starting', 'running', 'awaiting_input')",
      ).get(task.id, name)
      if (active) throw new SocratesError("terminal_name_in_use", "A running Terminal already uses that name in this task.", { recoverable: true })
      const id = createId("term")
      const timestamp = nowIso()
      this.database.prepare(
        `INSERT INTO terminal_sessions (id, task_id, name, command, cwd, status, containment_json, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'starting', ?, ?, ?, ?)`,
      ).run(id, task.id, name, command, cwd, json(input.containment), json(input.metadata ?? {}), timestamp, timestamp)
      this.appendEvent(task.id, task.goal_id ?? undefined, "terminal.created", "terminal", { terminalId: id, name, cwd })
      return this.requireTerminalSession(id)
    })()
  }

  updateTerminalSession(input: { id: string; status: CanonicalTerminalSession["status"]; processId?: string; metadata?: Json; completed?: boolean }): CanonicalTerminalSession {
    return this.database.transaction(() => {
      const current = this.requireTerminalSession(input.id)
      const timestamp = nowIso()
      const metadata = input.metadata === undefined ? current.metadata : input.metadata
      this.database.prepare(
        `UPDATE terminal_sessions
         SET status = ?, process_id = ?, metadata_json = ?, updated_at = ?, completed_at = ?
         WHERE id = ?`,
      ).run(input.status, input.processId ?? current.processId ?? null, json(metadata), timestamp, input.completed ? timestamp : current.completedAt ?? null, current.id)
      const updated = this.requireTerminalSession(current.id)
      this.appendEvent(updated.taskId, this.requireTask(updated.taskId).goal_id ?? undefined, "terminal.updated", "terminal", { terminalId: updated.id, status: updated.status })
      return updated
    })()
  }

  appendTerminalOutput(input: { terminalSessionId: string; stream: "stdout" | "stderr" | "pty" | "input"; content: string; redacted?: boolean }): number {
    if (!input.content) return this.nextTerminalOutputSequence(input.terminalSessionId)
    return this.database.transaction(() => {
      const session = this.requireTerminalSession(input.terminalSessionId)
      const sequence = this.nextTerminalOutputSequence(session.id)
      this.database.prepare(
        `INSERT INTO terminal_output_chunks (id, terminal_session_id, sequence, stream, content, redacted, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(createId("tout"), session.id, sequence, input.stream, input.content, input.redacted ? 1 : 0, nowIso())
      this.appendEvent(session.taskId, this.requireTask(session.taskId).goal_id ?? undefined, "terminal.output", "terminal", { terminalId: session.id, sequence, stream: input.stream, redacted: Boolean(input.redacted) })
      return sequence
    })()
  }

  findTerminalSession(taskId: string, name: string): CanonicalTerminalSession | undefined {
    const row = this.database.prepare("SELECT * FROM terminal_sessions WHERE task_id = ? AND name = ? ORDER BY created_at DESC LIMIT 1").get(taskId, name) as TerminalSessionRow | undefined
    return row ? mapTerminalSession(row) : undefined
  }

  listActiveTerminalSessions(): CanonicalTerminalSession[] {
    return (this.database.prepare("SELECT * FROM terminal_sessions WHERE status IN ('starting', 'running', 'awaiting_input') ORDER BY created_at").all() as TerminalSessionRow[]).map(mapTerminalSession)
  }

  listTerminalSessions(taskId: string): CanonicalTerminalSession[] {
    this.requireTask(taskId)
    return (this.database.prepare("SELECT * FROM terminal_sessions WHERE task_id = ? ORDER BY created_at DESC").all(taskId) as TerminalSessionRow[]).map(mapTerminalSession)
  }

  listTerminalOutput(sessionId: string, afterSequence = 0): Array<{ sequence: number; stream: string; content: string; redacted: boolean; createdAt: string }> {
    this.requireTerminalSession(sessionId)
    return (this.database.prepare(
      "SELECT sequence, stream, content, redacted, created_at FROM terminal_output_chunks WHERE terminal_session_id = ? AND sequence > ? ORDER BY sequence",
    ).all(sessionId, afterSequence) as Array<{ sequence: number; stream: string; content: string; redacted: number; created_at: string }>).map((row) => ({
      sequence: row.sequence, stream: row.stream, content: row.content, redacted: Boolean(row.redacted), createdAt: row.created_at,
    }))
  }

  markTaskAwaitingInput(taskId: string): void {
    this.database.transaction(() => {
      const task = this.requireTask(taskId)
      if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") return
      const timestamp = nowIso()
      this.database.prepare("UPDATE tasks SET status = 'awaiting_input', updated_at = ? WHERE id = ?").run(timestamp, taskId)
      this.appendEvent(taskId, task.goal_id ?? undefined, "task.awaiting_input", "system", {})
    })()
  }

  resumeTaskAfterInteraction(taskId: string): void {
    this.database.transaction(() => {
      const task = this.requireTask(taskId)
      if (task.status !== "awaiting_input") return
      const timestamp = nowIso()
      this.database.prepare("UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ?").run(timestamp, taskId)
      this.appendEvent(taskId, task.goal_id ?? undefined, "task.resumed", "system", {})
    })()
  }

  requestClarification(taskId: string, prompt: string, publicPayload: Json): string {
    return this.database.transaction(() => {
      const id = this.createInteraction({ taskId, kind: "clarification", prompt, publicPayload })
      this.database.prepare("UPDATE tasks SET status = 'awaiting_input', updated_at = ? WHERE id = ?").run(nowIso(), taskId)
      return id
    })()
  }

  resolveInteraction(input: { id: string; decision: "approved" | "rejected" | "submitted"; publicResolution?: Json }): void {
    this.database.transaction(() => {
      const interaction = this.database.prepare("SELECT task_id, kind, status FROM interaction_requests WHERE id = ?").get(input.id) as { task_id?: string; kind?: InteractionKind; status?: string } | undefined
      if (!interaction?.task_id || !interaction.kind) throw new SocratesError("interaction_not_found", "That request no longer exists.", { recoverable: true })
      if (interaction.status !== "pending") throw new SocratesError("interaction_already_resolved", "That request was already resolved.", { recoverable: true })
      // Credentials are deliberately resolved without a persisted value. The
      // caller may keep the secret only in its one in-memory handoff.
      this.database.prepare("UPDATE interaction_requests SET status = ?, resolved_at = ?, resolution_json = ? WHERE id = ?")
        .run(input.decision, nowIso(), interaction.kind === "credential" ? json({ received: input.decision === "submitted" }) : json(input.publicResolution ?? { decision: input.decision }), input.id)
      this.appendEvent(interaction.task_id, this.requireTask(interaction.task_id).goal_id ?? undefined, "interaction.resolved", "user", { id: input.id, kind: interaction.kind, decision: input.decision })
    })()
  }

  isFrontierRejected(taskId: string): boolean {
    return Boolean(this.database.prepare("SELECT 1 FROM interaction_requests WHERE task_id = ? AND kind = 'frontier_approval' AND status = 'rejected' LIMIT 1").get(taskId))
  }

  getSnapshot(): CanonicalSnapshot {
    const state = this.database.prepare("SELECT foreground_goal_id, active_root_task_id, revision, recovery_sequence, updated_at FROM app_state WHERE id = 'global'").get() as {
      foreground_goal_id: string | null; active_root_task_id: string | null; revision: number; recovery_sequence: number; updated_at: string
    }
    const foreground = state.foreground_goal_id ? this.database.prepare("SELECT id, ordinal, title, status, latest_capsule_version, created_at, updated_at, completed_at, archived_at FROM goals WHERE id = ?").get(state.foreground_goal_id) as GoalSnapshotRow | undefined : undefined
    const activeTask = state.active_root_task_id ? this.asTask(this.requireTask(state.active_root_task_id)) : undefined
    return {
      state: { ...(state.foreground_goal_id ? { foregroundGoalId: state.foreground_goal_id } : {}), ...(state.active_root_task_id ? { activeRootTaskId: state.active_root_task_id } : {}), revision: state.revision, recoverySequence: state.recovery_sequence, updatedAt: state.updated_at },
      ...(foreground ? { foregroundGoal: mapGoal(foreground) } : {}),
      ...(activeTask ? { activeTask } : {}),
      goals: this.listGoals(),
      pendingInteractions: this.listPendingInteractions(activeTask?.id),
      latestEventSequence: this.currentSequence(),
    }
  }

  listGoals(limit = 25, beforeOrdinal?: number): CanonicalGoal[] {
    const rows = this.database.prepare(
      `SELECT id, ordinal, title, status, latest_capsule_version, created_at, updated_at, completed_at, archived_at
       FROM goals WHERE (? IS NULL OR ordinal < ?) ORDER BY ordinal DESC LIMIT ?`,
    ).all(beforeOrdinal ?? null, beforeOrdinal ?? null, Math.max(1, Math.min(limit, 100))) as GoalSnapshotRow[]
    return rows.map(mapGoal)
  }

  goalResolutionCandidates(): Array<CanonicalGoal & { objective: string; progress: string }> {
    return (this.database.prepare(
      `SELECT goals.id, goals.ordinal, goals.title, goals.status, goals.latest_capsule_version, goals.created_at, goals.updated_at, goals.completed_at, goals.archived_at,
              goal_capsule_versions.objective, goal_capsule_versions.summary
       FROM goals LEFT JOIN goal_capsule_versions
         ON goal_capsule_versions.goal_id = goals.id AND goal_capsule_versions.version = goals.latest_capsule_version
       WHERE goals.status <> 'archived' ORDER BY goals.updated_at DESC, goals.ordinal DESC LIMIT 4`,
    ).all() as Array<GoalSnapshotRow & { objective: string | null; summary: string | null }>).map((row) => ({
      ...mapGoal(row), objective: row.objective || row.title, progress: row.summary || "No verified progress recorded yet.",
    }))
  }

  listGoalExchanges(goalId: string, limit = 25, beforeOrdinal?: number): CanonicalExchange[] {
    this.requireGoal(goalId)
    const tasks = this.database.prepare(
      `SELECT * FROM tasks WHERE goal_id = ? AND (? IS NULL OR ordinal < ?) ORDER BY ordinal DESC LIMIT ?`,
    ).all(goalId, beforeOrdinal ?? null, beforeOrdinal ?? null, Math.max(1, Math.min(limit, 100))) as CanonicalTaskRow[]
    return tasks.map((task) => {
      const messages = this.database.prepare("SELECT id, role, content, created_at, completed_at FROM messages WHERE task_id = ? ORDER BY ordinal").all(task.id) as Array<{ id: string; role: "user" | "assistant" | "system"; content: string; created_at: string; completed_at: string | null }>
      const user = messages.find((message) => message.role === "user")
      const assistant = messages.find((message) => message.role === "assistant")
      return {
        task: this.asTask(task),
        ...(user ? { userMessage: { id: user.id, content: user.content, createdAt: user.created_at } } : {}),
        ...(assistant ? { assistantMessage: { id: assistant.id, content: assistant.content, createdAt: assistant.created_at, ...(assistant.completed_at ? { completedAt: assistant.completed_at } : {}) } } : {}),
        interactions: this.listPendingInteractions(task.id),
      }
    })
  }

  getGoalExchange(goalId: string, taskId: string): CanonicalExchange {
    this.requireGoal(goalId)
    const task = this.database.prepare("SELECT * FROM tasks WHERE id = ? AND goal_id = ? LIMIT 1").get(taskId, goalId) as CanonicalTaskRow | undefined
    if (!task) throw new SocratesError("goal_exchange_not_found", "That exact goal exchange is unavailable.", { recoverable: true })
    return this.exchangeForTask(task)
  }

  listResources(owner?: { kind: "goal" | "task"; id: string }): CanonicalResource[] {
    const rows = (owner
      ? this.database.prepare(
        `SELECT DISTINCT resources.id, resources.label, resources.kind, resources.availability, resources.updated_at, resource_locations.canonical_path
         FROM resource_bindings JOIN resources ON resources.id = resource_bindings.resource_id
         JOIN resource_locations ON resource_locations.id = resource_bindings.resource_location_id
         WHERE resource_bindings.owner_kind = ? AND resource_bindings.owner_id = ? AND resource_bindings.status = 'active'
         ORDER BY resources.updated_at DESC`,
      ).all(owner.kind, owner.id)
      : this.database.prepare(
        `SELECT resources.id, resources.label, resources.kind, resources.availability, resources.updated_at, resource_locations.canonical_path
         FROM resources LEFT JOIN resource_locations ON resource_locations.resource_id = resources.id AND resource_locations.valid_to IS NULL
         ORDER BY resources.updated_at DESC`,
      ).all()) as Array<{ id: string; label: string; kind: string; availability: string; updated_at: string; canonical_path: string | null }>
    return rows.map((row) => {
      if (row.kind !== "filesystem_root" || !["available", "missing", "ambiguous", "unavailable"].includes(row.availability)) {
        throw new SocratesError("canonical_resource_invalid", "A canonical resource record contains an invalid type or availability.")
      }
      return {
        id: row.id,
        label: row.label,
        kind: row.kind,
        availability: row.availability as CanonicalResource["availability"],
        updatedAt: row.updated_at,
        ...(row.canonical_path ? { canonicalPath: row.canonical_path } : {}),
      }
    })
  }

  listKnowledge(input: { scope: "global" | "resource"; resourceId?: string; includePending?: boolean }): CanonicalKnowledge[] {
    if ((input.scope === "resource") !== Boolean(input.resourceId)) throw new SocratesError("knowledge_scope_invalid", "Resource knowledge requires exactly one resource.")
    const rows = this.database.prepare(
      `SELECT knowledge_entries.id AS entry_id, knowledge_entries.kind, knowledge_entries.stable_key,
              knowledge_versions.id AS version_id, knowledge_versions.version, knowledge_versions.status,
              knowledge_versions.content_json, knowledge_versions.provenance_json, knowledge_versions.created_at
       FROM knowledge_entries JOIN knowledge_versions ON knowledge_versions.entry_id = knowledge_entries.id
       WHERE knowledge_entries.scope_kind = ? AND knowledge_entries.resource_id IS ?
         AND (? = 1 OR knowledge_versions.status = 'accepted')
       ORDER BY knowledge_entries.updated_at DESC, knowledge_versions.version DESC`,
    ).all(input.scope, input.resourceId ?? null, input.includePending ? 1 : 0) as Array<{
      entry_id: string; kind: string; stable_key: string; version_id: string; version: number; status: string; content_json: string; provenance_json: string; created_at: string
    }>
    return rows.map((row) => ({ entryId: row.entry_id, kind: row.kind, stableKey: row.stable_key, versionId: row.version_id, version: row.version, status: row.status, content: parseJson(row.content_json, null), provenance: parseJson(row.provenance_json, {}), createdAt: row.created_at }))
  }

  listEvents(afterSequence = 0, limit = 200): CanonicalEvent[] {
    return (this.database.prepare(
      "SELECT id, task_id, goal_id, sequence, type, source, payload_json, created_at FROM task_events WHERE sequence > ? ORDER BY sequence LIMIT ?",
    ).all(afterSequence, Math.max(1, Math.min(limit, 2_000))) as Array<{ id: string; task_id: string | null; goal_id: string | null; sequence: number; type: string; source: string; payload_json: string; created_at: string }>).map((row) => ({
      id: row.id, ...(row.task_id ? { taskId: row.task_id } : {}), ...(row.goal_id ? { goalId: row.goal_id } : {}), sequence: row.sequence, type: row.type, source: row.source, payload: parseJson(row.payload_json, {}), createdAt: row.created_at,
    }))
  }

  listGoalTaskIds(goalId: string): string[] {
    return (this.database.prepare("SELECT id FROM tasks WHERE goal_id = ? ORDER BY ordinal DESC").all(goalId) as Array<{ id: string }>).map((row) => row.id)
  }

  private copyActiveResourceBindings(input: {
    fromKind: "goal" | "task"
    fromId: string
    toKind: "goal" | "task"
    toId: string
    confirmedBy: string
  }): void {
    const bindings = this.database.prepare(
      `SELECT resource_id, resource_location_id
       FROM resource_bindings
       WHERE owner_kind = ? AND owner_id = ? AND status = 'active'`,
    ).all(input.fromKind, input.fromId) as Array<{ resource_id: string; resource_location_id: string }>
    const timestamp = nowIso()
    for (const binding of bindings) {
      const exists = this.database.prepare(
        `SELECT 1 FROM resource_bindings
         WHERE owner_kind = ? AND owner_id = ? AND resource_id = ? AND resource_location_id = ? AND status = 'active'`,
      ).get(input.toKind, input.toId, binding.resource_id, binding.resource_location_id)
      if (exists) continue
      this.database.prepare(
        `INSERT INTO resource_bindings (id, owner_kind, owner_id, resource_id, resource_location_id, status, confirmed_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      ).run(createId("binding"), input.toKind, input.toId, binding.resource_id, binding.resource_location_id, input.confirmedBy, timestamp)
    }
  }

  private listPendingInteractions(taskId?: string): CanonicalInteraction[] {
    const rows = this.database.prepare(
      `SELECT id, task_id, kind, status, fingerprint, prompt, public_payload_json, requested_at
       FROM interaction_requests WHERE status = 'pending' AND (? IS NULL OR task_id = ?) ORDER BY requested_at`,
    ).all(taskId ?? null, taskId ?? null) as Array<{ id: string; task_id: string; kind: InteractionKind; status: string; fingerprint: string | null; prompt: string; public_payload_json: string; requested_at: string }>
    return rows.map((row) => {
      const parsedPayload = parseJson(row.public_payload_json, {})
      return {
        id: row.id,
        taskId: row.task_id,
        kind: row.kind,
        status: "pending" as const,
        ...(row.fingerprint ? { fingerprint: row.fingerprint } : {}),
        prompt: row.prompt,
        publicPayload: isRecord(parsedPayload) ? parsedPayload : {},
        requestedAt: row.requested_at,
      }
    })
  }

  private exchangeForTask(task: CanonicalTaskRow): CanonicalExchange {
    const messages = this.database.prepare("SELECT id, role, content, created_at, completed_at FROM messages WHERE task_id = ? ORDER BY ordinal").all(task.id) as Array<{ id: string; role: "user" | "assistant" | "system"; content: string; created_at: string; completed_at: string | null }>
    const user = messages.find((message) => message.role === "user")
    const assistant = messages.find((message) => message.role === "assistant")
    return {
      task: this.asTask(task),
      ...(user ? { userMessage: { id: user.id, content: user.content, createdAt: user.created_at } } : {}),
      ...(assistant ? { assistantMessage: { id: assistant.id, content: assistant.content, createdAt: assistant.created_at, ...(assistant.completed_at ? { completedAt: assistant.completed_at } : {}) } } : {}),
      interactions: this.listPendingInteractions(task.id),
    }
  }

  private appendEvent(taskId: string | undefined, goalId: string | undefined, type: string, source: string, payload: Json): number {
    const sequence = this.currentSequence() + 1
    this.database.prepare(
      "INSERT INTO task_events (id, task_id, goal_id, sequence, type, source, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(createId("event"), taskId ?? null, goalId ?? null, sequence, type, source, json(payload), nowIso())
    return sequence
  }

  private currentSequence(): number {
    return Number((this.database.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM task_events").get() as { sequence: number }).sequence)
  }
  private nextOrdinal(table: "tasks" | "goals"): number {
    return Number((this.database.prepare(`SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal FROM ${table}`).get() as { ordinal: number }).ordinal)
  }
  private requireTask(id: string): CanonicalTaskRow {
    const task = this.database.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as CanonicalTaskRow | undefined
    if (!task) throw new SocratesError("task_not_found", "That task no longer exists.", { recoverable: true })
    return task
  }
  private requireGoal(id: string): GoalRow {
    const goal = this.database.prepare("SELECT * FROM goals WHERE id = ?").get(id) as GoalRow | undefined
    if (!goal) throw new SocratesError("goal_not_found", "That goal no longer exists.", { recoverable: true })
    return goal
  }
  private requireMessage(id: string): { content: string } {
    const message = this.database.prepare("SELECT content FROM messages WHERE id = ?").get(id) as { content?: string } | undefined
    if (!message?.content) throw new SocratesError("message_not_found", "The exact request message is missing.")
    return { content: message.content }
  }
  private requireResource(id: string): void {
    if (!this.database.prepare("SELECT 1 FROM resources WHERE id = ?").get(id)) throw new SocratesError("resource_not_found", "That resource no longer exists.", { recoverable: true })
  }
  private requireTerminalSession(id: string): CanonicalTerminalSession {
    const session = this.database.prepare("SELECT * FROM terminal_sessions WHERE id = ?").get(id) as TerminalSessionRow | undefined
    if (!session) throw new SocratesError("terminal_session_not_found", "That Terminal session is unavailable.", { recoverable: true })
    return mapTerminalSession(session)
  }
  private nextTerminalOutputSequence(sessionId: string): number {
    return Number((this.database.prepare("SELECT COALESCE(MAX(sequence), -1) + 1 AS sequence FROM terminal_output_chunks WHERE terminal_session_id = ?").get(sessionId) as { sequence: number }).sequence)
  }
  private foregroundGoalId(): string | undefined {
    return (this.database.prepare("SELECT foreground_goal_id FROM app_state WHERE id = 'global'").get() as { foreground_goal_id?: string | null }).foreground_goal_id ?? undefined
  }
  private assertBindingOwner(kind: "goal" | "task", id: string): void {
    if (kind === "goal") this.requireGoal(id)
    else this.requireTask(id)
  }
  private assertActiveRuleCapacity(scope: "global" | "resource", resourceId: string | undefined): void {
    const count = (this.database.prepare(
      `SELECT COUNT(*) AS count FROM knowledge_entries
       JOIN knowledge_versions ON knowledge_versions.entry_id = knowledge_entries.id AND knowledge_versions.version = knowledge_entries.active_version
       WHERE scope_kind = ? AND resource_id IS ? AND kind = 'rule' AND knowledge_versions.status = 'accepted'`,
    ).get(scope, resourceId ?? null) as { count: number }).count
    if (count >= 10) throw new SocratesError("knowledge_rule_limit_reached", "Keep at most ten accepted rules in a global or resource scope.", { recoverable: true })
  }
  private latestCapsule(goalId: string): CapsuleRow {
    const capsule = this.database.prepare("SELECT * FROM goal_capsule_versions WHERE goal_id = ? ORDER BY version DESC LIMIT 1").get(goalId) as CapsuleRow | undefined
    if (!capsule) throw new SocratesError("goal_capsule_missing", "The goal capsule is missing.")
    return capsule
  }
  private insertCapsule(input: CanonicalCapsuleInput): void {
    this.database.prepare(
      `INSERT INTO goal_capsule_versions (id, goal_id, version, objective, summary, state, progress_json, constraints_json, decisions_json, open_questions_json, next_actions_json, resource_refs_json, source_through_event_sequence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(createId("capsule"), input.goalId, input.version, input.objective, input.summary, input.state, json(input.progress ?? []), json(input.constraints ?? []), json(input.decisions ?? []), json(input.openQuestions ?? []), json(input.nextActions ?? []), json(input.resourceRefs ?? []), input.sourceThroughEventSequence, nowIso())
  }
  private insertModelEvidence(taskId: string, evidence: Json, startedAt: string): void {
    this.database.prepare(
      `INSERT INTO model_calls (id, task_id, role, provider_id, model_id, status, request_json, response_json, started_at, completed_at)
       VALUES (?, ?, 'main', 'recorded', 'recorded', 'completed', '{}', ?, ?, ?)`,
    ).run(createId("model"), taskId, json(evidence), startedAt, startedAt)
  }
  private asTask(task: CanonicalTaskRow): CanonicalTask {
    return {
      id: task.id, ordinal: task.ordinal, ...(task.goal_id ? { goalId: task.goal_id } : {}), status: task.status as TaskStatus,
      requestMessageId: task.request_message_id, ...(task.final_message_id ? { finalMessageId: task.final_message_id } : {}),
      accessSnapshotId: task.access_snapshot_id, createdAt: task.created_at, updatedAt: task.updated_at,
    }
  }
}

type CanonicalTaskRow = { id: string; ordinal: number; goal_id: string | null; status: TaskStatus; request_message_id: string; final_message_id: string | null; access_snapshot_id: string; created_at: string; updated_at: string }
type TerminalSessionRow = { id: string; task_id: string; name: string; command: string; cwd: string; status: string; process_id: string | null; containment_json: string; metadata_json: string; created_at: string; updated_at: string; completed_at: string | null }
type GoalRow = { id: string; latest_capsule_version: number }
type CapsuleRow = { objective: string; summary: string; state: string; progress_json: string; constraints_json: string; decisions_json: string; open_questions_json: string; next_actions_json: string; resource_refs_json: string }
type CanonicalCapsuleInput = { goalId: string; version: number; objective: string; summary: string; state: string; progress?: Json; constraints?: Json; decisions?: Json; openQuestions?: Json; nextActions?: Json; resourceRefs?: Json; sourceThroughEventSequence: number }
type GoalSnapshotRow = { id: string; ordinal: number; title: string; status: GoalStatus; latest_capsule_version: number; created_at: string; updated_at: string; completed_at: string | null; archived_at: string | null }

export type CanonicalGoal = Readonly<{ id: string; ordinal: number; title: string; status: GoalStatus; latestCapsuleVersion: number; createdAt: string; updatedAt: string; completedAt?: string; archivedAt?: string }>
export type CanonicalInteraction = Readonly<{ id: string; taskId: string; kind: InteractionKind; status: "pending"; fingerprint?: string; prompt: string; publicPayload: Record<string, unknown>; requestedAt: string }>
export type CanonicalExchange = Readonly<{ task: CanonicalTask; userMessage?: Readonly<{ id: string; content: string; createdAt: string }>; assistantMessage?: Readonly<{ id: string; content: string; createdAt: string; completedAt?: string }>; interactions: CanonicalInteraction[] }>
export type CanonicalResource = Readonly<{ id: string; label: string; kind: "filesystem_root"; availability: "available" | "missing" | "ambiguous" | "unavailable"; updatedAt: string; canonicalPath?: string }>
export type CanonicalKnowledge = Readonly<{ entryId: string; kind: string; stableKey: string; versionId: string; version: number; status: string; content: Json; provenance: Json; createdAt: string }>
export type CanonicalEvent = Readonly<{ id: string; taskId?: string; goalId?: string; sequence: number; type: string; source: string; payload: Json; createdAt: string }>
export type CanonicalSnapshot = Readonly<{ state: Readonly<{ foregroundGoalId?: string; activeRootTaskId?: string; revision: number; recoverySequence: number; updatedAt: string }>; foregroundGoal?: CanonicalGoal; activeTask?: CanonicalTask; goals: CanonicalGoal[]; pendingInteractions: CanonicalInteraction[]; latestEventSequence: number }>

const json = (value: Json): string => JSON.stringify(value)
const parseJson = (value: string, fallback: Json): Json => { try { return JSON.parse(value) as Json } catch { return fallback } }
const isRecord = (value: Json): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value)
const parseAuthorizedRoots = (value: string): FilesystemAuthorizationSnapshot["roots"] => {
  const parsed = parseJson(value, [])
  if (!Array.isArray(parsed)) throw new SocratesError("task_access_snapshot_invalid", "The persisted filesystem access roots are invalid.")
  const roots = parsed.map((root) => {
    if (!isRecord(root) || typeof root.id !== "string" || typeof root.label !== "string" || typeof root.path !== "string") {
      throw new SocratesError("task_access_snapshot_invalid", "The persisted filesystem access roots are invalid.")
    }
    return { id: root.id, label: root.label, path: root.path }
  })
  return roots
}
const mapGoal = (row: GoalSnapshotRow): CanonicalGoal => ({
  id: row.id, ordinal: row.ordinal, title: row.title, status: row.status, latestCapsuleVersion: row.latest_capsule_version,
  createdAt: row.created_at, updatedAt: row.updated_at, ...(row.completed_at ? { completedAt: row.completed_at } : {}), ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
})
const mapTerminalSession = (row: TerminalSessionRow): CanonicalTerminalSession => {
  if (!["starting", "running", "exited", "stopped", "missing", "awaiting_input"].includes(row.status)) {
    throw new SocratesError("terminal_session_invalid", "A persisted Terminal session has an invalid status.")
  }
  return {
    id: row.id, taskId: row.task_id, name: row.name, command: row.command, cwd: row.cwd,
    status: row.status as CanonicalTerminalSession["status"],
    ...(row.process_id ? { processId: row.process_id } : {}),
    containment: parseJson(row.containment_json, {}), metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at, updatedAt: row.updated_at, ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  }
}
const resourceFingerprint = (root: string): Json => {
  const stat = fs.statSync(root)
  const gitHead = path.join(root, ".git", "HEAD")
  return { device: stat.dev, inode: stat.ino, modifiedMs: stat.mtimeMs, gitHead: fs.existsSync(gitHead) ? crypto.createHash("sha256").update(fs.readFileSync(gitHead)).digest("hex") : undefined }
}
const assertNotRepoLocalSocratesPath = (candidate: string): void => {
  if (candidate.split(path.sep).includes(".socrates")) {
    throw new SocratesError("repo_local_socrates_ignored", "Repo-local .socrates directories are not resources in global Socrates.", { recoverable: true })
  }
}
