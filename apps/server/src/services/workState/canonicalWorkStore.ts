import type { ConversationPartialTurn, ConversationToolRun, Message, MessageAttachment, V2Message, V2MessageAttachment, V2ToolCall, V2Turn } from "@socrates/contracts"
import { createId, nowIso, SocratesError } from "@socrates/shared"
import { and, asc, eq, inArray } from "drizzle-orm"
import type { DatabaseHandle } from "../../db/client"
import {
  conversationTaskProjections,
  toolCalls,
  messageAttachments,
  messages,
  turns,
  v2ClassicMessageLinks,
  v2ClassicTurnGoalLinks,
  v2GoalClassicHomes,
  v2Goals,
  v2MessageAttachments,
  v2Messages,
  v2ToolCalls,
  v2Turns,
  workMessages,
  workTasks,
} from "../../db/schema"

export type WorkSourceRuntime = "classic" | "v2_flow"

export type CanonicalMessageProjection = Readonly<{
  canonicalTaskId: string
  canonicalMessageId: string
  projectId: string
  goalId?: string
  sourceRuntime: WorkSourceRuntime
  sourceTurnId: string
  sourceMessageId: string
  role: Message["role"]
  content: string
  reasoning?: string
  status: Message["status"]
  parentMessageId?: string
  createdAt: string
  completedAt?: string
  classicAttachments: MessageAttachment[]
  flowAttachments: V2MessageAttachment[]
}>

type BindTaskInput = Readonly<{
  projectId: string
  goalId?: string
  sourceRuntime: WorkSourceRuntime
  sourceTurnId: string
  conversationId?: string
  projectionReason?: "origin" | "goal_home" | "legacy_bridge"
}>

type WorkTaskRow = typeof workTasks.$inferSelect

const parseReasoning = (metadataJson: string | null): string | undefined => {
  if (!metadataJson) return undefined
  try {
    const value = JSON.parse(metadataJson) as { reasoning?: unknown }
    return typeof value.reasoning === "string" && value.reasoning.trim() ? value.reasoning : undefined
  } catch {
    return undefined
  }
}

const parseJson = (value: string | null): unknown => {
  if (!value) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

/**
 * Owns canonical work identity and read-only view projections.
 *
 * Physical runtime rows remain authoritative. This store never copies message
 * content, tool state, or lifecycle state between Classic and Flow.
 */
export class CanonicalWorkStore {
  constructor(private readonly handle: DatabaseHandle) {}

  reconcileLegacyBridgeData(): void {
    const operation = this.handle.sqlite.transaction(() => {
      const classicLinks = this.handle.db.select().from(v2ClassicTurnGoalLinks).orderBy(asc(v2ClassicTurnGoalLinks.createdAt)).all()
      for (const link of classicLinks) {
        const sourceV2 = this.handle.db.select().from(v2ClassicMessageLinks).where(and(
          eq(v2ClassicMessageLinks.classicMessageId, link.userMessageId),
          eq(v2ClassicMessageLinks.sourceRuntime, "v2"),
        )).limit(1).get()
        if (sourceV2) {
          const source = this.handle.db.select().from(v2Messages).where(eq(v2Messages.id, sourceV2.v2MessageId)).limit(1).get()
          if (source?.turnId) {
            this.bindTask({
              projectId: link.projectId,
              goalId: link.goalId,
              sourceRuntime: "v2_flow",
              sourceTurnId: source.turnId,
              conversationId: link.conversationId,
              projectionReason: "legacy_bridge",
            })
          }
          continue
        }
        this.bindTask({
          projectId: link.projectId,
          goalId: link.goalId,
          sourceRuntime: "classic",
          sourceTurnId: link.turnId,
          conversationId: link.conversationId,
          projectionReason: "origin",
        })
      }

      const flowTurns = this.handle.db.select().from(v2Turns).where(inArray(v2Turns.status, [
        "queued", "routing", "awaiting_clarification", "running", "waiting", "suspended", "completed", "failed", "cancelled",
      ])).orderBy(asc(v2Turns.startedAt)).all()
      for (const turn of flowTurns) {
        if (!turn.goalId) continue
        const sourceClassic = turn.userMessageId
          ? this.handle.db.select().from(v2ClassicMessageLinks).where(and(
              eq(v2ClassicMessageLinks.v2MessageId, turn.userMessageId),
              eq(v2ClassicMessageLinks.sourceRuntime, "classic"),
            )).limit(1).get()
          : undefined
        if (sourceClassic) {
          const source = this.handle.db.select().from(messages).where(eq(messages.id, sourceClassic.classicMessageId)).limit(1).get()
          if (source?.turnId) {
            const classicLink = this.handle.db.select().from(v2ClassicTurnGoalLinks).where(eq(v2ClassicTurnGoalLinks.turnId, source.turnId)).limit(1).get()
            this.bindTask({
              projectId: turn.projectId,
              goalId: classicLink?.goalId ?? turn.goalId,
              sourceRuntime: "classic",
              sourceTurnId: source.turnId,
              ...(classicLink ? { conversationId: classicLink.conversationId, projectionReason: "origin" as const } : {}),
            })
          }
          continue
        }
        this.bindTask({
          projectId: turn.projectId,
          goalId: turn.goalId,
          sourceRuntime: "v2_flow",
          sourceTurnId: turn.id,
        })
      }

      const homes = this.handle.db.select().from(v2GoalClassicHomes).orderBy(asc(v2GoalClassicHomes.createdAt)).all()
      for (const home of homes) this.projectGoalToConversation(home.goalId, home.conversationId, "goal_home")
    })
    operation()
  }

  bindV2Task(projectId: string, goalId: string, turnId: string): string {
    return this.bindTask({ projectId, goalId, sourceRuntime: "v2_flow", sourceTurnId: turnId }).id
  }

  bindClassicTask(input: Readonly<{
    projectId: string
    goalId: string
    turnId: string
    conversationId: string
  }>): string {
    return this.bindTask({
      projectId: input.projectId,
      goalId: input.goalId,
      sourceRuntime: "classic",
      sourceTurnId: input.turnId,
      conversationId: input.conversationId,
      projectionReason: "origin",
    }).id
  }

  syncSourceTask(sourceRuntime: WorkSourceRuntime, sourceTurnId: string): void {
    const task = this.findTask(sourceRuntime, sourceTurnId)
    if (task) this.syncMessages(task)
  }

  projectGoalToConversation(
    goalId: string,
    conversationId: string,
    reason: "goal_home" | "legacy_bridge" = "goal_home",
  ): void {
    const tasks = this.handle.db.select().from(workTasks).where(eq(workTasks.goalId, goalId)).orderBy(asc(workTasks.startedAt)).all()
    for (const task of tasks) this.ensureConversationProjection(conversationId, task.id, reason)
  }

  listFlowMessages(flowId: string): CanonicalMessageProjection[] {
    const tasks = this.handle.db.select({ task: workTasks }).from(workTasks)
      .innerJoin(v2Goals, eq(v2Goals.id, workTasks.goalId))
      .where(eq(v2Goals.flowId, flowId))
      .orderBy(asc(workTasks.startedAt))
      .all()
      .map((row) => row.task)
    return this.readTaskMessages(tasks)
  }

  listConversationMessages(conversationId: string): CanonicalMessageProjection[] {
    const tasks = this.handle.db.select({ task: workTasks }).from(conversationTaskProjections)
      .innerJoin(workTasks, eq(workTasks.id, conversationTaskProjections.taskId))
      .where(eq(conversationTaskProjections.conversationId, conversationId))
      .orderBy(asc(conversationTaskProjections.position))
      .all()
      .map((row) => row.task)
    return this.readTaskMessages(tasks)
  }

  listGoalTasks(goalId: string): WorkTaskRow[] {
    return this.handle.db.select().from(workTasks).where(eq(workTasks.goalId, goalId)).orderBy(asc(workTasks.startedAt)).all()
  }

  listFlowToolCalls(flowId: string): V2ToolCall[] {
    const tasks = this.handle.db.select({ task: workTasks }).from(workTasks)
      .innerJoin(v2Goals, eq(v2Goals.id, workTasks.goalId))
      .where(eq(v2Goals.flowId, flowId)).all().map((row) => row.task)
    return tasks.flatMap((task): V2ToolCall[] => {
      if (task.sourceRuntime === "v2_flow") {
        return this.handle.db.select().from(v2ToolCalls).where(eq(v2ToolCalls.turnId, task.sourceTurnId))
          .orderBy(asc(v2ToolCalls.startedAt)).all().map((row) => ({
            id: row.id,
            flowId: row.flowId,
            projectId: row.projectId,
            ...(row.goalId ? { goalId: row.goalId } : {}),
            turnId: row.turnId,
            ...(row.modelCallId ? { modelCallId: row.modelCallId } : {}),
            toolName: row.toolName,
            status: row.status as V2ToolCall["status"],
            arguments: parseJson(row.argumentsJson),
            ...(row.resultJson ? { result: parseJson(row.resultJson) } : {}),
            requiresApproval: row.requiresApproval,
            ...(row.approvalId ? { approvalId: row.approvalId } : {}),
            ...(row.errorId ? { errorId: row.errorId } : {}),
            ...(row.startedAt ? { startedAt: row.startedAt } : {}),
            ...(row.completedAt ? { completedAt: row.completedAt } : {}),
          }))
      }
      const flow = this.flowIdForGoal(task.goalId)
      return this.handle.db.select().from(toolCalls).where(eq(toolCalls.turnId, task.sourceTurnId))
        .orderBy(asc(toolCalls.startedAt)).all().map((row) => ({
          id: row.id,
          flowId: flow,
          projectId: task.projectId,
          ...(task.goalId ? { goalId: task.goalId } : {}),
          turnId: task.sourceTurnId,
          ...(row.modelCallId ? { modelCallId: row.modelCallId } : {}),
          toolName: row.toolName,
          status: row.status === "pending" ? "running" : row.status === "rejected" ? "failed" : row.status as V2ToolCall["status"],
          arguments: parseJson(row.argumentsJson),
          ...(row.resultJson ? { result: parseJson(row.resultJson) } : {}),
          requiresApproval: row.requiresApproval,
          ...(row.approvalId ? { approvalId: row.approvalId } : {}),
          ...(row.errorId ? { errorId: row.errorId } : {}),
          ...(row.startedAt ? { startedAt: row.startedAt } : {}),
          ...(row.completedAt ? { completedAt: row.completedAt } : {}),
        }))
    })
  }

  listConversationToolRuns(conversationId: string, sessionId: string): ConversationToolRun[] {
    const tasks = this.handle.db.select({ task: workTasks }).from(conversationTaskProjections)
      .innerJoin(workTasks, eq(workTasks.id, conversationTaskProjections.taskId))
      .where(eq(conversationTaskProjections.conversationId, conversationId)).all().map((row) => row.task)
    return tasks.flatMap((task): ConversationToolRun[] => {
      if (task.sourceRuntime !== "v2_flow") return []
      return this.handle.db.select().from(v2ToolCalls).where(eq(v2ToolCalls.turnId, task.sourceTurnId))
        .orderBy(asc(v2ToolCalls.startedAt)).all().map((row) => ({
          toolCallId: row.id,
          toolRunId: row.id,
          conversationId,
          sessionId,
          turnId: task.sourceTurnId,
          toolName: row.toolName as ConversationToolRun["toolName"],
          ...(row.modelCallId ? { modelCallId: row.modelCallId } : {}),
          status: (row.status === "pending" ? "running" : row.status === "rejected" ? "failed" : row.status) as ConversationToolRun["status"],
          requiresApproval: row.requiresApproval,
          arguments: parseJson(row.argumentsJson),
          ...(row.resultJson ? { result: parseJson(row.resultJson) } : {}),
          ...(row.errorId ? { errorId: row.errorId } : {}),
          summary: row.toolName,
          ...(row.startedAt ? { startedAt: row.startedAt } : {}),
          ...(row.completedAt ? { completedAt: row.completedAt } : {}),
          ...(row.startedAt && row.completedAt ? { durationMs: Math.max(0, Date.parse(row.completedAt) - Date.parse(row.startedAt)) } : {}),
        }))
    })
  }

  listConversationPartialTurns(conversationId: string): ConversationPartialTurn[] {
    const tasks = this.projectedTasks(conversationId)
    return tasks.flatMap((task): ConversationPartialTurn[] => {
      if (task.sourceRuntime !== "v2_flow") return []
      const turn = this.handle.db.select().from(v2Turns).where(eq(v2Turns.id, task.sourceTurnId)).limit(1).get()
      if (!turn || !["running", "failed", "cancelled", "suspended"].includes(turn.status)) return []
      const assistant = this.handle.db.select().from(v2Messages).where(and(
        eq(v2Messages.turnId, turn.id),
        eq(v2Messages.role, "assistant"),
      )).orderBy(asc(v2Messages.ordinal)).limit(1).get()
      const reasoning = assistant ? parseReasoning(assistant.metadataJson) : undefined
      return [{
        turnId: turn.id,
        status: turn.status as ConversationPartialTurn["status"],
        ...(assistant?.content ? { answer: assistant.content } : {}),
        ...(reasoning ? { reasoning } : {}),
      }]
    })
  }

  findActiveFlowTurn(flowId: string): V2Turn | undefined {
    const tasks = this.handle.db.select({ task: workTasks }).from(workTasks)
      .innerJoin(v2Goals, eq(v2Goals.id, workTasks.goalId))
      .where(eq(v2Goals.flowId, flowId)).orderBy(asc(workTasks.startedAt)).all().map((row) => row.task)
    for (let index = tasks.length - 1; index >= 0; index -= 1) {
      const task = tasks[index]!
      if (task.sourceRuntime === "v2_flow") continue
      const turn = this.handle.db.select().from(turns).where(eq(turns.id, task.sourceTurnId)).limit(1).get()
      if (!turn || !["running", "waiting", "suspended"].includes(turn.status)) continue
      return {
        id: turn.id,
        flowId,
        projectId: task.projectId,
        ...(task.goalId ? { goalId: task.goalId } : {}),
        ordinal: index + 1,
        ...(turn.userMessageId ? { userMessageId: turn.userMessageId } : {}),
        ...(turn.assistantMessageId ? { assistantMessageId: turn.assistantMessageId } : {}),
        status: turn.status as V2Turn["status"],
        ...(turn.errorId ? { errorId: turn.errorId } : {}),
        startedAt: turn.startedAt,
        updatedAt: turn.completedAt ?? turn.failedAt ?? turn.cancelledAt ?? turn.startedAt,
        ...(turn.completedAt ? { completedAt: turn.completedAt } : {}),
        ...(turn.failedAt ? { failedAt: turn.failedAt } : {}),
        ...(turn.cancelledAt ? { cancelledAt: turn.cancelledAt } : {}),
      }
    }
    return undefined
  }

  findTaskBySourceTurn(sourceTurnId: string): WorkTaskRow | undefined {
    return this.handle.db.select().from(workTasks).where(eq(workTasks.sourceTurnId, sourceTurnId)).limit(1).get()
  }

  private projectedTasks(conversationId: string): WorkTaskRow[] {
    return this.handle.db.select({ task: workTasks }).from(conversationTaskProjections)
      .innerJoin(workTasks, eq(workTasks.id, conversationTaskProjections.taskId))
      .where(eq(conversationTaskProjections.conversationId, conversationId))
      .orderBy(asc(conversationTaskProjections.position)).all().map((row) => row.task)
  }

  assertConversationHasNoActiveProjectedTask(conversationId: string): void {
    const tasks = this.handle.db.select({ task: workTasks }).from(conversationTaskProjections)
      .innerJoin(workTasks, eq(workTasks.id, conversationTaskProjections.taskId))
      .where(eq(conversationTaskProjections.conversationId, conversationId)).all().map((row) => row.task)
    for (const task of tasks) {
      const status = task.sourceRuntime === "classic"
        ? this.handle.db.select({ status: turns.status }).from(turns).where(eq(turns.id, task.sourceTurnId)).limit(1).get()?.status
        : this.handle.db.select({ status: v2Turns.status }).from(v2Turns).where(eq(v2Turns.id, task.sourceTurnId)).limit(1).get()?.status
      if (["queued", "routing", "awaiting_clarification", "running", "waiting"].includes(status ?? "")) {
        throw new SocratesError("canonical_task_already_active", "This work already has an active task. Stop or finish it before starting another request.", {
          details: { taskId: task.id },
          recoverable: true,
        })
      }
    }
  }

  deleteTaskIdentity(sourceTurnId: string): void {
    const task = this.findTaskBySourceTurn(sourceTurnId)
    if (!task) return
    this.handle.db.delete(conversationTaskProjections).where(eq(conversationTaskProjections.taskId, task.id)).run()
    this.handle.db.delete(workMessages).where(eq(workMessages.taskId, task.id)).run()
    this.handle.db.delete(workTasks).where(eq(workTasks.id, task.id)).run()
  }

  deleteGoalIdentity(goalId: string): void {
    for (const task of this.listGoalTasks(goalId)) this.deleteTaskIdentity(task.sourceTurnId)
  }

  detachConversation(conversationId: string): void {
    this.handle.db.delete(conversationTaskProjections).where(eq(conversationTaskProjections.conversationId, conversationId)).run()
  }

  conversationOwnsClassicSource(conversationId: string): boolean {
    return Boolean(this.handle.db.select({ id: workTasks.id }).from(conversationTaskProjections)
      .innerJoin(workTasks, eq(workTasks.id, conversationTaskProjections.taskId))
      .innerJoin(turns, eq(turns.id, workTasks.sourceTurnId))
      .where(and(
        eq(conversationTaskProjections.conversationId, conversationId),
        eq(workTasks.sourceRuntime, "classic"),
        eq(turns.conversationId, conversationId),
      )).limit(1).get())
  }

  isLegacyShadowMessage(sourceRuntime: WorkSourceRuntime, messageId: string): boolean {
    return sourceRuntime === "classic"
      ? Boolean(this.handle.db.select({ id: v2ClassicMessageLinks.id }).from(v2ClassicMessageLinks).where(and(
          eq(v2ClassicMessageLinks.classicMessageId, messageId),
          eq(v2ClassicMessageLinks.sourceRuntime, "v2"),
        )).limit(1).get())
      : Boolean(this.handle.db.select({ id: v2ClassicMessageLinks.id }).from(v2ClassicMessageLinks).where(and(
          eq(v2ClassicMessageLinks.v2MessageId, messageId),
          eq(v2ClassicMessageLinks.sourceRuntime, "classic"),
        )).limit(1).get())
  }

  private bindTask(input: BindTaskInput): WorkTaskRow {
    const existing = this.findTask(input.sourceRuntime, input.sourceTurnId)
    const startedAt = input.sourceRuntime === "classic"
      ? this.handle.db.select({ startedAt: turns.startedAt }).from(turns).where(eq(turns.id, input.sourceTurnId)).limit(1).get()?.startedAt
      : this.handle.db.select({ startedAt: v2Turns.startedAt }).from(v2Turns).where(eq(v2Turns.id, input.sourceTurnId)).limit(1).get()?.startedAt
    if (!startedAt) throw new SocratesError("canonical_source_turn_not_found", "The source task could not be found.")
    const now = nowIso()
    let task = existing
    if (!task) {
      const id = createId("worktask")
      this.handle.db.insert(workTasks).values({
        id,
        projectId: input.projectId,
        goalId: input.goalId,
        sourceRuntime: input.sourceRuntime,
        sourceTurnId: input.sourceTurnId,
        startedAt,
        createdAt: now,
        updatedAt: now,
      }).run()
      task = this.handle.db.select().from(workTasks).where(eq(workTasks.id, id)).get()
    } else if (input.goalId && task.goalId !== input.goalId) {
      this.handle.db.update(workTasks).set({ goalId: input.goalId, updatedAt: now }).where(eq(workTasks.id, task.id)).run()
      task = { ...task, goalId: input.goalId, updatedAt: now }
    }
    if (!task) throw new SocratesError("canonical_task_create_failed", "The canonical task identity could not be saved.")
    this.syncMessages(task)
    if (input.conversationId) {
      this.ensureConversationProjection(input.conversationId, task.id, input.projectionReason ?? "origin")
    }
    if (task.goalId) {
      const homes = this.handle.db.select().from(v2GoalClassicHomes).where(eq(v2GoalClassicHomes.goalId, task.goalId)).all()
      for (const home of homes) this.ensureConversationProjection(home.conversationId, task.id, "goal_home")
    }
    return task
  }

  private findTask(sourceRuntime: WorkSourceRuntime, sourceTurnId: string): WorkTaskRow | undefined {
    return this.handle.db.select().from(workTasks).where(and(
      eq(workTasks.sourceRuntime, sourceRuntime),
      eq(workTasks.sourceTurnId, sourceTurnId),
    )).limit(1).get()
  }

  private syncMessages(task: WorkTaskRow): void {
    const sourceRows = task.sourceRuntime === "classic"
      ? this.handle.db.select({ id: messages.id, role: messages.role, createdAt: messages.createdAt }).from(messages)
          .where(eq(messages.turnId, task.sourceTurnId)).orderBy(asc(messages.createdAt)).all()
      : this.handle.db.select({ id: v2Messages.id, role: v2Messages.role, createdAt: v2Messages.createdAt }).from(v2Messages)
          .where(eq(v2Messages.turnId, task.sourceTurnId)).orderBy(asc(v2Messages.ordinal)).all()
    for (const source of sourceRows) {
      this.handle.db.insert(workMessages).values({
        id: createId("workmsg"),
        taskId: task.id,
        sourceRuntime: task.sourceRuntime,
        sourceMessageId: source.id,
        role: source.role,
        sourceCreatedAt: source.createdAt,
        createdAt: nowIso(),
      }).onConflictDoNothing().run()
    }
  }

  private ensureConversationProjection(
    conversationId: string,
    taskId: string,
    reason: "origin" | "goal_home" | "legacy_bridge",
  ): void {
    const existing = this.handle.db.select({ id: conversationTaskProjections.id }).from(conversationTaskProjections).where(and(
      eq(conversationTaskProjections.conversationId, conversationId),
      eq(conversationTaskProjections.taskId, taskId),
    )).limit(1).get()
    if (existing) return
    const row = this.handle.sqlite.prepare(
      "SELECT COALESCE(MAX(position), 0) + 1 AS position FROM conversation_task_projections WHERE conversation_id = ?",
    ).get(conversationId) as { position: number }
    this.handle.db.insert(conversationTaskProjections).values({
      id: createId("workproj"),
      conversationId,
      taskId,
      position: row.position,
      reason,
      createdAt: nowIso(),
    }).run()
  }

  private readTaskMessages(tasks: WorkTaskRow[]): CanonicalMessageProjection[] {
    if (tasks.length === 0) return []
    for (const task of tasks) this.syncMessages(task)
    const taskById = new Map(tasks.map((task) => [task.id, task]))
    const identities = this.handle.db.select().from(workMessages)
      .where(inArray(workMessages.taskId, tasks.map((task) => task.id)))
      .orderBy(asc(workMessages.sourceCreatedAt), asc(workMessages.createdAt)).all()
    return identities.flatMap((identity): CanonicalMessageProjection[] => {
      const task = taskById.get(identity.taskId)
      if (!task) return []
      if (task.sourceRuntime === "classic") {
        const row = this.handle.db.select().from(messages).where(eq(messages.id, identity.sourceMessageId)).limit(1).get()
        if (!row) return []
        const attachments = this.handle.db.select().from(messageAttachments).where(and(
          eq(messageAttachments.messageId, row.id), eq(messageAttachments.status, "attached"),
        )).orderBy(asc(messageAttachments.createdAt)).all()
        const reasoning = parseReasoning(row.metadataJson)
        return [{
          canonicalTaskId: task.id,
          canonicalMessageId: identity.id,
          projectId: task.projectId,
          ...(task.goalId ? { goalId: task.goalId } : {}),
          sourceRuntime: "classic",
          sourceTurnId: task.sourceTurnId,
          sourceMessageId: row.id,
          role: row.role as Message["role"],
          content: row.content,
          ...(reasoning ? { reasoning } : {}),
          status: row.status as Message["status"],
          ...(row.parentMessageId ? { parentMessageId: row.parentMessageId } : {}),
          createdAt: row.createdAt,
          ...(row.completedAt ? { completedAt: row.completedAt } : {}),
          classicAttachments: attachments.map((attachment) => ({
            id: attachment.id,
            projectId: attachment.projectId,
            conversationId: attachment.conversationId,
            ...(attachment.sessionId ? { sessionId: attachment.sessionId } : {}),
            ...(attachment.turnId ? { turnId: attachment.turnId } : {}),
            ...(attachment.messageId ? { messageId: attachment.messageId } : {}),
            artifactId: attachment.artifactId,
            kind: attachment.kind as MessageAttachment["kind"],
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            uri: attachment.uri,
            url: `/api/projects/${encodeURIComponent(attachment.projectId)}/conversations/${encodeURIComponent(attachment.conversationId)}/attachments/${encodeURIComponent(attachment.id)}/content`,
            status: attachment.status as MessageAttachment["status"],
            createdAt: attachment.createdAt,
          })),
          flowAttachments: attachments.map((attachment) => ({
            id: attachment.id,
            projectId: attachment.projectId,
            flowId: this.flowIdForGoal(task.goalId),
            ...(task.goalId ? { goalId: task.goalId } : {}),
            turnId: task.sourceTurnId,
            messageId: row.id,
            artifactId: attachment.artifactId,
            kind: attachment.kind as V2MessageAttachment["kind"],
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            uri: attachment.uri,
            url: `/api/projects/${encodeURIComponent(attachment.projectId)}/conversations/${encodeURIComponent(attachment.conversationId)}/attachments/${encodeURIComponent(attachment.id)}/content`,
            status: attachment.status as V2MessageAttachment["status"],
            createdAt: attachment.createdAt,
          })),
        }]
      }

      const row = this.handle.db.select().from(v2Messages).where(eq(v2Messages.id, identity.sourceMessageId)).limit(1).get()
      if (!row) return []
      const attachments = this.handle.db.select().from(v2MessageAttachments).where(and(
        eq(v2MessageAttachments.messageId, row.id), eq(v2MessageAttachments.status, "attached"),
      )).orderBy(asc(v2MessageAttachments.createdAt)).all()
      return [{
        canonicalTaskId: task.id,
        canonicalMessageId: identity.id,
        projectId: task.projectId,
        ...(task.goalId ? { goalId: task.goalId } : {}),
        sourceRuntime: "v2_flow",
        sourceTurnId: task.sourceTurnId,
        sourceMessageId: row.id,
        role: row.role as Message["role"],
        content: row.content,
        ...(row.reasoning ? { reasoning: row.reasoning } : {}),
        status: row.status as Message["status"],
        ...(row.parentMessageId ? { parentMessageId: row.parentMessageId } : {}),
        createdAt: row.createdAt,
        ...(row.completedAt ? { completedAt: row.completedAt } : {}),
        classicAttachments: attachments.map((attachment) => ({
          id: attachment.id,
          projectId: attachment.projectId,
          conversationId: "projected",
          ...(attachment.turnId ? { turnId: attachment.turnId } : {}),
          ...(attachment.messageId ? { messageId: attachment.messageId } : {}),
          artifactId: attachment.artifactId,
          kind: (attachment.kind === "audio" ? "text" : attachment.kind) as MessageAttachment["kind"],
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          uri: attachment.uri,
          url: `/api/v2/projects/${encodeURIComponent(attachment.projectId)}/flows/${encodeURIComponent(attachment.flowId)}/attachments/${encodeURIComponent(attachment.id)}/content`,
          status: attachment.status as MessageAttachment["status"],
          createdAt: attachment.createdAt,
        })),
        flowAttachments: attachments.map((attachment) => ({
          id: attachment.id,
          projectId: attachment.projectId,
          flowId: attachment.flowId,
          ...(attachment.goalId ? { goalId: attachment.goalId } : {}),
          ...(attachment.turnId ? { turnId: attachment.turnId } : {}),
          ...(attachment.messageId ? { messageId: attachment.messageId } : {}),
          artifactId: attachment.artifactId,
          kind: attachment.kind as V2MessageAttachment["kind"],
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          uri: attachment.uri,
          url: `/api/v2/projects/${encodeURIComponent(attachment.projectId)}/flows/${encodeURIComponent(attachment.flowId)}/attachments/${encodeURIComponent(attachment.id)}/content`,
          status: attachment.status as V2MessageAttachment["status"],
          createdAt: attachment.createdAt,
        })),
      }]
    })
  }

  private flowIdForGoal(goalId: string | null): string {
    if (!goalId) throw new SocratesError("canonical_goal_missing", "The projected task has no goal.")
    const goal = this.handle.db.select({ flowId: v2Goals.flowId }).from(v2Goals).where(eq(v2Goals.id, goalId)).limit(1).get()
    if (!goal) throw new SocratesError("canonical_goal_not_found", "The projected task goal no longer exists.")
    return goal.flowId
  }
}

export const toClassicProjectedMessage = (
  projection: CanonicalMessageProjection,
  conversationId: string,
  sessionId: string,
): Message => ({
  id: projection.sourceMessageId,
  conversationId,
  sessionId,
  turnId: projection.sourceTurnId,
  role: projection.role,
  content: projection.content,
  ...(projection.reasoning ? { reasoning: projection.reasoning } : {}),
  ...(projection.classicAttachments.length > 0 ? {
    attachments: projection.classicAttachments.map((attachment) => ({ ...attachment, conversationId })),
  } : {}),
  status: projection.status,
  createdAt: projection.createdAt,
})

export const toFlowProjectedMessage = (
  projection: CanonicalMessageProjection,
  flowId: string,
  ordinal: number,
): V2Message => ({
  id: projection.sourceMessageId,
  flowId,
  projectId: projection.projectId,
  ...(projection.goalId ? { goalId: projection.goalId } : {}),
  turnId: projection.sourceTurnId,
  ordinal,
  role: projection.role,
  kind: "standard",
  content: projection.content,
  ...(projection.reasoning ? { reasoning: projection.reasoning } : {}),
  status: projection.status,
  ...(projection.parentMessageId ? { parentMessageId: projection.parentMessageId } : {}),
  ...(projection.flowAttachments.length > 0 ? { attachments: projection.flowAttachments } : {}),
  createdAt: projection.createdAt,
  ...(projection.completedAt ? { completedAt: projection.completedAt } : {}),
})
