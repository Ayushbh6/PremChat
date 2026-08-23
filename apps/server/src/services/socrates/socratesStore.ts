import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import {
  MAX_IMAGE_ATTACHMENT_BYTES,
  MAX_MESSAGE_ATTACHMENT_BYTES,
  MAX_MESSAGE_ATTACHMENTS,
  MAX_SKILL_ZIP_ATTACHMENT_BYTES,
  MAX_TEXT_ATTACHMENT_BYTES,
  type GoalFinalization,
  SOCRATES_MESSAGE_PAGE_MAX,
  SOCRATES_GOAL_PAGE_SIZE,
  SOCRATES_SNAPSHOT_MESSAGE_LIMIT,
  SOCRATES_GOAL_EXCHANGE_PAGE_MAX,
  SOCRATES_GOAL_EXCHANGE_PAGE_SIZE,
  SOCRATES_GOAL_EXCHANGE_WORK_ITEM_MAX,
  SOCRATES_GLOBAL_HISTORY_SEARCH_MAX,
  type SocratesAgentTask,
  type SocratesApproval,
  type TerminalWaitWakeOn,
  type WaitToolInput,
  type SocratesArtifact,
  type SocratesCreateSpeechJobRequest,
  type SocratesCredentialInputRequest,
  type SocratesErrorRecord,
  type SocratesEvidenceItem,
  type SocratesFeedback,
  type SocratesState,
  type SocratesSnapshot,
  type SocratesLiveActivity,
  type SocratesGoal,
  type SocratesGoalExchange,
  type SocratesGoalExchangeEvidenceDisclosure,
  type SocratesListGoalExchangesResponse,
  type SocratesGoalWindow,
  type SocratesGoalCapsule,
  type SocratesGoalMessageLink,
  type SocratesGoalRoutingRun,
  type SocratesGoalTransition,
  type SocratesGoalRouterOutput,
  type SocratesMessage,
  type SocratesMessageAttachment,
  type SocratesMessageWindow,
  type SocratesListGlobalGoalsResponse,
  type SocratesSearchGlobalHistoryResponse,
  type SocratesModelCall,
  type SocratesRuntimeConfig,
  type SocratesRuntimeEvent,
  type SocratesSpeechJob,
  type SocratesTerminal,
  type SocratesToolCall,
  type SocratesTurn,
  type SocratesUsageEvent,
  socratesLiveActivityUpdatedPayloadSchema,
  socratesRuntimeConfigSchema,
} from "@socrates/contracts"
import type { SocratesSpeechArtifactContent, SocratesSpeechJobUpdate } from "../../routes/socratesSpeechRoutes"
import type {
  ImmutableEvidenceRecord,
  ActiveGoalCard,
  GoalCandidateCard,
  ReconciliationWatermarkState,
  SocratesGoalRoutingDecision,
  SocratesGoalResolutionResult,
} from "@socrates/core"
import type { ModelMessage } from "@socrates/providers"
import { createId, nowIso, SocratesError } from "@socrates/shared"
import { storeAttachmentFile } from "@socrates/workspace"
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm"
import type { DatabaseHandle } from "../../db/client"
import { fallbackSocratesLiveActivity } from "../../runtime/liveActivity"
import { persistGoalFinalization } from "./goalFinalizationStore"
import { commitValidatedTurnFinalization } from "../turn/validatedTurnFinalization"
import {
  messageAttachments,
  projects,
  projectWorkspaces,
  socratesAgentTasks,
  socratesApprovals,
  socratesArtifacts,
  socratesContextItems,
  socratesCredentialInputRequests,
  socratesDeletionAuthorizations,
  socratesErrors,
  socratesEvidenceItems,
  socratesFeedback,
  globalSocratesState,
  socratesGoalCapsules,
  socratesGoalMessageLinks,
  socratesGoalRoutingRuns,
  socratesGoals,
  socratesGoalTransitions,
  socratesMessageAttachments,
  socratesMessages,
  socratesModelCalls,
  socratesRuntimeEvents,
  socratesSpeechJobs,
  socratesTerminalOutputChunks,
  socratesTerminalSessions,
  socratesToolCalls,
  socratesTurnRuntimeConfigs,
  socratesTurns,
  socratesUsageEvents,
  users,
} from "../../db/schema"

const ACTIVE_TURN_STATUSES = ["queued", "routing", "awaiting_clarification", "running", "waiting"] as const
const ACTIVE_AGENT_TASK_STATUSES = ["running", "waiting", "ready"] as const
const ACTIVE_TERMINAL_STATUSES = ["starting", "running", "awaiting_input", "detached"] as const
const SOCRATES_MODEL_MESSAGE_LOAD_LIMIT = 500
export const SOCRATES_ACTIVE_CONTEXT_ITEM_LOAD_LIMIT = 256

type GoalExchangeLineage = {
  rootTurnId: string
  currentTurnId: string
  turnIds: string[]
  runtimeTaskId?: string
  status: SocratesAgentTask["status"]
  updatedAt: string
  completedAt?: string
}

type GoalExchangeFailure = NonNullable<SocratesGoalExchange["failure"]>

export type SocratesRetrievalParentGroup = Readonly<{
  projectId: string
  parentIds: readonly string[]
}>

export type SocratesTerminalRuntimeRecord = {
  terminal: SocratesTerminal
  projectId: string
  workspacePath: string
  processId?: string
  platform?: string
  shellKind?: string
  shellExecutable?: string
  signal?: string
  autoDetached: boolean
  lastPrompt?: string
  supervisorOutputSequence: number
  modelVisibleOutputSequence: number
  inputMode: "none" | "user"
  metadata: Record<string, unknown>
}

export type SocratesReadyTerminalTask = {
  taskId: string
  terminalId: string
  projectId: string
  goalId: string
  rootTurnId: string
  currentTurnId: string
  runtimeConfig: SocratesRuntimeConfig
  reason: string
  terminalName: string
  terminalStatus: SocratesTerminal["status"]
  exitCode?: number
  wakeEvent: TerminalWaitWakeOn
  suspendedTurn: SocratesTurn
}

export type SocratesContinuedTerminalTask = SocratesReadyTerminalTask & {
  turn: SocratesTurn
  userMessage: SocratesMessage
  runtimeConfigId: string
  wakeContext: string
}

export type SocratesTaskLineage = {
  taskId: string
  rootTurnId: string
  currentTurnId: string
  turnIds: string[]
  status: string
  resumedCount: number
}

export type SocratesTaskReconciliationWatermark = Readonly<{
  state: ReconciliationWatermarkState
  taskStartedAt: string
}>

type UploadedFile = { originalName: string; data: Buffer; mimeType?: string }

export type SocratesExactEvidenceProjection = Readonly<{
  id: string
  goalId?: string
  evidenceRef: Readonly<{
    evidenceId: string
    taskId: string
    sourceType: string
    sourceLocator: string
    contentHash: string
    capturedAt: string
  }>
  disposition: "keep_exact"
  representation: "exact"
  tokenEstimate?: number
  active: true
  priority: number
}>

type CreatedSocratesTurn = {
  state: SocratesState
  turn: SocratesTurn
  userMessage: SocratesMessage
  runtimeConfigId: string
}

type RoutingApplication = {
  routingRun: SocratesGoalRoutingRun
  goal: SocratesGoal
  transition?: SocratesGoalTransition
}

export type SocratesMessagePage = Readonly<{
  messages: SocratesMessage[]
  messageWindow: SocratesMessageWindow
}>

export type SocratesGoalPage = Readonly<{
  goals: SocratesGoal[]
  goalWindow: SocratesGoalWindow
}>

export type GoalTransitionContext = Readonly<{
  goalTitle: string
  user: string
  assistant: string
  verifiedOutcome: string
}>

export type SocratesContextCounts = Readonly<{
  immutableEvidenceCount: number
}>

export class GlobalSocratesStore {
  constructor(
    private readonly handle: DatabaseHandle,
    private readonly options: {
      globalWorkspacePath?: string
      getGlobalWorkingRoot?: () => string | undefined
      ensureLocalUser?: () => void
    } = {},
  ) {}

  bootstrap(): SocratesSnapshot {
    this.ensureStateRow()
    return this.getSnapshot()
  }

  getState(): SocratesState {
    return mapSocratesState(this.requireState())
  }

  getSnapshot(): SocratesSnapshot {
    const state = this.requireState()
    const goals = this.handle.db.select().from(socratesGoals)
      .where(sql`${socratesGoals.status} <> 'archived'`)
      .orderBy(desc(socratesGoals.pinned), desc(socratesGoals.lastActiveAt), desc(socratesGoals.ordinal))
      .limit(SOCRATES_GOAL_PAGE_SIZE)
      .all()
    const allGoalCount = this.handle.db.select({ count: sql<number>`count(*)` }).from(socratesGoals)
      .where(sql`${socratesGoals.status} <> 'archived'`).get()?.count ?? 0
    const latestCapsules = goals.flatMap((goal) => {
      const row = this.handle.db.select().from(socratesGoalCapsules).where(eq(socratesGoalCapsules.goalId, goal.id))
        .orderBy(desc(socratesGoalCapsules.version)).limit(1).get()
      return row ? [mapCapsule(row)] : []
    })
    const messageRows = this.handle.db.select().from(socratesMessages).orderBy(desc(socratesMessages.ordinal))
      .limit(SOCRATES_SNAPSHOT_MESSAGE_LIMIT + 1).all().reverse()
    const visibleMessageRows = messageRows.slice(-SOCRATES_SNAPSHOT_MESSAGE_LIMIT)
    const hasEarlier = messageRows.length > SOCRATES_SNAPSHOT_MESSAGE_LIMIT
    const activeTaskRow = state.activeTaskId
      ? this.handle.db.select().from(socratesAgentTasks).where(eq(socratesAgentTasks.id, state.activeTaskId)).limit(1).get()
      : undefined
    const latestTaskRow = this.handle.db.select().from(socratesAgentTasks).orderBy(desc(socratesAgentTasks.updatedAt)).limit(1).get()
    const activeTurnRow = activeTaskRow
      ? this.handle.db.select().from(socratesTurns).where(eq(socratesTurns.id, activeTaskRow.currentTurnId)).limit(1).get()
      : undefined
    const activeTurnId = activeTurnRow?.id
    const visibleWorkTurnId = activeTurnId ?? latestTaskRow?.currentTurnId
    const activeGoalId = activeTurnRow?.goalId ?? state.foregroundGoalId
    const activity = activeTurnId ? this.readLiveActivity(activeTurnId) : undefined
    return {
      state: mapSocratesState(state),
      ...(state.foregroundGoalId
        ? { foregroundGoal: goals.map(mapGoal).find((goal) => goal.id === state.foregroundGoalId)
          ?? this.goalById(state.foregroundGoalId) }
        : {}),
      goals: goals.map(mapGoal),
      globalGoalWindow: {
        totalGoals: Number(allGoalCount),
        hasEarlier: Number(allGoalCount) > goals.length,
        ...(Number(allGoalCount) > goals.length && goals.at(-1)
          ? { beforeCursor: encodeGlobalGoalCursor(goals.at(-1)!) }
          : {}),
      },
      latestCapsules,
      messages: visibleMessageRows.map((row) => mapMessage(row, this.attachmentsForMessage(row.id))),
      messageWindow: {
        hasEarlier,
        ...(hasEarlier && visibleMessageRows[0] ? { beforeOrdinal: visibleMessageRows[0].ordinal } : {}),
      },
      ...(activeTurnRow ? { activeTurn: mapTurn(activeTurnRow) } : {}),
      ...(activeTaskRow ? { activeTask: mapAgentTask(activeTaskRow) } : {}),
      ...(latestTaskRow ? { latestTask: mapAgentTask(latestTaskRow) } : {}),
      ...(activity ? { liveActivity: activity } : activeTurnRow ? {
        liveActivity: fallbackSocratesLiveActivity({
          turn: mapTurn(activeTurnRow),
          tools: this.handle.db.select().from(socratesToolCalls).where(eq(socratesToolCalls.turnId, activeTurnRow.id)).all().map(mapToolCall),
          terminals: this.handle.db.select().from(socratesTerminalSessions).where(eq(socratesTerminalSessions.turnId, activeTurnRow.id)).all().map(mapTerminal),
          hasPendingApproval: Boolean(this.handle.db.select({ id: socratesApprovals.id }).from(socratesApprovals).where(and(
            eq(socratesApprovals.turnId, activeTurnRow.id),
            eq(socratesApprovals.status, "pending"),
          )).limit(1).get()),
        }),
      } : {}),
      canonicalToolCalls: visibleWorkTurnId
        ? this.handle.db.select().from(socratesToolCalls).where(eq(socratesToolCalls.turnId, visibleWorkTurnId)).orderBy(asc(socratesToolCalls.startedAt)).all().map(mapToolCall)
        : [],
      activeTerminals: this.handle.db.select().from(socratesTerminalSessions)
        .where(inArray(socratesTerminalSessions.status, [...ACTIVE_TERMINAL_STATUSES])).orderBy(asc(socratesTerminalSessions.startedAt)).all().map(mapTerminal),
      pendingApprovals: this.handle.db.select().from(socratesApprovals).where(eq(socratesApprovals.status, "pending"))
        .orderBy(asc(socratesApprovals.requestedAt)).all().map(mapApproval),
      pendingCredentialRequests: this.handle.db.select().from(socratesCredentialInputRequests).where(eq(socratesCredentialInputRequests.status, "pending"))
        .orderBy(asc(socratesCredentialInputRequests.requestedAt)).all().map(mapCredentialRequest),
      ...(activeTurnId
        ? (() => {
            const row = this.handle.db.select().from(socratesGoalRoutingRuns).where(and(
              eq(socratesGoalRoutingRuns.turnId, activeTurnId),
              eq(socratesGoalRoutingRuns.status, "awaiting_clarification"),
            )).limit(1).get()
            return row ? { pendingClarification: mapRoutingRun(row) } : {}
          })()
        : {}),
      lastEventSequence: state.lastEventSequence,
    }
  }

  getWorkspacePath(projectId?: string): string {
    const selected = this.options.getGlobalWorkingRoot?.()?.trim()
    if (selected) return path.resolve(selected)
    if (this.options.globalWorkspacePath?.trim()) return path.resolve(this.options.globalWorkspacePath)
    if (projectId) return this.requireWorkspacePath(projectId)
    throw new SocratesError("socrates_working_root_missing", "Choose a working path before starting filesystem work.", { recoverable: true })
  }

  resolveRuntimeProjectId(goalId?: string): string {
    const goalTask = goalId
      ? this.handle.db.select({ projectId: socratesAgentTasks.projectId }).from(socratesAgentTasks)
          .where(eq(socratesAgentTasks.goalId, goalId)).orderBy(desc(socratesAgentTasks.updatedAt)).limit(1).get()
      : undefined
    if (goalTask?.projectId) return goalTask.projectId
    return this.handle.db.select({ projectId: socratesAgentTasks.projectId }).from(socratesAgentTasks)
      .orderBy(desc(socratesAgentTasks.updatedAt)).limit(1).get()?.projectId ?? "global"
  }

  listRuntimeProjectIds(fallbackProjectId?: string): string[] {
    return uniqueStrings([
      ...(fallbackProjectId ? [fallbackProjectId] : []),
      ...this.handle.db.select({ projectId: socratesAgentTasks.projectId }).from(socratesAgentTasks).all().map((row) => row.projectId),
    ])
  }

  getGoalHomeProjectId(goalId: string): string {
    const row = this.handle.db.select({ projectId: socratesTurns.projectId }).from(socratesTurns)
      .where(eq(socratesTurns.goalId, goalId)).orderBy(desc(socratesTurns.startedAt)).limit(1).get()
    if (!row) throw new SocratesError("socrates_goal_project_unknown", "This goal has no task workspace provenance yet.", { recoverable: true })
    return row.projectId
  }

  goalRetrievalParentGroups(goalId: string): SocratesRetrievalParentGroup[] {
    const projectIds = uniqueStrings(this.handle.db.select({ projectId: socratesTurns.projectId }).from(socratesTurns)
      .where(eq(socratesTurns.goalId, goalId)).all().map((row) => row.projectId))
    return projectIds.map((projectId) => ({ projectId, parentIds: [goalId] }))
  }

  goalExchangeRetrievalParentGroups(goalId: string, taskId: string): SocratesRetrievalParentGroup[] {
    const task = this.handle.db.select().from(socratesAgentTasks).where(and(eq(socratesAgentTasks.id, taskId), eq(socratesAgentTasks.goalId, goalId))).limit(1).get()
    return task ? [{ projectId: task.projectId, parentIds: [goalId, task.rootTurnId, task.currentTurnId] }] : []
  }

  listGoals(beforeCursor?: string, limit = SOCRATES_GOAL_PAGE_SIZE): SocratesListGlobalGoalsResponse {
    const boundedLimit = Math.max(1, Math.min(limit, SOCRATES_GOAL_PAGE_SIZE))
    const cursor = beforeCursor ? decodeGlobalGoalCursor(beforeCursor) : undefined
    const allRows = this.handle.db.select().from(socratesGoals).where(sql`${socratesGoals.status} <> 'archived'`).all()
      .sort(compareGlobalGoalRows)
    const eligible = cursor ? allRows.filter((row) => compareGlobalGoalRows(row, cursor) > 0) : allRows
    const rows = eligible.slice(0, boundedLimit)
    const hasEarlier = eligible.length > rows.length
    return {
      goals: rows.map(mapGoal),
      goalWindow: {
        totalGoals: allRows.length,
        hasEarlier,
        ...(hasEarlier && rows.at(-1) ? { beforeCursor: encodeGlobalGoalCursor(rows.at(-1)!) } : {}),
      },
    }
  }

  listGoalExchanges(goalId: string, beforeOrdinal?: number, limit = SOCRATES_GOAL_EXCHANGE_PAGE_SIZE): SocratesListGoalExchangesResponse {
    const goal = this.requireGoal(goalId)
    const all = this.buildGoalExchanges(goal)
    const eligible = beforeOrdinal === undefined ? all : all.filter((exchange) => exchange.ordinal < beforeOrdinal)
    const boundedLimit = Math.max(1, Math.min(limit, SOCRATES_GOAL_EXCHANGE_PAGE_MAX))
    const exchanges = eligible.slice(0, boundedLimit)
    const hasEarlier = eligible.length > exchanges.length
    return {
      exchanges,
      exchangeWindow: {
        totalExchanges: all.length,
        hasEarlier,
        ...(hasEarlier && exchanges.at(-1) ? { beforeOrdinal: exchanges.at(-1)!.ordinal } : {}),
      },
    }
  }

  searchHistory(query: string, limit = 25): SocratesSearchGlobalHistoryResponse {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) throw new SocratesError("socrates_history_query_required", "Enter something to search for.", { recoverable: true })
    const boundedLimit = Math.max(1, Math.min(limit, SOCRATES_GLOBAL_HISTORY_SEARCH_MAX))
    const goals = this.handle.db.select().from(socratesGoals).all().filter((goal) =>
      `${goal.title}\n${goal.summary ?? ""}`.toLocaleLowerCase().includes(normalized))
    const exchanges = this.handle.db.select().from(socratesGoals).all().flatMap((goal) => this.buildGoalExchanges(goal))
      .filter((exchange) => `${exchange.userMessage.content}\n${exchange.assistantMessage?.content ?? ""}`.toLocaleLowerCase().includes(normalized))
    return { goals: goals.slice(0, boundedLimit).map(mapGoal), exchanges: exchanges.slice(0, boundedLimit), hasMore: goals.length + exchanges.length > boundedLimit * 2 }
  }

  listRecentRoutingTurns(limit = 3): Array<{ goalId?: string; user: string; assistant: string }> {
    return this.routingTurns(undefined, limit)
  }

  listGoalRoutingTurns(goalId: string, limit = 5): Array<{ goalId: string; user: string; assistant: string }> {
    return this.routingTurns(goalId, limit).flatMap((turn) => turn.goalId ? [{ ...turn, goalId: turn.goalId }] : [])
  }

  previousRoutingGoalId(selectedGoalId?: string): string | undefined {
    return this.handle.db.select({ goalId: socratesTurns.goalId }).from(socratesTurns)
      .where(sql`${socratesTurns.goalId} IS NOT NULL`).orderBy(desc(socratesTurns.startedAt)).all()
      .map((row) => row.goalId).find((goalId): goalId is string => Boolean(goalId && goalId !== selectedGoalId))
  }

  getActiveGoalCard(input: { goalId: string; sourceTurnId: string; taskRequest: string }): ActiveGoalCard {
    const goal = this.requireGoal(input.goalId)
    const capsule = this.handle.db.select().from(socratesGoalCapsules).where(eq(socratesGoalCapsules.goalId, goal.id))
      .orderBy(desc(socratesGoalCapsules.version)).limit(1).get()
    return {
      goalId: goal.id,
      title: goal.title,
      state: goal.status,
      note: capsule?.summary ?? `Current goal: ${goal.title}`,
      taskRequest: input.taskRequest,
      taskOrdinal: this.taskOrdinalForTurn(goal.id, input.sourceTurnId),
      ...(goal.summary ? { objective: goal.summary } : {}),
      ...(capsule ? {
        openDecisions: parseJsonArray(capsule.decisionsJson).slice(-5),
        blockers: parseJsonArray(capsule.openQuestionsJson).slice(-5),
      } : {}),
    }
  }

  finalizeGoal(goalId: string, turnId: string, finalization: GoalFinalization): void {
    this.requireGoal(goalId)
    persistGoalFinalization(this.handle, { goalId, turnId, finalization })
  }

  updateGoal(input: {
    goalId: string
    action: "switch" | "pause" | "finish" | "reopen" | "archive" | "pin" | "unpin"
    note?: string
  }): { goal: SocratesGoal; transitions: SocratesGoalTransition[] } {
    const operation = this.handle.sqlite.transaction(() => {
      const state = this.requireState()
      const target = this.requireGoal(input.goalId)
      const now = nowIso()
      const transitions: SocratesGoalTransition[] = []
      if (input.action === "pin" || input.action === "unpin") {
        this.handle.db.update(socratesGoals).set({ pinned: input.action === "pin", updatedAt: now }).where(eq(socratesGoals.id, target.id)).run()
      } else {
        if (input.action === "archive" && this.hasActiveGoalWork(target.id)) {
          throw new SocratesError("socrates_goal_still_active", "Stop this goal's active work before archiving it.", { recoverable: true })
        }
        const foreground = this.handle.db.select().from(socratesGoals).where(eq(socratesGoals.status, "foreground")).limit(1).get()
        const transition = (row: typeof socratesGoals.$inferSelect, toStatus: SocratesGoal["status"], reason: SocratesGoalTransition["reason"], note: string) => {
          if (row.status === toStatus) return
          this.handle.db.update(socratesGoals).set({
            status: toStatus,
            lastActiveAt: toStatus === "foreground" ? now : row.lastActiveAt,
            updatedAt: now,
            completedAt: toStatus === "completed" ? now : toStatus === "foreground" ? null : row.completedAt,
            archivedAt: toStatus === "archived" ? now : toStatus === "foreground" ? null : row.archivedAt,
          }).where(eq(socratesGoals.id, row.id)).run()
          transitions.push(mapTransition(this.insertGoalTransition({
            goalId: row.id,
            fromStatus: row.status as SocratesGoal["status"],
            toStatus,
            reason,
            note,
            createdAt: now,
          })))
        }
        if (input.action === "switch" || input.action === "reopen") {
          if (foreground && foreground.id !== target.id) transition(foreground, "parked", "focus_switch", `Paused while switching to ${target.title}.`)
          transition(target, "foreground", input.action === "reopen" ? "reopened" : "user_intent", input.note ?? `Made ${target.title} current.`)
          this.handle.db.update(globalSocratesState).set({
            foregroundGoalId: target.id,
            revision: sql`${globalSocratesState.revision} + 1`,
            updatedAt: now,
          }).where(eq(globalSocratesState.id, state.id)).run()
        } else if (input.action === "pause" || input.action === "finish") {
          transition(target, input.action === "finish" ? "completed" : "parked", input.action === "finish" ? "completed" : "user_intent", input.note ?? (input.action === "finish" ? "Marked finished by the user." : "Paused by the user."))
        } else if (input.action === "archive") {
          if (target.status === "foreground") throw new SocratesError("socrates_goal_current", "Pause or finish the current goal before archiving it.", { recoverable: true })
          transition(target, "archived", "archived", input.note ?? "Archived by the user.")
          if (state.foregroundGoalId === target.id) {
            this.handle.db.update(globalSocratesState).set({ foregroundGoalId: null, revision: sql`${globalSocratesState.revision} + 1`, updatedAt: now })
              .where(eq(globalSocratesState.id, state.id)).run()
          }
        }
      }
      return { goal: mapGoal(this.requireGoal(target.id)), transitions }
    })
    return operation()
  }

  archiveDormantGoals(now = new Date()): SocratesGoal[] {
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000).toISOString()
    return this.handle.db.select().from(socratesGoals).where(and(
      eq(socratesGoals.status, "parked"),
      eq(socratesGoals.kind, "work"),
      eq(socratesGoals.pinned, false),
      lt(socratesGoals.lastActiveAt, cutoff),
    )).all().filter((goal) => !this.hasActiveGoalWork(goal.id))
      .map((goal) => this.updateGoal({ goalId: goal.id, action: "archive", note: "Auto-archived after seven inactive days." }).goal)
  }

  deleteTurn(turnId: string): { deletedTurnId: string } {
    const turn = this.requireTurn(turnId)
    if (ACTIVE_TURN_STATUSES.includes(turn.status as (typeof ACTIVE_TURN_STATUSES)[number])) {
      throw new SocratesError("socrates_turn_still_active", "Stop this work before deleting it.", { recoverable: true })
    }
    this.handle.sqlite.transaction(() => this.deleteSocratesTurnsWithinTransaction([turnId]))()
    return { deletedTurnId: turnId }
  }

  deleteGoal(goalId: string): { deletedGoalId: string; fallbackGoalId?: string } {
    const goal = this.requireGoal(goalId)
    if (this.hasActiveGoalWork(goalId)) throw new SocratesError("socrates_goal_still_active", "Stop this goal before deleting it.", { recoverable: true })
    const state = this.requireState()
    const fallback = this.handle.db.select().from(socratesGoals)
      .where(and(sql`${socratesGoals.id} <> ${goalId}`, sql`${socratesGoals.status} <> 'archived'`))
      .orderBy(desc(socratesGoals.lastActiveAt)).limit(1).get()
    const turnIds = this.handle.db.select({ id: socratesTurns.id }).from(socratesTurns).where(eq(socratesTurns.goalId, goalId)).all().map((row) => row.id)
    this.handle.sqlite.transaction(() => {
      this.deleteSocratesTurnsWithinTransaction(turnIds)
      this.authorizeEvidenceDeletion("goal", goalId)
      for (const table of [
        "v2_context_dispositions", "v2_context_items", "v2_evidence_items", "v2_goal_capsules",
        "v2_goal_message_links", "v2_goal_transitions", "v2_runtime_events", "v2_model_calls",
        "v2_usage_events", "v2_tool_calls", "v2_approvals", "v2_terminal_sessions", "v2_errors",
        "v2_artifacts", "v2_agent_tasks", "v2_speech_jobs", "v2_feedback", "v2_credential_input_requests",
        "v2_message_attachments", "v2_messages",
      ]) this.handle.sqlite.prepare(`DELETE FROM ${table} WHERE goal_id = ?`).run(goalId)
      this.handle.sqlite.prepare("DELETE FROM v2_goal_routing_runs WHERE selected_goal_id = ? OR foreground_goal_id = ?").run(goalId, goalId)
      this.handle.sqlite.prepare("DELETE FROM v2_goals WHERE id = ?").run(goalId)
      this.handle.sqlite.prepare("DELETE FROM v2_deletion_authorizations WHERE target_kind = 'goal' AND target_id = ?").run(goalId)
      if (state.foregroundGoalId === goalId) {
        this.handle.db.update(globalSocratesState).set({
          foregroundGoalId: fallback?.id ?? null,
          revision: sql`${globalSocratesState.revision} + 1`,
          updatedAt: nowIso(),
        }).where(eq(globalSocratesState.id, state.id)).run()
      }
    })()
    return { deletedGoalId: goalId, ...(fallback ? { fallbackGoalId: fallback.id } : {}) }
  }

  deleteGoalExchange(goalId: string, taskId: string): { deletedTaskId: string; deletedGoalId: string } {
    this.requireGoal(goalId)
    const task = this.handle.db.select().from(socratesAgentTasks).where(and(eq(socratesAgentTasks.id, taskId), eq(socratesAgentTasks.goalId, goalId))).limit(1).get()
    if (!task) throw new SocratesError("socrates_goal_exchange_not_found", "Exact exchange not found.", { recoverable: true })
    if (!["completed", "failed", "cancelled"].includes(task.status)) {
      throw new SocratesError("socrates_goal_exchange_still_active", "Stop this work before deleting its exchange.", { recoverable: true })
    }
    const lineage = this.goalExchangeLineage(task)
    this.handle.sqlite.transaction(() => this.deleteSocratesTurnsWithinTransaction(lineage.turnIds))()
    return { deletedTaskId: taskId, deletedGoalId: goalId }
  }

  private readLiveActivity(turnId: string): SocratesLiveActivity | undefined {
    const row = this.handle.db.select({ payloadJson: socratesRuntimeEvents.payloadJson }).from(socratesRuntimeEvents)
      .where(and(eq(socratesRuntimeEvents.turnId, turnId), eq(socratesRuntimeEvents.type, "socrates.activity.updated")))
      .orderBy(desc(socratesRuntimeEvents.sequence)).limit(1).get()
    if (!row) return undefined
    const parsed = socratesLiveActivityUpdatedPayloadSchema.safeParse(parseJson(row.payloadJson))
    return parsed.success ? parsed.data.activity : undefined
  }

  getTurn(turnId: string): SocratesTurn {
    return mapTurn(this.requireTurn(turnId))
  }

  createDraftAttachments(inputs: UploadedFile[]): SocratesMessageAttachment[] {
    validateAttachmentBatch(inputs)
    const state = this.getState()
    const projectId = this.resolveRuntimeProjectId(state.foregroundGoalId)
    const workspacePath = this.getWorkspacePath(projectId)
    const now = nowIso()
    const ids: string[] = []
    for (const input of inputs) {
      const mimeType = normalizeMimeType(input.mimeType, input.originalName)
      const kind = attachmentKind(mimeType)
      if (!kind) {
        throw new SocratesError("attachment_type_not_supported", "Socrates attachments support images, plain-text files, and Agent Skill ZIPs only.", {
          details: { fileName: input.originalName, mimeType },
          recoverable: true,
        })
      }
      validateAttachmentSize(kind, input)
      const stored = storeAttachmentFile({ workspacePath, originalName: input.originalName, data: input.data })
      const artifactId = createId("v2art")
      const attachmentId = createId("v2att")
      const hash = crypto.createHash("sha256").update(input.data).digest("hex")
      this.handle.db.insert(socratesArtifacts).values({
        id: artifactId,
        projectId,
        kind: "message_attachment",
        path: stored.path,
        uri: stored.path,
        contentHash: hash,
        mimeType,
        sizeBytes: input.data.byteLength,
        createdAt: now,
      }).run()
      this.handle.db.insert(socratesMessageAttachments).values({
        id: attachmentId,
        projectId,
        artifactId,
        kind,
        fileName: stored.fileName,
        mimeType,
        sizeBytes: input.data.byteLength,
        uri: stored.path,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      }).run()
      ids.push(attachmentId)
    }
    return this.getAttachments(projectId, ids)
  }

  getAttachmentContent(attachmentId: string): SocratesMessageAttachment {
    const row = this.handle.db
      .select()
      .from(socratesMessageAttachments)
      .where(eq(socratesMessageAttachments.id, attachmentId))
      .limit(1)
      .get()
    if (!row || row.status === "deleted") throw new SocratesError("attachment_not_found", "Socrates attachment not found.", { recoverable: true })
    return mapAttachment(row)
  }

  readCurrentTurnSkillZip(input: {
    projectId: string
    turnId: string
    attachmentPath: string
  }): { filename: string; data: Buffer } {
    this.requireTurn(input.turnId)
    const requested = normalizeSocratesAttachmentReference(input.attachmentPath)
    const rows = this.handle.db
      .select()
      .from(socratesMessageAttachments)
      .where(
        and(
          eq(socratesMessageAttachments.projectId, input.projectId),
          eq(socratesMessageAttachments.turnId, input.turnId),
          eq(socratesMessageAttachments.status, "attached"),
          eq(socratesMessageAttachments.kind, "skill_zip"),
        ),
      )
      .all()
    const row = rows.find((candidate) => normalizeSocratesAttachmentReference(candidate.uri) === requested)
    if (!row) {
      throw new SocratesError(
        "skill_import_attachment_not_found",
        "The Agent Skill ZIP was not attached to the current Socrates message.",
        { recoverable: true },
      )
    }
    const data = fs.readFileSync(row.uri)
    if (data.length > MAX_SKILL_ZIP_ATTACHMENT_BYTES) {
      throw new SocratesError("attachment_too_large", "Agent Skill ZIP attachments must be 20 MB or smaller.", { recoverable: true })
    }
    return { filename: row.fileName, data }
  }

  getTurnMemorySource(turnId: string): {
    messageId?: string
    messageExcerpt?: string
  } {
    const turn = this.requireTurn(turnId)
    const task = this.handle.db.select().from(socratesAgentTasks).where(eq(socratesAgentTasks.currentTurnId, turnId)).limit(1).get()
    const rootTurn = !turn.userMessageId && task
      ? this.handle.db.select().from(socratesTurns).where(eq(socratesTurns.id, task.rootTurnId)).limit(1).get()
      : undefined
    const sourceMessageId = turn.userMessageId ?? rootTurn?.userMessageId
    const message = sourceMessageId
      ? this.handle.db.select().from(socratesMessages).where(eq(socratesMessages.id, sourceMessageId)).limit(1).get()
      : undefined
    return {
      ...(message?.id ? { messageId: message.id } : {}),
      ...(message?.content ? { messageExcerpt: truncateInline(message.content, 600) } : {}),
    }
  }

  getTaskLineageForTurn(turnId: string): SocratesTaskLineage {
    const turn = this.requireTurn(turnId)
    const turnMetadata = parseJsonObject(turn.metadataJson)
    const terminalTaskId = typeof turnMetadata.terminalTaskId === "string" ? turnMetadata.terminalTaskId : undefined
    const taskRows = this.handle.db.select().from(socratesAgentTasks).all()
    const task = taskRows.find((candidate) => candidate.id === terminalTaskId)
      ?? taskRows.find((candidate) => candidate.rootTurnId === turnId || candidate.currentTurnId === turnId)
    if (!task) {
      throw new SocratesError("socrates_task_evidence_unavailable", "No Socrates task lifecycle is registered for this turn.", { recoverable: true })
    }
    const turnIds = this.handle.db.select().from(socratesTurns).orderBy(asc(socratesTurns.ordinal)).all().filter((candidate) => {
      if (candidate.id === task.rootTurnId) return true
      return parseJsonObject(candidate.metadataJson).terminalTaskId === task.id
    }).map((candidate) => candidate.id)
    return {
      taskId: task.id,
      rootTurnId: task.rootTurnId,
      currentTurnId: task.currentTurnId,
      turnIds,
      status: task.status,
      resumedCount: Math.max(0, turnIds.length - 1),
    }
  }

  getTaskReconciliationWatermark(turnId: string): SocratesTaskReconciliationWatermark | undefined {
    const task = this.handle.db.select().from(socratesAgentTasks).where(or(
      eq(socratesAgentTasks.rootTurnId, turnId),
      eq(socratesAgentTasks.currentTurnId, turnId),
    )).limit(1).get()
    if (!task) return undefined
    const metadata = parseJsonObject(task.metadataJson)
    const stored = parseReconciliationWatermark(metadata.reconciliationWatermark)
    return {
      state: stored ?? {
        lastReconciledEvidenceSequence: 0,
        lastObservedEvidenceSequence: 0,
        lastCheckpointAt: task.createdAt,
        lastVerifiedMutationBoundary: 0,
      },
      taskStartedAt: task.createdAt,
    }
  }

  saveTaskReconciliationWatermark(turnId: string, state: ReconciliationWatermarkState): void {
    const task = this.handle.db.select().from(socratesAgentTasks).where(or(
      eq(socratesAgentTasks.rootTurnId, turnId),
      eq(socratesAgentTasks.currentTurnId, turnId),
    )).limit(1).get()
    if (!task) throw new SocratesError("socrates_task_not_found", "The Socrates task reconciliation watermark could not be saved.")
    this.handle.db.update(socratesAgentTasks).set({
      metadataJson: JSON.stringify({ ...parseJsonObject(task.metadataJson), reconciliationWatermark: state }),
      updatedAt: nowIso(),
    }).where(eq(socratesAgentTasks.id, task.id)).run()
  }

  createTurn(input: {
    projectId: string
    clientMessageId: string
    content: string
    attachmentIds?: string[]
    runtimeConfig: SocratesRuntimeConfig
  }): CreatedSocratesTurn {
    const operation = this.handle.sqlite.transaction(() => {
      const state = this.requireState()
      const duplicate = this.handle.db.select().from(socratesMessages).where(eq(socratesMessages.id, input.clientMessageId)).limit(1).get()
      if (duplicate) {
        if (!duplicate.turnId) {
          throw new SocratesError("v2_client_message_conflict", "That client message id is already in use.", { recoverable: true })
        }
        const existingTurn = this.handle.db.select().from(socratesTurns).where(eq(socratesTurns.id, duplicate.turnId)).limit(1).get()
        const runtimeRow = existingTurn
          ? this.handle.db.select().from(socratesTurnRuntimeConfigs).where(eq(socratesTurnRuntimeConfigs.turnId, existingTurn.id)).limit(1).get()
          : undefined
        if (!existingTurn || !runtimeRow) throw new SocratesError("socrates_turn_recovery_failed", "The existing Socrates turn is incomplete.")
        return { state: mapSocratesState(state), turn: mapTurn(existingTurn), userMessage: mapMessage(duplicate), runtimeConfigId: runtimeRow.id }
      }
      const active = this.handle.db
        .select({ id: socratesTurns.id })
        .from(socratesTurns)
        .where(inArray(socratesTurns.status, [...ACTIVE_TURN_STATUSES]))
        .limit(1)
        .get()
      if (active) {
        throw new SocratesError("socrates_turn_already_active", "Socrates is already working. Send a follow-up after it finishes.", {
          details: { activeTurnId: active.id },
          recoverable: true,
        })
      }
      const attachmentIds = uniqueStrings(input.attachmentIds ?? [])
      if (!input.content.trim() && attachmentIds.length === 0) {
        throw new SocratesError("v2_message_empty", "Write a message or attach a file before sending.", { recoverable: true })
      }
      if (attachmentIds.length > MAX_MESSAGE_ATTACHMENTS) {
        throw new SocratesError("attachment_upload_limit_exceeded", `Attach up to ${MAX_MESSAGE_ATTACHMENTS} files to one message.`, { recoverable: true })
      }
      const attachmentRows = attachmentIds.length === 0
        ? []
        : this.handle.db.select().from(socratesMessageAttachments).where(and(
            eq(socratesMessageAttachments.projectId, input.projectId),
            inArray(socratesMessageAttachments.id, attachmentIds),
          )).all()
      if (attachmentRows.length !== attachmentIds.length || attachmentRows.some((row) => row.status !== "draft")) {
        throw new SocratesError("attachment_not_attachable", "One or more Socrates attachments are missing or already used.", { recoverable: true })
      }
      const totalBytes = attachmentRows.reduce((sum, row) => sum + row.sizeBytes, 0)
      if (totalBytes > MAX_MESSAGE_ATTACHMENT_BYTES) {
        throw new SocratesError("attachment_total_too_large", "Attachments for one message must be 20 MB or smaller in total.", { recoverable: true })
      }
      const now = nowIso()
      const turnId = createId("v2turn")
      const runtimeConfigId = createId("v2trc")
      const turnOrdinal = this.nextGlobalInteger("v2_turns", "ordinal")
      const messageOrdinal = this.nextGlobalInteger("v2_messages", "ordinal")
      this.handle.db.insert(socratesTurns).values({
        id: turnId,
        projectId: input.projectId,
        ordinal: turnOrdinal,
        userMessageId: input.clientMessageId,
        status: "routing",
        startedAt: now,
        updatedAt: now,
      }).run()
      this.handle.db.insert(socratesTurnRuntimeConfigs).values({
        id: runtimeConfigId,
        turnId,
        providerId: input.runtimeConfig.providerId,
        authMode: input.runtimeConfig.authMode ?? "api_key",
        modelId: input.runtimeConfig.modelId,
        thinkingEnabled: input.runtimeConfig.thinkingEnabled,
        thinkingEffort: input.runtimeConfig.thinkingEffort,
        approvalMode: input.runtimeConfig.approvalMode,
        sandboxMode: input.runtimeConfig.sandboxMode,
        contextWindowTokens: input.runtimeConfig.contextWindowTokens,
        createdAt: now,
      }).run()
      this.handle.db.insert(socratesMessages).values({
        id: input.clientMessageId,
        projectId: input.projectId,
        turnId,
        ordinal: messageOrdinal,
        role: "user",
        content: input.content,
        status: "completed",
        createdAt: now,
        completedAt: now,
      }).run()
      for (const row of attachmentRows) {
        this.handle.db.update(socratesMessageAttachments).set({ turnId, messageId: input.clientMessageId, status: "attached", updatedAt: now }).where(eq(socratesMessageAttachments.id, row.id)).run()
        this.handle.db.update(socratesArtifacts).set({ turnId }).where(eq(socratesArtifacts.id, row.artifactId)).run()
      }
      const taskId = createId("socratask")
      this.handle.db.insert(socratesAgentTasks).values({
        id: taskId,
        projectId: input.projectId,
        rootTurnId: turnId,
        currentTurnId: turnId,
        status: "running",
        runtimeConfigJson: JSON.stringify(input.runtimeConfig),
        waitingOnTerminalIdsJson: "[]",
        createdAt: now,
        updatedAt: now,
      }).run()
      this.handle.db.update(globalSocratesState).set({ activeTaskId: taskId, revision: sql`${globalSocratesState.revision} + 1`, updatedAt: now })
        .where(eq(globalSocratesState.id, state.id)).run()
      const turnRow = this.handle.db.select().from(socratesTurns).where(eq(socratesTurns.id, turnId)).get()
      const messageRow = this.handle.db.select().from(socratesMessages).where(eq(socratesMessages.id, input.clientMessageId)).get()
      const updatedState = this.requireState()
      if (!turnRow || !messageRow) throw new SocratesError("socrates_turn_create_failed", "The Socrates turn could not be created.")
      return {
        state: mapSocratesState(updatedState),
        turn: mapTurn(turnRow),
        userMessage: mapMessage(messageRow, attachmentRows.map(mapAttachment)),
        runtimeConfigId,
      }
    })
    return operation()
  }

  applyRouting(input: {
    projectId: string
    turnId: string
    messageId: string
    messageContent: string
    result: SocratesGoalResolutionResult
    providerId?: string
    modelId?: string
  }): RoutingApplication {
    if (input.result.decision.action === "clarify") throw new SocratesError("socrates_clarification_unresolved", "A clarification must be answered before applying goal routing.")
    return this.handle.sqlite.transaction(() => {
      const state = this.requireState()
      const turn = this.requireTurn(input.turnId)
      if (turn.status !== "routing") throw new SocratesError("socrates_turn_not_routing", "This Socrates turn has already been routed.", { recoverable: true })
      const now = nowIso()
      const routingRunId = this.handle.db.select({ id: socratesGoalRoutingRuns.id }).from(socratesGoalRoutingRuns)
        .where(eq(socratesGoalRoutingRuns.turnId, input.turnId)).limit(1).get()?.id ?? createId("socraroute")
      const goals = this.handle.db.select().from(socratesGoals).orderBy(asc(socratesGoals.ordinal)).all()
      let selectedGoalId = input.result.decision.primaryGoalId
      let createdGoal: typeof socratesGoals.$inferSelect | undefined
      const currentForeground = goals.find((goal) => goal.status === "foreground")
      if (input.result.decision.action === "create") {
        selectedGoalId = createId("socragoal")
        const title = input.result.decision.title?.trim() || deriveGoalTitle(input.messageContent)
        this.handle.db.insert(socratesGoals).values({
          id: selectedGoalId,
          ordinal: this.nextGlobalInteger("v2_goals", "ordinal"),
          title,
          summary: input.messageContent.trim().slice(0, 2_000) || title,
          kind: "work",
          status: currentForeground ? "parked" : "foreground",
          origin: "router",
          priority: 50,
          pinned: false,
          lastActiveAt: now,
          createdAt: now,
          updatedAt: now,
        }).run()
        createdGoal = this.requireGoal(selectedGoalId)
      }
      if (!selectedGoalId) throw new SocratesError("socrates_router_goal_missing", "Socrates did not select a goal.")
      const selectedBefore = goals.find((goal) => goal.id === selectedGoalId)
      if (!createdGoal && !selectedBefore) throw new SocratesError("socrates_router_goal_invalid", "Socrates selected a goal outside the eligible set.")
      const selected = createdGoal ?? selectedBefore!
      if (currentForeground && currentForeground.id !== selected.id) {
        this.handle.db.update(socratesGoals).set({ status: "parked", updatedAt: now }).where(eq(socratesGoals.id, currentForeground.id)).run()
        this.insertGoalTransition({
          goalId: currentForeground.id,
          turnId: input.turnId,
          routingRunId,
          fromStatus: "foreground",
          toStatus: "parked",
          reason: "focus_switch",
          note: `Parked when routing task ${input.turnId}.`,
          createdAt: now,
        })
        this.refreshCapsule(currentForeground.id, input.turnId, now, "parked")
      }
      let primaryTransition: typeof socratesGoalTransitions.$inferSelect | undefined
      if (selected.status !== "foreground") {
        this.handle.db.update(socratesGoals).set({ status: "foreground", lastActiveAt: now, updatedAt: now, completedAt: null, archivedAt: null })
          .where(eq(socratesGoals.id, selected.id)).run()
      }
      if (createdGoal) {
        primaryTransition = this.insertGoalTransition({
          goalId: selected.id,
          turnId: input.turnId,
          routingRunId,
          fromStatus: null,
          toStatus: "foreground",
          reason: "created",
          note: "Created by the same-Socrates goal decision.",
          createdAt: now,
        })
        const summary = buildCapsuleSummary({
          title: selected.title,
          objective: selected.summary ?? selected.title,
          latestRequest: input.messageContent,
          state: "foreground · awaiting first response",
        })
        this.handle.db.insert(socratesGoalCapsules).values({
          id: createId("socracap"),
          goalId: selected.id,
          version: 1,
          status: "active",
          summary,
          decisionsJson: JSON.stringify(extractCapsuleDecisions(input.messageContent)),
          openQuestionsJson: JSON.stringify(extractQuestions(input.messageContent)),
          nextActionsJson: JSON.stringify(["Respond to the latest user request."]),
          evidenceHandlesJson: "[]",
          sourceThroughSequence: 0,
          tokenEstimate: estimateTokens(summary),
          createdByTurnId: input.turnId,
          createdAt: now,
        }).run()
      } else if (selectedBefore?.status !== "foreground") {
        primaryTransition = this.insertGoalTransition({
          goalId: selected.id,
          turnId: input.turnId,
          routingRunId,
          fromStatus: selectedBefore!.status as SocratesGoal["status"],
          toStatus: "foreground",
          reason: "resumed",
          note: `Resumed for task ${input.turnId}.`,
          createdAt: now,
        })
        this.refreshCapsule(selected.id, input.turnId, now, "resumed")
      } else {
        this.handle.db.update(socratesGoals).set({ lastActiveAt: now, updatedAt: now }).where(eq(socratesGoals.id, selected.id)).run()
      }
      const existing = this.handle.db.select().from(socratesGoalRoutingRuns).where(eq(socratesGoalRoutingRuns.id, routingRunId)).limit(1).get()
      const routingValues = {
        projectId: input.projectId,
        turnId: input.turnId,
        messageId: input.messageId,
        foregroundGoalId: state.foregroundGoalId,
        candidateGoalIdsJson: JSON.stringify(input.result.candidates.candidates.map((candidate) => candidate.goal.id)),
        selectedGoalId: selected.id,
        decision: routingDecisionContract(input.result.decision),
        providerId: input.providerId,
        modelId: input.modelId,
        status: input.result.source === "fallback" ? "fallback" : "completed",
        fallbackReason: input.result.fallbackReason,
        completedAt: now,
      }
      if (existing) this.handle.db.update(socratesGoalRoutingRuns).set(routingValues).where(eq(socratesGoalRoutingRuns.id, routingRunId)).run()
      else this.handle.db.insert(socratesGoalRoutingRuns).values({ id: routingRunId, ...routingValues, startedAt: now }).run()
      this.handle.db.update(socratesTurns).set({ goalId: selected.id, status: "running", updatedAt: now }).where(eq(socratesTurns.id, input.turnId)).run()
      this.handle.db.update(socratesMessages).set({ goalId: selected.id }).where(eq(socratesMessages.id, input.messageId)).run()
      this.handle.db.update(socratesMessageAttachments).set({ goalId: selected.id }).where(eq(socratesMessageAttachments.messageId, input.messageId)).run()
      this.handle.db.update(socratesArtifacts).set({ goalId: selected.id }).where(eq(socratesArtifacts.turnId, input.turnId)).run()
      this.handle.db.update(socratesAgentTasks).set({ goalId: selected.id, updatedAt: now }).where(eq(socratesAgentTasks.currentTurnId, input.turnId)).run()
      this.handle.db.insert(socratesGoalMessageLinks).values({
        id: createId("socralink"), goalId: selected.id, messageId: input.messageId, turnId: input.turnId, relation: "primary", createdAt: now,
      }).run()
      this.handle.db.update(globalSocratesState).set({
        foregroundGoalId: selected.id,
        revision: sql`${globalSocratesState.revision} + 1`,
        updatedAt: now,
      }).where(eq(globalSocratesState.id, state.id)).run()
      const routingRow = this.handle.db.select().from(socratesGoalRoutingRuns).where(eq(socratesGoalRoutingRuns.id, routingRunId)).get()
      const goalRow = this.requireGoal(selected.id)
      if (!routingRow) throw new SocratesError("socrates_routing_persist_failed", "The Socrates routing decision could not be persisted.")
      return { routingRun: mapRoutingRun(routingRow), goal: mapGoal(goalRow), ...(primaryTransition ? { transition: mapTransition(primaryTransition) } : {}) }
    })()
  }

  requestRoutingClarification(input: {
    projectId: string
    turnId: string
    messageId: string
    result: SocratesGoalResolutionResult
    providerId?: string
    modelId?: string
  }): { routingRun: SocratesGoalRoutingRun; message: SocratesMessage; turn: SocratesTurn } {
    const decision = input.result.decision
    if (decision.action !== "clarify" || !decision.clarificationQuestion || (decision.clarificationGoalIds?.length ?? 0) < 2) {
      throw new SocratesError("socrates_clarification_invalid", "Socrates did not provide a valid goal clarification.")
    }
    const clarificationQuestion = decision.clarificationQuestion
    return this.handle.sqlite.transaction(() => {
      const state = this.requireState()
      const turn = this.requireTurn(input.turnId)
      if (turn.status !== "routing") throw new SocratesError("socrates_turn_not_routing", "This turn is no longer waiting for routing.", { recoverable: true })
      const now = nowIso()
      const routingRunId = createId("socraroute")
      const assistantMessageId = createId("socramessage")
      this.handle.db.insert(socratesGoalRoutingRuns).values({
        id: routingRunId,
        projectId: input.projectId,
        turnId: input.turnId,
        messageId: input.messageId,
        foregroundGoalId: state.foregroundGoalId,
        candidateGoalIdsJson: JSON.stringify(input.result.candidates.candidates.map((candidate) => candidate.goal.id)),
        decision: "clarify",
        clarificationQuestion,
        clarificationCandidateGoalIdsJson: JSON.stringify(decision.clarificationGoalIds),
        providerId: input.providerId,
        modelId: input.modelId,
        status: "awaiting_clarification",
        startedAt: now,
      }).run()
      this.handle.db.insert(socratesMessages).values({
        id: assistantMessageId,
        projectId: input.projectId,
        turnId: input.turnId,
        ordinal: this.nextGlobalInteger("v2_messages", "ordinal"),
        role: "assistant",
        kind: "routing_clarification",
        content: clarificationQuestion,
        status: "completed",
        parentMessageId: input.messageId,
        createdAt: now,
        completedAt: now,
      }).run()
      this.handle.db.update(socratesTurns).set({ status: "awaiting_clarification", waitingReason: "Waiting for one goal clarification.", updatedAt: now }).where(eq(socratesTurns.id, input.turnId)).run()
      this.handle.db.update(socratesAgentTasks).set({ status: "waiting", updatedAt: now }).where(eq(socratesAgentTasks.currentTurnId, input.turnId)).run()
      const routing = this.handle.db.select().from(socratesGoalRoutingRuns).where(eq(socratesGoalRoutingRuns.id, routingRunId)).get()
      const message = this.handle.db.select().from(socratesMessages).where(eq(socratesMessages.id, assistantMessageId)).get()
      const updatedTurn = this.requireTurn(input.turnId)
      if (!routing || !message) throw new SocratesError("socrates_clarification_persist_failed", "The goal clarification could not be saved.")
      return { routingRun: mapRoutingRun(routing), message: mapMessage(message), turn: mapTurn(updatedTurn) }
    })()
  }

  resolveRoutingClarification(input: {
    routingRunId: string
    answerMessageId: string
    answer: string
  }): { created: CreatedSocratesTurn; routingRun: SocratesGoalRoutingRun; answerMessage: SocratesMessage; clarificationAnswer: string } {
    return this.handle.sqlite.transaction(() => {
      const state = this.requireState()
      const routing = this.handle.db.select().from(socratesGoalRoutingRuns).where(eq(socratesGoalRoutingRuns.id, input.routingRunId)).limit(1).get()
      if (!routing || routing.status !== "awaiting_clarification") throw new SocratesError("socrates_clarification_not_pending", "That goal clarification is no longer pending.", { recoverable: true })
      if (this.handle.db.select({ id: socratesMessages.id }).from(socratesMessages).where(eq(socratesMessages.id, input.answerMessageId)).limit(1).get()) {
        throw new SocratesError("socrates_client_message_conflict", "That client message id is already in use.", { recoverable: true })
      }
      const original = this.handle.db.select().from(socratesMessages).where(eq(socratesMessages.id, routing.messageId)).limit(1).get()
      const runtime = this.handle.db.select().from(socratesTurnRuntimeConfigs).where(eq(socratesTurnRuntimeConfigs.turnId, routing.turnId)).limit(1).get()
      if (!original || !runtime) throw new SocratesError("socrates_clarification_recovery_failed", "The pending turn could not be restored.")
      const now = nowIso()
      this.handle.db.insert(socratesMessages).values({
        id: input.answerMessageId,
        projectId: routing.projectId,
        turnId: routing.turnId,
        ordinal: this.nextGlobalInteger("v2_messages", "ordinal"),
        role: "user",
        kind: "routing_clarification",
        content: input.answer,
        status: "completed",
        createdAt: now,
        completedAt: now,
      }).run()
      this.handle.db.update(socratesGoalRoutingRuns).set({ clarificationAnswerMessageId: input.answerMessageId, status: "running" }).where(eq(socratesGoalRoutingRuns.id, routing.id)).run()
      this.handle.db.update(socratesTurns).set({ status: "routing", waitingReason: null, updatedAt: now }).where(eq(socratesTurns.id, routing.turnId)).run()
      this.handle.db.update(socratesAgentTasks).set({ status: "running", updatedAt: now }).where(eq(socratesAgentTasks.currentTurnId, routing.turnId)).run()
      const answer = this.handle.db.select().from(socratesMessages).where(eq(socratesMessages.id, input.answerMessageId)).get()
      const updatedRouting = this.handle.db.select().from(socratesGoalRoutingRuns).where(eq(socratesGoalRoutingRuns.id, routing.id)).get()
      const turn = this.requireTurn(routing.turnId)
      if (!answer || !updatedRouting) throw new SocratesError("socrates_clarification_resolve_failed", "The clarification answer could not be saved.")
      return {
        created: { state: mapSocratesState(state), turn: mapTurn(turn), userMessage: mapMessage(original), runtimeConfigId: runtime.id },
        routingRun: mapRoutingRun(updatedRouting),
        answerMessage: mapMessage(answer),
        clarificationAnswer: input.answer,
      }
    })()
  }

  listGoalsForResolution(anchorGoalIds: readonly string[] = []): SocratesGoal[] {
    const goals = this.handle.db.select().from(socratesGoals).orderBy(desc(socratesGoals.pinned), desc(socratesGoals.lastActiveAt)).all()
    const byId = new Map(goals.map((goal) => [goal.id, goal]))
    return uniqueStrings([...anchorGoalIds, ...goals.map((goal) => goal.id)])
      .flatMap((goalId) => byId.has(goalId) ? [mapGoal(byId.get(goalId)!)] : []).slice(0, 25)
  }

  listCapsulesForResolution(goalIds?: readonly string[]): SocratesGoalCapsule[] {
    return this.handle.db.select().from(socratesGoalCapsules).where(eq(socratesGoalCapsules.status, "active"))
      .orderBy(asc(socratesGoalCapsules.goalId)).all()
      .filter((capsule) => !goalIds || goalIds.includes(capsule.goalId)).slice(0, 25).map(mapCapsule)
  }

  getRuntimeConfig(turnId: string): { id: string; runtimeConfig: SocratesRuntimeConfig } {
    const row = this.handle.db.select().from(socratesTurnRuntimeConfigs).where(eq(socratesTurnRuntimeConfigs.turnId, turnId)).limit(1).get()
    if (!row) throw new SocratesError("socrates_runtime_config_not_found", "The Socrates turn runtime configuration was not found.")
    return {
      id: row.id,
      runtimeConfig: {
        providerId: row.providerId as SocratesRuntimeConfig["providerId"],
        authMode: row.authMode as SocratesRuntimeConfig["authMode"],
        modelId: row.modelId,
        thinkingEnabled: row.thinkingEnabled,
        ...(row.thinkingEffort ? { thinkingEffort: row.thinkingEffort as NonNullable<SocratesRuntimeConfig["thinkingEffort"]> } : {}),
        approvalMode: row.approvalMode as SocratesRuntimeConfig["approvalMode"],
        sandboxMode: row.sandboxMode as SocratesRuntimeConfig["sandboxMode"],
        ...(row.contextWindowTokens ? { contextWindowTokens: row.contextWindowTokens } : {}),
      },
    }
  }

  getModelMessages(foregroundGoalId: string, includeImageParts = false): ModelMessage[] {
    const rows = this.handle.db.select().from(socratesMessages).where(and(
      inArray(socratesMessages.role, ["user", "assistant", "developer", "system"]),
      eq(socratesMessages.status, "completed"),
      or(eq(socratesMessages.goalId, foregroundGoalId), inArray(socratesMessages.role, ["system", "developer"])),
    )).orderBy(asc(socratesMessages.ordinal)).all().slice(-SOCRATES_MODEL_MESSAGE_LOAD_LIMIT)
    return rows.map((row) => {
      const role = row.role as ModelMessage["role"]
      const attachments = this.attachmentsForMessage(row.id)
      const turnOrdinal = row.turnId
        ? this.handle.db.select({ ordinal: socratesTurns.ordinal }).from(socratesTurns).where(eq(socratesTurns.id, row.turnId)).limit(1).get()?.ordinal
        : undefined
      const base = {
        role,
        content: row.content,
        id: row.id,
        ...(row.turnId ? { turnId: row.turnId } : {}),
        ...(turnOrdinal === undefined ? {} : { turnOrdinal }),
        ...(row.turnId ? { taskOrdinal: this.taskOrdinalForTurn(foregroundGoalId, row.turnId) } : {}),
      } satisfies ModelMessage
      if (attachments.length === 0 || role !== "user") return base
      const images = attachments.filter((attachment) => attachment.kind === "image")
      const manifest = formatSocratesAttachmentReference(attachments)
      if (!includeImageParts || images.length === 0) {
        const omitted = images.length > 0 && !includeImageParts
          ? `[${images.length} image attachment${images.length === 1 ? "" : "s"} retained but not sent because this model does not support vision.]\n`
          : ""
        return { ...base, content: row.content.trim() ? `${row.content}\n\n${omitted}${manifest}` : `${omitted}${manifest}` }
      }
      const parts: ModelMessage["content"] = [{ type: "text", text: [row.content.trim(), manifest].filter(Boolean).join("\n\n") }]
      for (const attachment of images) {
        try {
          const data = fs.readFileSync(attachment.uri)
          parts.push({ type: "image", mediaType: attachment.mimeType, data: `data:${attachment.mimeType};base64,${data.toString("base64")}`, fileName: attachment.fileName })
        } catch {
          // The durable attachment manifest remains available if local bytes are temporarily unreadable.
        }
      }
      return { ...base, content: parts }
    })
  }

  commitValidatedTurn(input: {
    projectId: string
    turnId: string
    content: string
    reasoning?: string
    goalFinalization: GoalFinalization
    persistUsageAndAudit?: (message: SocratesMessage) => void
  }): SocratesMessage {
    let boundGoalId = ""
    let completedAt = ""
    const message = commitValidatedTurnFinalization(this.handle, {
      persistAnswerAndTask: () => {
        const turn = this.requireTurn(input.turnId)
        if (!turn.goalId) throw new SocratesError("socrates_turn_goal_missing", "The Socrates turn has not been assigned to a goal.")
        if (!ACTIVE_TURN_STATUSES.includes(turn.status as (typeof ACTIVE_TURN_STATUSES)[number])) {
          throw new SocratesError("socrates_turn_not_active", "This Socrates turn is no longer active.", { recoverable: true })
        }
        const now = nowIso()
        const messageId = createId("v2msg")
        const ordinal = this.nextGlobalInteger("v2_messages", "ordinal")
        boundGoalId = turn.goalId
        completedAt = now
        const task = this.handle.db.select().from(socratesAgentTasks).where(eq(socratesAgentTasks.currentTurnId, input.turnId)).limit(1).get()
        const rootTurn = task && task.rootTurnId !== turn.id
          ? this.handle.db.select().from(socratesTurns).where(eq(socratesTurns.id, task.rootTurnId)).limit(1).get()
          : undefined
        const parentMessageId = turn.userMessageId ?? rootTurn?.userMessageId
        this.handle.db.insert(socratesMessages).values({
          id: messageId,
          projectId: input.projectId,
          goalId: turn.goalId,
          turnId: input.turnId,
          ordinal,
          role: "assistant",
          content: input.content,
          reasoning: input.reasoning,
          status: "completed",
          parentMessageId,
          createdAt: now,
          completedAt: now,
        }).run()
        this.handle.db.update(socratesTurns).set({ assistantMessageId: messageId, status: "completed", updatedAt: now, completedAt: now }).where(eq(socratesTurns.id, input.turnId)).run()
        this.handle.db.update(socratesAgentTasks).set({ status: "completed", updatedAt: now, completedAt: now }).where(eq(socratesAgentTasks.currentTurnId, input.turnId)).run()
        this.handle.db.update(socratesGoals).set({ lastActiveAt: now, updatedAt: now }).where(eq(socratesGoals.id, turn.goalId)).run()
        this.handle.db.update(globalSocratesState).set({ activeTaskId: null, revision: sql`${globalSocratesState.revision} + 1`, updatedAt: now })
          .where(eq(globalSocratesState.id, "global")).run()
        this.handle.db.insert(socratesGoalMessageLinks).values({
          id: createId("socralink"), goalId: turn.goalId, messageId, turnId: input.turnId, relation: "primary", createdAt: now,
        }).run()
        const row = this.handle.db.select().from(socratesMessages).where(eq(socratesMessages.id, messageId)).get()
        if (!row) throw new SocratesError("socrates_turn_complete_failed", "The Socrates response could not be saved.")
        return mapMessage(row)
      },
      persistBoundGoalAndCapsule: () => {
        this.finalizeGoal(boundGoalId, input.turnId, input.goalFinalization)
        this.refreshCapsule(boundGoalId, input.turnId, completedAt, "turn_completed")
      },
      ...(input.persistUsageAndAudit ? { persistUsageAndAudit: input.persistUsageAndAudit } : {}),
    })
    return message
  }

  failTurn(input: { projectId: string; turnId: string; error: unknown; source?: string }): SocratesErrorRecord {
    const normalized = normalizeUnknownError(input.error)
    const operation = this.handle.sqlite.transaction(() => {
      const turn = this.requireTurn(input.turnId)
      const now = nowIso()
      const error = this.insertError({
        projectId: input.projectId,
        ...(turn.goalId ? { goalId: turn.goalId } : {}),
        turnId: input.turnId,
        source: input.source ?? "main_agent",
        code: normalized.code,
        message: normalized.message,
        ...(normalized.details === undefined ? {} : { details: normalized.details }),
        recoverable: normalized.recoverable,
        ...(normalized.stack ? { stack: normalized.stack } : {}),
      })
      this.handle.db.update(socratesTurns).set({ status: "failed", errorId: error.id, updatedAt: now, failedAt: now }).where(eq(socratesTurns.id, input.turnId)).run()
      this.handle.db.update(socratesAgentTasks).set({ status: "failed", updatedAt: now, completedAt: now }).where(eq(socratesAgentTasks.currentTurnId, input.turnId)).run()
      this.handle.db.update(globalSocratesState).set({ activeTaskId: null, updatedAt: now }).where(eq(globalSocratesState.id, "global")).run()
      if (turn.goalId) this.refreshCapsule(turn.goalId, input.turnId, now, "failed")
      return error
    })
    return operation()
  }

  cancelTurn(turnId: string, reason = "Cancelled by the user."): SocratesTurn {
    const turn = this.requireTurn(turnId)
    if (!ACTIVE_TURN_STATUSES.includes(turn.status as (typeof ACTIVE_TURN_STATUSES)[number])) return mapTurn(turn)
    const now = nowIso()
    const task = this.handle.db.select().from(socratesAgentTasks).where(eq(socratesAgentTasks.currentTurnId, turnId)).limit(1).get()
    const taskTurnIds = task
      ? this.handle.db.select({ id: socratesTurns.id, metadataJson: socratesTurns.metadataJson }).from(socratesTurns)
          .where(eq(socratesTurns.projectId, turn.projectId)).all()
          .filter((row) => row.id === task.rootTurnId || row.id === task.currentTurnId || parseJsonObject(row.metadataJson).terminalTaskId === task.id)
          .map((row) => row.id)
      : [turnId]
    this.handle.sqlite.transaction(() => {
      this.handle.db.update(socratesTurns).set({ status: "cancelled", waitingReason: reason, updatedAt: now, cancelledAt: now }).where(eq(socratesTurns.id, turnId)).run()
      this.handle.db.update(socratesAgentTasks).set({ status: "cancelled", waitingOnTerminalIdsJson: "[]", updatedAt: now, completedAt: now }).where(eq(socratesAgentTasks.currentTurnId, turnId)).run()
      this.handle.db.update(socratesApprovals).set({ status: "cancelled", reason, decidedBy: "user", decidedAt: now }).where(and(
        inArray(socratesApprovals.turnId, taskTurnIds),
        eq(socratesApprovals.status, "pending"),
      )).run()
      this.handle.db.update(socratesToolCalls).set({ status: "failed", completedAt: now }).where(and(
        inArray(socratesToolCalls.turnId, taskTurnIds),
        eq(socratesToolCalls.status, "awaiting_approval"),
      )).run()
      this.handle.db.update(socratesCredentialInputRequests).set({ status: "cancelled", resolvedAt: now }).where(and(
        inArray(socratesCredentialInputRequests.turnId, taskTurnIds),
        eq(socratesCredentialInputRequests.status, "pending"),
      )).run()
      this.handle.db.update(globalSocratesState).set({ activeTaskId: null, revision: sql`${globalSocratesState.revision} + 1`, updatedAt: now }).where(eq(globalSocratesState.id, "global")).run()
      if (turn.goalId) this.refreshCapsule(turn.goalId, turnId, now, "cancelled")
    })()
    const updated = this.handle.db.select().from(socratesTurns).where(eq(socratesTurns.id, turnId)).get()
    if (!updated) throw new SocratesError("socrates_turn_not_found", "Socrates turn not found.")
    return mapTurn(updated)
  }

  recoverInterruptedTurns(reason = "Socrates restarted before this work completed."): number {
    const rows = this.handle.db.select().from(socratesTurns).where(inArray(socratesTurns.status, [...ACTIVE_TURN_STATUSES])).all()
    const now = nowIso()
    let recovered = 0
    for (const row of rows) {
      const task = this.handle.db.select().from(socratesAgentTasks).where(eq(socratesAgentTasks.currentTurnId, row.id)).limit(1).get()
      // A durable Terminal wait is intentionally inactive from the model's
      // perspective. The supervisor reconciliation owns its next transition.
      if (row.status === "waiting" && task?.status === "waiting") continue
      // If the server fell between claiming a wake and launching the next
      // model request, put the same root task back on the ready queue.
      if (task?.status === "running" && task.currentTurnId !== task.rootTurnId) {
        const metadata = parseJsonObject(task.metadataJson)
        const lastWake = parseSocratesTaskReady(metadata.lastWake)
        if (lastWake) {
          this.handle.db.update(socratesTurns).set({
            status: "suspended",
            updatedAt: now,
            completedAt: now,
            metadataJson: JSON.stringify({ ...parseJsonObject(row.metadataJson), recoveredForTerminalResume: true }),
          }).where(eq(socratesTurns.id, row.id)).run()
          this.handle.db.update(socratesAgentTasks).set({
            status: "ready",
            waitingOnTerminalIdsJson: "[]",
            updatedAt: now,
            metadataJson: JSON.stringify({ ...metadata, ready: lastWake }),
          }).where(eq(socratesAgentTasks.id, task.id)).run()
          recovered += 1
          continue
        }
      }
      const error = this.insertError({ projectId: row.projectId, turnId: row.id, source: "recovery", code: "socrates_turn_interrupted", message: reason, recoverable: true })
      this.handle.db.update(socratesTurns).set({ status: "failed", errorId: error.id, updatedAt: now, failedAt: now }).where(eq(socratesTurns.id, row.id)).run()
      this.handle.db.update(socratesAgentTasks).set({ status: "failed", updatedAt: now, completedAt: now }).where(eq(socratesAgentTasks.currentTurnId, row.id)).run()
      recovered += 1
    }
    if (recovered > 0) this.handle.db.update(globalSocratesState).set({ activeTaskId: null, updatedAt: now }).where(eq(globalSocratesState.id, "global")).run()
    return recovered
  }

  appendRuntimeEvent(input: {
    projectId: string
    goalId?: string
    turnId?: string
    type: `socrates.${string}`
    source: string
    payload: unknown
  }): SocratesRuntimeEvent {
    const operation = this.handle.sqlite.transaction(() => {
      const state = this.requireState()
      const now = nowIso()
      this.handle.db.update(globalSocratesState).set({
        lastEventSequence: sql`${globalSocratesState.lastEventSequence} + 1`,
        updatedAt: now,
      }).where(eq(globalSocratesState.id, state.id)).run()
      const sequenceRow = this.handle.db.select({ sequence: globalSocratesState.lastEventSequence }).from(globalSocratesState).where(eq(globalSocratesState.id, state.id)).get()
      if (!sequenceRow) throw new SocratesError("socrates_state_missing", "Global Socrates state is unavailable.")
      const id = createId("socraevent")
      this.handle.db.insert(socratesRuntimeEvents).values({
        id,
        projectId: input.projectId,
        goalId: input.goalId,
        turnId: input.turnId,
        sequence: sequenceRow.sequence,
        type: input.type,
        source: input.source,
        payloadJson: JSON.stringify(input.payload ?? null),
        createdAt: now,
      }).run()
      const row = this.handle.db.select().from(socratesRuntimeEvents).where(eq(socratesRuntimeEvents.id, id)).get()
      if (!row) throw new SocratesError("socrates_event_persist_failed", "The Socrates event could not be persisted.")
      return mapRuntimeEvent(row)
    })
    return operation()
  }

  listRuntimeEvents(afterSequence = 0, limit = 500): SocratesRuntimeEvent[] {
    return this.handle.db
      .select()
      .from(socratesRuntimeEvents)
      .where(sql`${socratesRuntimeEvents.sequence} > ${Math.max(0, afterSequence)}`)
      .orderBy(asc(socratesRuntimeEvents.sequence))
      .limit(Math.max(1, Math.min(2_000, limit)))
      .all()
      .map(mapRuntimeEvent)
  }

  listMessages(beforeOrdinal?: number, limit = SOCRATES_SNAPSHOT_MESSAGE_LIMIT): SocratesMessagePage {
    const boundedLimit = Math.max(1, Math.min(SOCRATES_MESSAGE_PAGE_MAX, Math.floor(limit)))
    const rows = this.handle.db.select().from(socratesMessages)
      .where(beforeOrdinal === undefined ? undefined : lt(socratesMessages.ordinal, beforeOrdinal))
      .orderBy(desc(socratesMessages.ordinal))
      .limit(boundedLimit + 1)
      .all()
    const visible = rows.slice(0, boundedLimit).reverse()
    const hasEarlier = rows.length > boundedLimit
    return {
      messages: visible.map((row) => mapMessage(row, this.attachmentsForMessage(row.id))),
      messageWindow: {
        hasEarlier,
        ...(hasEarlier && visible[0] ? { beforeOrdinal: visible[0].ordinal } : {}),
      },
    }
  }

  createModelCall(input: {
    projectId: string
    goalId?: string
    turnId?: string
    role: SocratesModelCall["role"]
    providerId: string
    modelId: string
    request: unknown
  }): string {
    const id = createId("v2mcall")
    this.handle.db.insert(socratesModelCalls).values({
      id,
      projectId: input.projectId,
      goalId: input.goalId,
      turnId: input.turnId,
      role: input.role,
      providerId: input.providerId,
      modelId: input.modelId,
      status: "running",
      requestJson: JSON.stringify(input.request ?? null),
      startedAt: nowIso(),
    }).run()
    return id
  }

  completeModelCall(input: {
    modelCallId: string
    response?: unknown
    providerResponse?: unknown
    errorId?: string
    cancelled?: boolean
  }): SocratesModelCall {
    const now = nowIso()
    this.handle.db.update(socratesModelCalls).set({
      status: input.cancelled ? "cancelled" : input.errorId ? "failed" : "completed",
      responseJson: input.response === undefined ? undefined : JSON.stringify(input.response),
      providerResponseJson: input.providerResponse === undefined ? undefined : JSON.stringify(input.providerResponse),
      errorId: input.errorId,
      completedAt: now,
    }).where(eq(socratesModelCalls.id, input.modelCallId)).run()
    const row = this.handle.db.select().from(socratesModelCalls).where(eq(socratesModelCalls.id, input.modelCallId)).get()
    if (!row) throw new SocratesError("socrates_model_call_not_found", "Socrates model call not found.")
    return mapModelCall(row)
  }

  recordUsage(input: {
    modelCallId: string
    inputTokens?: number
    outputTokens?: number
    reasoningTokens?: number
    cachedInputTokens?: number
    totalTokens?: number
    costUsd?: number
    raw?: unknown
  }): SocratesUsageEvent {
    const call = this.handle.db.select().from(socratesModelCalls).where(eq(socratesModelCalls.id, input.modelCallId)).get()
    if (!call) throw new SocratesError("socrates_model_call_not_found", "Socrates model call not found.")
    const inputTokens = nonNegative(input.inputTokens)
    const outputTokens = nonNegative(input.outputTokens)
    const reasoningTokens = nonNegative(input.reasoningTokens)
    const cachedInputTokens = nonNegative(input.cachedInputTokens)
    const totalTokens = nonNegative(input.totalTokens ?? inputTokens + outputTokens + reasoningTokens)
    const id = createId("v2usage")
    this.handle.db.insert(socratesUsageEvents).values({
      id,
      projectId: call.projectId,
      goalId: call.goalId,
      turnId: call.turnId,
      modelCallId: call.id,
      providerId: call.providerId,
      modelId: call.modelId,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cachedInputTokens,
      totalTokens,
      costUsd: input.costUsd,
      costSource: input.costUsd === undefined ? "unavailable" : "provider",
      rawUsageJson: input.raw === undefined ? undefined : JSON.stringify(input.raw),
      createdAt: nowIso(),
    }).onConflictDoUpdate({
      target: socratesUsageEvents.modelCallId,
      set: { inputTokens, outputTokens, reasoningTokens, cachedInputTokens, totalTokens, costUsd: input.costUsd, rawUsageJson: input.raw === undefined ? undefined : JSON.stringify(input.raw) },
    }).run()
    const row = this.handle.db.select().from(socratesUsageEvents).where(eq(socratesUsageEvents.modelCallId, call.id)).get()
    if (!row) throw new SocratesError("socrates_usage_persist_failed", "Socrates usage could not be persisted.")
    return mapUsage(row)
  }

  createToolCall(input: {
    id: string
    projectId: string
    goalId?: string
    turnId: string
    modelCallId?: string
    providerToolCallId?: string
    toolName: string
    arguments: unknown
    requiresApproval: boolean
  }): SocratesToolCall {
    this.handle.db.insert(socratesToolCalls).values({
      id: input.id,
      projectId: input.projectId,
      goalId: input.goalId,
      turnId: input.turnId,
      modelCallId: input.modelCallId,
      providerToolCallId: input.providerToolCallId,
      toolName: input.toolName,
      status: input.requiresApproval ? "awaiting_approval" : "running",
      argumentsJson: JSON.stringify(input.arguments ?? null),
      requiresApproval: input.requiresApproval,
      startedAt: nowIso(),
    }).run()
    return this.getToolCall(input.id)
  }

  completeToolCall(toolCallId: string, result: unknown): SocratesToolCall {
    this.handle.db.update(socratesToolCalls).set({ status: "completed", resultJson: JSON.stringify(result ?? null), completedAt: nowIso() }).where(eq(socratesToolCalls.id, toolCallId)).run()
    return this.getToolCall(toolCallId)
  }

  bindContextResultHandle(toolCallId: string, result: string): void {
    const row = this.handle.db.select({ metadataJson: socratesToolCalls.metadataJson }).from(socratesToolCalls)
      .where(eq(socratesToolCalls.id, toolCallId)).limit(1).get()
    if (!row) return
    const previous = parseJsonObject(row.metadataJson)
    this.handle.db.update(socratesToolCalls)
      .set({ metadataJson: JSON.stringify({ ...previous, contextResultHandle: result }) })
      .where(eq(socratesToolCalls.id, toolCallId)).run()
  }

  failToolCall(toolCallId: string, errorId: string): SocratesToolCall {
    this.handle.db.update(socratesToolCalls).set({ status: "failed", errorId, completedAt: nowIso() }).where(eq(socratesToolCalls.id, toolCallId)).run()
    return this.getToolCall(toolCallId)
  }

  recordError(input: {
    projectId: string
    goalId?: string
    turnId?: string
    source: string
    code: string
    message: string
    details?: unknown
    stack?: string
    recoverable: boolean
  }): SocratesErrorRecord {
    return this.insertError(input)
  }

  createApproval(input: {
    id: string
    projectId: string
    goalId?: string
    turnId: string
    toolCallId: string
    actionKind: string
    action: unknown
  }): SocratesApproval {
    const now = nowIso()
    this.handle.db.insert(socratesApprovals).values({
      id: input.id,
      projectId: input.projectId,
      goalId: input.goalId,
      turnId: input.turnId,
      toolCallId: input.toolCallId,
      status: "pending",
      actionKind: input.actionKind,
      actionJson: JSON.stringify(input.action ?? null),
      requestedAt: now,
    }).run()
    this.handle.db.update(socratesToolCalls).set({ approvalId: input.id, status: "awaiting_approval" }).where(eq(socratesToolCalls.id, input.toolCallId)).run()
    const row = this.handle.db.select().from(socratesApprovals).where(eq(socratesApprovals.id, input.id)).get()
    if (!row) throw new SocratesError("socrates_approval_create_failed", "Socrates approval could not be created.")
    return mapApproval(row)
  }

  resolveApproval(approvalId: string, decision: "approved" | "rejected", reason?: string): SocratesApproval {
    const row = this.handle.db.select().from(socratesApprovals).where(eq(socratesApprovals.id, approvalId)).get()
    if (!row) throw new SocratesError("socrates_approval_not_found", "Socrates approval not found.", { recoverable: true })
    if (row.status !== "pending") throw new SocratesError("socrates_approval_already_resolved", "This approval was already resolved.", { recoverable: true })
    const now = nowIso()
    this.handle.db.update(socratesApprovals).set({ status: decision, decision, reason, decidedBy: "user", decidedAt: now }).where(eq(socratesApprovals.id, approvalId)).run()
    if (row.toolCallId) this.handle.db.update(socratesToolCalls).set({ status: decision === "approved" ? "running" : "failed" }).where(eq(socratesToolCalls.id, row.toolCallId)).run()
    return mapApproval(this.handle.db.select().from(socratesApprovals).where(eq(socratesApprovals.id, approvalId)).get() as typeof row)
  }

  createCredentialRequest(input: {
    id: string
    projectId: string
    goalId?: string
    turnId: string
    toolCallId: string
    providerToolCallId?: string
    serverId: string
    serverLabel?: string
    envKey: string
    source: "user_input" | "workspace_env"
  }): SocratesCredentialInputRequest {
    this.handle.db.insert(socratesCredentialInputRequests).values({
      ...input,
      status: "pending",
      requestedAt: nowIso(),
    }).run()
    return this.getCredentialRequest(input.id)
  }

  resolveCredentialRequest(requestId: string, status: "submitted" | "cancelled"): SocratesCredentialInputRequest {
    const request = this.getCredentialRequest(requestId)
    if (request.status !== "pending") throw new SocratesError("socrates_credential_request_resolved", "This credential request was already resolved.", { recoverable: true })
    this.handle.db.update(socratesCredentialInputRequests).set({ status, resolvedAt: nowIso() }).where(eq(socratesCredentialInputRequests.id, requestId)).run()
    return this.getCredentialRequest(requestId)
  }

  submitFeedback(input: {
    projectId: string
    messageId: string
    turnId?: string
    modelCallId?: string
    rating: "thumbs_up" | "thumbs_down"
    reasonCode?: string
    note?: string
  }): SocratesFeedback {
    const message = this.handle.db.select().from(socratesMessages).where(and(eq(socratesMessages.id, input.messageId), eq(socratesMessages.projectId, input.projectId))).get()
    if (!message || message.role !== "assistant") throw new SocratesError("socrates_feedback_message_not_found", "Choose a Socrates response.", { recoverable: true })
    const existing = this.handle.db.select().from(socratesFeedback).where(eq(socratesFeedback.messageId, input.messageId)).get()
    const now = nowIso()
    if (existing) {
      this.handle.db.update(socratesFeedback).set({ rating: input.rating, reasonCode: input.reasonCode, note: input.note, updatedAt: now }).where(eq(socratesFeedback.id, existing.id)).run()
    } else {
      this.handle.db.insert(socratesFeedback).values({
        id: createId("socrafeedback"), projectId: input.projectId, goalId: message.goalId,
        turnId: input.turnId ?? message.turnId, messageId: message.id, modelCallId: input.modelCallId,
        rating: input.rating, reasonCode: input.reasonCode, note: input.note, createdBy: "user", createdAt: now, updatedAt: now,
      }).run()
    }
    const row = this.handle.db.select().from(socratesFeedback).where(eq(socratesFeedback.messageId, input.messageId)).get()
    if (!row) throw new SocratesError("socrates_feedback_persist_failed", "Socrates feedback could not be saved.")
    return mapFeedback(row)
  }

  recordEvidence(input: {
    projectId: string
    goalId?: string
    turnId?: string
    sourceKind: SocratesEvidenceItem["sourceKind"]
    sourceId?: string
    sourceUri?: string
    title: string
    content?: string
    mimeType?: string
    locator?: unknown
    metadata?: Record<string, unknown>
  }): { evidence: SocratesEvidenceItem } {
    const exactContent = input.content ?? ""
    const now = nowIso()
    const evidenceId = createId("socraevidence")
    const contentHash = crypto.createHash("sha256").update(exactContent || input.sourceUri || input.title).digest("hex")
    const handle = `evidence://global/${evidenceId}`
    this.handle.db.insert(socratesEvidenceItems).values({
      id: evidenceId,
      handle,
      projectId: input.projectId,
      goalId: input.goalId,
      turnId: input.turnId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      sourceUri: input.sourceUri,
      title: input.title,
      mimeType: input.mimeType,
      content: input.content,
      contentHash,
      sizeBytes: input.content === undefined ? undefined : Buffer.byteLength(input.content),
      tokenEstimate: input.content === undefined ? undefined : estimateTokens(input.content),
      locatorJson: input.locator === undefined ? undefined : JSON.stringify(input.locator),
      createdAt: now,
      metadataJson: input.metadata === undefined ? undefined : JSON.stringify(input.metadata),
    }).run()
    const evidenceRow = this.handle.db.select().from(socratesEvidenceItems).where(eq(socratesEvidenceItems.id, evidenceId)).get()
    if (!evidenceRow) throw new SocratesError("socrates_evidence_persist_failed", "Socrates evidence could not be saved.")
    return { evidence: mapEvidence(evidenceRow) }
  }

  /** Read-only exact evidence inventory for the active Socrates work disclosure. */
  getExactEvidenceProjections(
    foregroundGoalId?: string,
    limit = SOCRATES_ACTIVE_CONTEXT_ITEM_LOAD_LIMIT,
  ): SocratesExactEvidenceProjection[] {
    const boundedLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(SOCRATES_ACTIVE_CONTEXT_ITEM_LOAD_LIMIT, Math.floor(limit)))
      : SOCRATES_ACTIVE_CONTEXT_ITEM_LOAD_LIMIT
    const rows = this.handle.db
      .select({
        evidenceId: socratesEvidenceItems.id,
        goalId: socratesEvidenceItems.goalId,
        turnId: socratesEvidenceItems.turnId,
        evidenceSourceKind: socratesEvidenceItems.sourceKind,
        evidenceHandle: socratesEvidenceItems.handle,
        evidenceContentHash: socratesEvidenceItems.contentHash,
        evidenceCreatedAt: socratesEvidenceItems.createdAt,
        tokenEstimate: socratesEvidenceItems.tokenEstimate,
      })
      .from(socratesEvidenceItems)
      .where(foregroundGoalId ? or(isNull(socratesEvidenceItems.goalId), eq(socratesEvidenceItems.goalId, foregroundGoalId)) : undefined)
      .orderBy(desc(socratesEvidenceItems.createdAt))
      .limit(boundedLimit)
      .all()
    return rows.map((row, index) => ({
        id: row.evidenceId,
        ...(row.goalId ? { goalId: row.goalId } : {}),
        evidenceRef: {
          evidenceId: row.evidenceId,
          taskId: row.turnId ? this.taskIdForTurn(row.turnId) ?? row.turnId : "global",
          sourceType: row.evidenceSourceKind,
          sourceLocator: row.evidenceHandle,
          contentHash: row.evidenceContentHash,
          capturedAt: row.evidenceCreatedAt,
        },
        disposition: "keep_exact" as const,
        representation: "exact" as const,
        ...(row.tokenEstimate === null ? {} : { tokenEstimate: row.tokenEstimate }),
        active: true as const,
        priority: Math.max(0, 100 - index),
      }))
  }

  getContextCounts(): SocratesContextCounts {
    const row = this.handle.sqlite.prepare(`SELECT COUNT(*) AS immutableEvidenceCount FROM v2_evidence_items`).get() as {
      immutableEvidenceCount: number
    }
    return row
  }

  getLatestEvidenceByMetadata(
    metadata: Readonly<{ kind: string; goalId: string }>,
  ): ImmutableEvidenceRecord | undefined {
    const row = this.handle.db
      .select()
      .from(socratesEvidenceItems)
      .where(and(
        sql`json_extract(${socratesEvidenceItems.metadataJson}, '$.kind') = ${metadata.kind}`,
        sql`json_extract(${socratesEvidenceItems.metadataJson}, '$.goalId') = ${metadata.goalId}`,
      ))
      .orderBy(desc(socratesEvidenceItems.createdAt))
      .limit(1)
      .get()
    return row ? mapCoreEvidence(row) : undefined
  }

  retrieveExactEvidence(evidenceIds: readonly string[]): ImmutableEvidenceRecord[] {
    const ids = uniqueStrings(evidenceIds)
    if (ids.length === 0) return []
    return this.handle.db.select().from(socratesEvidenceItems).where(inArray(socratesEvidenceItems.id, ids)).all().map(mapCoreEvidence)
  }

  createTerminal(input: {
    projectId: string
    goalId?: string
    turnId?: string
    name: string
    command: string
    cwd: string
    workspacePath?: string
    autoDetached?: boolean
    metadata?: Record<string, unknown>
  }): SocratesTerminal {
    const id = createId("v2term")
    const now = nowIso()
    this.handle.db.insert(socratesTerminalSessions).values({
      id, projectId: input.projectId, goalId: input.goalId, turnId: input.turnId,
      workspacePath: input.workspacePath ?? this.requireWorkspacePath(input.projectId), name: input.name, command: input.command, cwd: input.cwd,
      status: "starting", autoDetached: input.autoDetached ?? false, awaitingInput: false, stateVersion: 0, startedAt: now, updatedAt: now,
      metadataJson: JSON.stringify(input.metadata ?? {}),
    }).run()
    return this.getTerminal(id)
  }

  updateTerminal(terminalId: string, patch: Partial<{
    status: SocratesTerminal["status"]
    platform: string
    shellKind: string
    shellExecutable: string
    processId: string
    exitCode: number
    signal: string
    autoDetached: boolean
    awaitingInput: boolean
    lastPrompt: string
    completedAt: string
    name: string
    metadata: Record<string, unknown>
  }>): SocratesTerminal {
    const current = this.handle.db.select().from(socratesTerminalSessions).where(eq(socratesTerminalSessions.id, terminalId)).get()
    if (!current) throw new SocratesError("socrates_terminal_not_found", "Socrates Terminal not found.", { recoverable: true })
    const { metadata, ...columns } = patch
    this.handle.db.update(socratesTerminalSessions).set({
      ...columns,
      ...(metadata ? { metadataJson: JSON.stringify({ ...parseJsonObject(current.metadataJson), ...metadata }) } : {}),
      stateVersion: sql`${socratesTerminalSessions.stateVersion} + 1`,
      updatedAt: nowIso(),
    }).where(eq(socratesTerminalSessions.id, terminalId)).run()
    const row = this.handle.db.select().from(socratesTerminalSessions).where(eq(socratesTerminalSessions.id, terminalId)).get()
    if (!row) throw new SocratesError("socrates_terminal_not_found", "Socrates Terminal not found.", { recoverable: true })
    return mapTerminal(row)
  }

  appendTerminalOutput(terminalId: string, stream: string, text: string, redacted = false): number {
    const terminal = this.handle.db.select().from(socratesTerminalSessions).where(eq(socratesTerminalSessions.id, terminalId)).get()
    if (!terminal) throw new SocratesError("socrates_terminal_not_found", "Socrates Terminal not found.", { recoverable: true })
    const sequence = this.nextInteger("v2_terminal_output_chunks", "sequence", "terminal_session_id", terminalId, 0)
    this.handle.db.insert(socratesTerminalOutputChunks).values({
      id: createId("socratout"), terminalSessionId: terminalId, sequence, stream, text, redacted, createdAt: nowIso(),
    }).run()
    return sequence
  }

  listTerminalRuntimeRecords(activeOnly = false): SocratesTerminalRuntimeRecord[] {
    const rows = this.handle.db.select().from(socratesTerminalSessions).orderBy(asc(socratesTerminalSessions.startedAt)).all()
    return rows
      .filter((row) => !activeOnly || ACTIVE_TERMINAL_STATUSES.includes(row.status as (typeof ACTIVE_TERMINAL_STATUSES)[number]))
      .map(mapTerminalRuntimeRecord)
  }

  findTerminalRuntimeRecord(identifier: string): SocratesTerminalRuntimeRecord | undefined {
    const rows = this.handle.db.select().from(socratesTerminalSessions).orderBy(desc(socratesTerminalSessions.startedAt)).all()
    const exact = rows.find((row) => row.id === identifier || row.processId === identifier)
    if (exact) return mapTerminalRuntimeRecord(exact)
    const byName = rows.filter((row) => row.name === identifier)
    const active = byName.filter((row) => ACTIVE_TERMINAL_STATUSES.includes(row.status as (typeof ACTIVE_TERMINAL_STATUSES)[number]))
    if (active.length === 1 && active[0]) return mapTerminalRuntimeRecord(active[0])
    if (byName.length === 1 && byName[0]) return mapTerminalRuntimeRecord(byName[0])
    return undefined
  }

  terminalOutputSnapshot(terminalId: string, fromSequence = 0, charLimit = 16_000): {
    stdout: string
    stderr: string
    nextSequence: number
    truncated: boolean
    originalLength: number
    returnedLength: number
  } {
    const terminal = this.handle.db.select().from(socratesTerminalSessions).where(eq(socratesTerminalSessions.id, terminalId)).get()
    if (!terminal) throw new SocratesError("socrates_terminal_not_found", "Socrates Terminal not found.", { recoverable: true })
    const chunks = this.handle.db.select().from(socratesTerminalOutputChunks).where(and(
      eq(socratesTerminalOutputChunks.terminalSessionId, terminalId),
      sql`${socratesTerminalOutputChunks.sequence} >= ${Math.max(0, fromSequence)}`,
    )).orderBy(asc(socratesTerminalOutputChunks.sequence)).all()
    const stdoutRaw = chunks.filter((chunk) => !chunk.redacted && chunk.stream !== "stderr" && chunk.stream !== "input").map((chunk) => chunk.text).join("")
    const stderrRaw = chunks.filter((chunk) => !chunk.redacted && chunk.stream === "stderr").map((chunk) => chunk.text).join("")
    const originalLength = stdoutRaw.length + stderrRaw.length
    const bounded = `${stdoutRaw}${stderrRaw}`.slice(0, Math.max(1, charLimit))
    const stdout = bounded.slice(0, Math.min(stdoutRaw.length, bounded.length))
    const stderr = bounded.slice(stdout.length)
    return {
      stdout,
      stderr,
      nextSequence: chunks.length > 0 ? (chunks.at(-1)?.sequence ?? fromSequence - 1) + 1 : fromSequence,
      truncated: bounded.length < originalLength,
      originalLength,
      returnedLength: bounded.length,
    }
  }

  terminalSupervisorCursorForRecovery(terminalId: string, recordedCursor: number): number {
    const durable = this.handle.db.select({ sequence: socratesTerminalOutputChunks.sequence }).from(socratesTerminalOutputChunks)
      .where(eq(socratesTerminalOutputChunks.terminalSessionId, terminalId))
      .orderBy(desc(socratesTerminalOutputChunks.sequence)).limit(1).get()
    return durable ? Math.max(0, recordedCursor) : 0
  }

  setTerminalRuntimeCursors(terminalId: string, patch: { supervisorOutputSequence?: number; modelVisibleOutputSequence?: number }): void {
    const record = this.handle.db.select().from(socratesTerminalSessions).where(eq(socratesTerminalSessions.id, terminalId)).get()
    if (!record) throw new SocratesError("socrates_terminal_not_found", "Socrates Terminal not found.", { recoverable: true })
    this.handle.db.update(socratesTerminalSessions).set({
      metadataJson: JSON.stringify({ ...parseJsonObject(record.metadataJson), ...patch }),
      updatedAt: nowIso(),
    }).where(eq(socratesTerminalSessions.id, terminalId)).run()
  }

  registerTerminalWait(input: {
    projectId: string
    goalId: string
    turnId: string
    wait: WaitToolInput
  }): { status: "waiting" | "already_ready"; message: string } {
    const turn = this.requireTurn(input.turnId)
    const task = this.handle.db.select().from(socratesAgentTasks).where(and(
      eq(socratesAgentTasks.currentTurnId, input.turnId),
      eq(socratesAgentTasks.status, "running"),
    )).limit(1).get()
    if (!task) throw new SocratesError("socrates_agent_task_not_running", "This task can no longer wait for a Terminal.", { recoverable: true })
    const terminals = this.resolveNamedTerminals(input.wait.terminalNames)
    const ready = terminals.find((terminal) => {
      const event = wakeEventForSocratesTerminal(terminal)
      return event ? input.wait.wakeOn.includes(event) : false
    })
    if (ready) return { status: "already_ready", message: `Terminal "${ready.name}" already has a requested event; continue now.` }
    const now = nowIso()
    const metadata = parseJsonObject(task.metadataJson)
    this.handle.sqlite.transaction(() => {
      const changed = this.handle.db.update(socratesAgentTasks).set({
        status: "waiting",
        waitingOnTerminalIdsJson: JSON.stringify(terminals.map((terminal) => terminal.id)),
        updatedAt: now,
        metadataJson: JSON.stringify({
          ...metadata,
          wait: {
            terminalNames: input.wait.terminalNames,
            wakeOn: input.wait.wakeOn,
            reason: input.wait.reason,
            registeredAt: now,
          },
        }),
      }).where(and(eq(socratesAgentTasks.id, task.id), eq(socratesAgentTasks.status, "running"))).run().changes
      if (changed === 0) throw new SocratesError("socrates_agent_task_not_running", "This task can no longer wait for a Terminal.", { recoverable: true })
      this.handle.db.update(socratesTurns).set({
        status: "waiting",
        waitingReason: input.wait.reason,
        updatedAt: now,
        metadataJson: JSON.stringify({ ...parseJsonObject(turn.metadataJson), terminalTaskId: task.id }),
      }).where(eq(socratesTurns.id, input.turnId)).run()
      this.refreshCapsule(input.goalId, input.turnId, now, "waiting")
    })()
    return { status: "waiting", message: "Task suspended until a requested Terminal event occurs." }
  }

  claimTerminalTaskWake(terminalId: string, wakeEvent: TerminalWaitWakeOn): SocratesReadyTerminalTask[] {
    const terminal = this.handle.db.select().from(socratesTerminalSessions).where(eq(socratesTerminalSessions.id, terminalId)).get()
    if (!terminal) return []
    const waiting = this.handle.db.select().from(socratesAgentTasks).where(eq(socratesAgentTasks.status, "waiting")).all()
    const now = nowIso()
    const ready: SocratesReadyTerminalTask[] = []
    this.handle.sqlite.transaction(() => {
      for (const task of waiting) {
        const terminalIds = parseStringArray(task.waitingOnTerminalIdsJson)
        const metadata = parseJsonObject(task.metadataJson)
        const wait = parseSocratesTaskWait(metadata.wait)
        if (!terminalIds.includes(terminalId) || !wait?.wakeOn.includes(wakeEvent)) continue
        const readyMetadata = { terminalId, wakeEvent, reason: wait.reason, wokenAt: now }
        const changed = this.handle.db.update(socratesAgentTasks).set({
          status: "ready",
          waitingOnTerminalIdsJson: "[]",
          updatedAt: now,
          metadataJson: JSON.stringify({ ...metadata, ready: readyMetadata, lastWake: readyMetadata }),
        }).where(and(eq(socratesAgentTasks.id, task.id), eq(socratesAgentTasks.status, "waiting"))).run().changes
        if (changed === 0) continue
        const waitingTurn = this.requireTurn(task.currentTurnId)
        this.handle.db.update(socratesTurns).set({
          status: "suspended",
          updatedAt: now,
          completedAt: now,
          metadataJson: JSON.stringify({ ...parseJsonObject(waitingTurn.metadataJson), terminalTaskId: task.id, wakeEvent }),
        }).where(eq(socratesTurns.id, task.currentTurnId)).run()
        const mapped = this.readyTerminalTask(task.id)
        if (mapped) ready.push(mapped)
      }
    })()
    return ready
  }

  listReadyTerminalTasks(): SocratesReadyTerminalTask[] {
    return this.handle.db.select({ id: socratesAgentTasks.id }).from(socratesAgentTasks).where(eq(socratesAgentTasks.status, "ready")).all()
      .flatMap((row) => this.readyTerminalTask(row.id) ?? [])
  }

  beginTerminalTaskContinuation(task: SocratesReadyTerminalTask): SocratesContinuedTerminalTask | undefined {
    const now = nowIso()
    const turnId = createId("v2turn")
    const runtimeConfigId = createId("v2trc")
    const continued = this.handle.sqlite.transaction(() => {
      const current = this.handle.db.select().from(socratesAgentTasks).where(and(eq(socratesAgentTasks.id, task.taskId), eq(socratesAgentTasks.status, "ready"))).limit(1).get()
      if (!current) return undefined
      const rootTurn = this.requireTurn(task.rootTurnId)
      if (!rootTurn.userMessageId) throw new SocratesError("socrates_task_root_message_missing", "The task root message is unavailable.")
      const userRow = this.handle.db.select().from(socratesMessages).where(eq(socratesMessages.id, rootTurn.userMessageId)).limit(1).get()
      if (!userRow) throw new SocratesError("socrates_task_root_message_missing", "The task root message is unavailable.")
      const ordinal = this.nextGlobalInteger("v2_turns", "ordinal")
      this.handle.db.insert(socratesTurns).values({
        id: turnId,
        projectId: task.projectId,
        goalId: task.goalId,
        ordinal,
        status: "running",
        startedAt: now,
        updatedAt: now,
        metadataJson: JSON.stringify({ resumedFromTurnId: task.currentTurnId, terminalTaskId: task.taskId, wakeEvent: task.wakeEvent }),
      }).run()
      insertSocratesRuntimeConfig(this.handle, runtimeConfigId, turnId, task.runtimeConfig, now)
      const metadata = parseJsonObject(current.metadataJson)
      delete metadata.ready
      this.handle.db.update(socratesAgentTasks).set({
        status: "running",
        currentTurnId: turnId,
        waitingOnTerminalIdsJson: "[]",
        updatedAt: now,
        metadataJson: JSON.stringify({ ...metadata, continuationCount: Number(metadata.continuationCount ?? 0) + 1 }),
      }).where(eq(socratesAgentTasks.id, task.taskId)).run()
      const row = this.handle.db.select().from(socratesTurns).where(eq(socratesTurns.id, turnId)).get()
      if (!row) throw new SocratesError("socrates_task_continuation_failed", "The task continuation could not be created.")
      const terminalRecord = this.findTerminalRuntimeRecord(task.terminalId)
      const output = this.terminalOutputSnapshot(task.terminalId, terminalRecord?.modelVisibleOutputSequence ?? 0, 8_000)
      const wakeContext = [
        `You were waiting for Terminal "${task.terminalName}".`,
        `Wake reason: ${task.wakeEvent}.`,
        `Terminal status: ${task.terminalStatus}${task.exitCode === undefined ? "" : `; exit code ${task.exitCode}`}.`,
        `Wait reason: ${task.reason}.`,
        output.stdout || output.stderr ? `New Terminal output:\n${[output.stdout, output.stderr].filter(Boolean).join("\n")}` : "No new Terminal output was captured.",
        "Continue the same task from this lifecycle evidence. Do not restart already-attempted work.",
      ].join("\n")
      return { turn: mapTurn(row), userMessage: mapMessage(userRow), wakeContext }
    })()
    return continued ? { ...task, ...continued, runtimeConfigId } : undefined
  }

  getArtifact(artifactId: string): SocratesArtifact {
    const row = this.handle.db.select().from(socratesArtifacts).where(eq(socratesArtifacts.id, artifactId)).get()
    if (!row) throw new SocratesError("socrates_artifact_not_found", "Socrates artifact not found.", { recoverable: true })
    return mapArtifact(row)
  }

  createSpeechArtifact(input: {
    goalId?: string
    turnId?: string
    kind: "speech_input" | "speech_output"
    fileName: string
    mimeType: string
    data: Buffer
  }): SocratesArtifact {
    const projectId = this.resolveRuntimeProjectId(input.goalId)
    const stored = storeAttachmentFile({
      workspacePath: this.requireWorkspacePath(projectId),
      originalName: input.fileName,
      data: input.data,
    })
    const id = createId("v2art")
    this.handle.db.insert(socratesArtifacts).values({
      id,
      projectId,
      goalId: input.goalId,
      turnId: input.turnId,
      kind: input.kind,
      path: stored.path,
      uri: stored.path,
      contentHash: crypto.createHash("sha256").update(input.data).digest("hex"),
      mimeType: input.mimeType,
      sizeBytes: input.data.byteLength,
      createdAt: nowIso(),
    }).run()
    return this.getArtifact(id)
  }

  readSpeechArtifact(input: { artifactId: string }): SocratesSpeechArtifactContent {
    const artifact = this.getArtifact(input.artifactId)
    return { artifact, ...(artifact.path ? { path: artifact.path } : {}) }
  }

  createSpeechJob(input: { request: SocratesCreateSpeechJobRequest }): SocratesSpeechJob {
    const id = createId("v2speech")
    const request = input.request
    const projectId = this.resolveRuntimeProjectId(request.goalId)
    this.handle.db.insert(socratesSpeechJobs).values({
      id,
      projectId,
      goalId: request.goalId,
      turnId: request.turnId,
      messageId: request.messageId,
      kind: request.kind,
      engine: request.engine,
      modelId: request.modelId,
      status: "queued",
      inputArtifactId: request.kind === "transcription" ? request.inputArtifactId : undefined,
      inputText: request.kind === "synthesis" ? request.inputText : undefined,
      voiceId: request.kind === "synthesis" ? request.voiceId : undefined,
      speed: request.kind === "synthesis" ? request.speed : undefined,
      language: request.language,
      createdAt: nowIso(),
    }).run()
    return this.getSpeechJob(id)
  }

  updateSpeechJob(input: { jobId: string; update: SocratesSpeechJobUpdate }): SocratesSpeechJob {
    const current = this.getSpeechJob(input.jobId)
    const row = this.handle.db.select({ projectId: socratesSpeechJobs.projectId }).from(socratesSpeechJobs).where(eq(socratesSpeechJobs.id, input.jobId)).get()
    if (!row) throw new SocratesError("socrates_speech_job_not_found", "Socrates speech job not found.", { recoverable: true })
    let errorId: string | undefined
    if (input.update.status === "failed") {
      errorId = this.insertError({
        projectId: row.projectId,
        ...(current.goalId ? { goalId: current.goalId } : {}),
        ...(current.turnId ? { turnId: current.turnId } : {}),
        source: "speech",
        code: input.update.error.code,
        message: input.update.error.message,
        ...(input.update.error.details === undefined ? {} : { details: input.update.error.details }),
        recoverable: input.update.error.recoverable,
      }).id
    }
    this.handle.db.update(socratesSpeechJobs).set({
      status: input.update.status,
      ...("startedAt" in input.update ? { startedAt: input.update.startedAt } : {}),
      ...("completedAt" in input.update ? { completedAt: input.update.completedAt } : {}),
      ...("durationMs" in input.update ? { durationMs: input.update.durationMs } : {}),
      ...("transcriptText" in input.update ? { transcriptText: input.update.transcriptText } : {}),
      ...("outputArtifactId" in input.update ? { outputArtifactId: input.update.outputArtifactId } : {}),
      ...(errorId ? { errorId } : {}),
      ...("usage" in input.update || "providerRaw" in input.update
        ? { metadataJson: JSON.stringify({ ...("usage" in input.update ? { usage: input.update.usage } : {}), ...("providerRaw" in input.update ? { providerRaw: input.update.providerRaw } : {}) }) }
        : {}),
    }).where(eq(socratesSpeechJobs.id, input.jobId)).run()
    return this.getSpeechJob(input.jobId)
  }

  getSpeechJob(jobId: string): SocratesSpeechJob {
    const row = this.handle.db.select().from(socratesSpeechJobs).where(eq(socratesSpeechJobs.id, jobId)).get()
    if (!row) throw new SocratesError("socrates_speech_job_not_found", "Socrates speech job not found.", { recoverable: true })
    return mapSpeechJob(row)
  }

  private getAttachments(projectId: string, ids: string[]): SocratesMessageAttachment[] {
    if (ids.length === 0) return []
    return this.handle.db.select().from(socratesMessageAttachments).where(and(eq(socratesMessageAttachments.projectId, projectId), inArray(socratesMessageAttachments.id, ids))).all().map(mapAttachment)
  }

  private attachmentsForMessage(messageId: string): SocratesMessageAttachment[] {
    return this.handle.db.select().from(socratesMessageAttachments).where(and(
      eq(socratesMessageAttachments.messageId, messageId),
      eq(socratesMessageAttachments.status, "attached"),
    )).orderBy(asc(socratesMessageAttachments.createdAt)).all().map(mapAttachment)
  }

  private getToolCall(id: string): SocratesToolCall {
    const row = this.handle.db.select().from(socratesToolCalls).where(eq(socratesToolCalls.id, id)).get()
    if (!row) throw new SocratesError("socrates_tool_call_not_found", "Socrates tool call not found.")
    return mapToolCall(row)
  }

  private getCredentialRequest(id: string): SocratesCredentialInputRequest {
    const row = this.handle.db.select().from(socratesCredentialInputRequests).where(eq(socratesCredentialInputRequests.id, id)).get()
    if (!row) throw new SocratesError("socrates_credential_request_not_found", "Socrates credential request not found.", { recoverable: true })
    return mapCredentialRequest(row)
  }

  private resolveNamedTerminals(
    names: readonly string[],
  ): Array<typeof socratesTerminalSessions.$inferSelect> {
    const requested = uniqueStrings(names)
    if (requested.length === 0) {
      throw new SocratesError("v2_terminal_wait_empty", "Choose at least one Terminal to wait for.", { recoverable: true })
    }
    const rows = this.handle.db.select().from(socratesTerminalSessions).where(inArray(socratesTerminalSessions.name, requested)).orderBy(desc(socratesTerminalSessions.startedAt)).all()
    return requested.map((name) => {
      const matches = rows.filter((row) => row.name === name)
      const active = matches.filter((row) => ACTIVE_TERMINAL_STATUSES.includes(row.status as (typeof ACTIVE_TERMINAL_STATUSES)[number]))
      const selected = active[0] ?? matches[0]
      if (!selected) {
        throw new SocratesError("socrates_terminal_not_found", `Terminal "${name}" was not found.`, { recoverable: true })
      }
      if (active.length > 1) {
        throw new SocratesError("socrates_terminal_ambiguous", `More than one active Terminal is named "${name}".`, { recoverable: true })
      }
      return selected
    })
  }

  private readyTerminalTask(taskId: string): SocratesReadyTerminalTask | undefined {
    const task = this.handle.db.select().from(socratesAgentTasks).where(and(
      eq(socratesAgentTasks.id, taskId),
      eq(socratesAgentTasks.status, "ready"),
    )).limit(1).get()
    if (!task) return undefined
    const metadata = parseJsonObject(task.metadataJson)
    const ready = parseSocratesTaskReady(metadata.ready)
    if (!ready) return undefined
    const terminal = this.handle.db.select().from(socratesTerminalSessions).where(and(
      eq(socratesTerminalSessions.id, ready.terminalId),
      eq(socratesTerminalSessions.projectId, task.projectId),
    )).limit(1).get()
    const suspendedTurn = this.handle.db.select().from(socratesTurns).where(and(
      eq(socratesTurns.id, task.currentTurnId),
      eq(socratesTurns.projectId, task.projectId),
    )).limit(1).get()
    if (!terminal || !suspendedTurn) return undefined
    const goalId = task.goalId ?? suspendedTurn.goalId
    if (!goalId) return undefined
    const parsedRuntimeConfig = socratesRuntimeConfigSchema.safeParse(parseJson(task.runtimeConfigJson))
    if (!parsedRuntimeConfig.success) return undefined
    return {
      taskId: task.id,
      terminalId: terminal.id,
      projectId: task.projectId,
      goalId,
      rootTurnId: task.rootTurnId,
      currentTurnId: task.currentTurnId,
      runtimeConfig: parsedRuntimeConfig.data,
      reason: ready.reason,
      terminalName: terminal.name,
      terminalStatus: terminal.status as SocratesTerminal["status"],
      ...(terminal.exitCode === null ? {} : { exitCode: terminal.exitCode }),
      wakeEvent: ready.wakeEvent,
      suspendedTurn: mapTurn(suspendedTurn),
    }
  }

  private getTerminal(id: string): SocratesTerminal {
    const row = this.handle.db.select().from(socratesTerminalSessions).where(eq(socratesTerminalSessions.id, id)).get()
    if (!row) throw new SocratesError("socrates_terminal_not_found", "Socrates Terminal not found.", { recoverable: true })
    return mapTerminal(row)
  }

  private authorizeEvidenceDeletion(targetKind: "turn" | "goal" | "task", targetId: string): void {
    this.handle.db.insert(socratesDeletionAuthorizations).values({
      id: createId("v2del"),
      targetKind,
      targetId,
      createdAt: nowIso(),
    }).onConflictDoNothing().run()
  }

  private deleteRowsByIds(table: string, column: string, ids: string[]): void {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return
    const placeholders = unique.map(() => "?").join(", ")
    this.handle.sqlite.prepare(`DELETE FROM ${table} WHERE ${column} IN (${placeholders})`).run(...unique)
  }

  private deleteContextSources(contextIds: string[], evidenceIds: string[], capsuleIds: string[], messageIds: string[] = []): void {
    this.deleteRowsByIds("v2_context_item_sources", "context_item_id", contextIds)
    this.deleteRowsByIds("v2_context_item_sources", "evidence_item_id", evidenceIds)
    this.deleteRowsByIds("v2_context_item_sources", "capsule_id", capsuleIds)
    this.deleteRowsByIds("v2_context_item_sources", "message_id", messageIds)
  }

  private deleteSocratesTurnsWithinTransaction(turnIds: string[]): void {
    const uniqueTurnIds = [...new Set(turnIds)]
    if (uniqueTurnIds.length === 0) return
    const placeholders = uniqueTurnIds.map(() => "?").join(", ")
    const messageIds = this.handle.sqlite.prepare(
      `SELECT id FROM v2_messages WHERE turn_id IN (${placeholders})`,
    ).all(...uniqueTurnIds).map((row) => (row as { id: string }).id)
    const taskIds = this.handle.sqlite.prepare(
      `SELECT id FROM v2_agent_tasks WHERE root_turn_id IN (${placeholders}) OR current_turn_id IN (${placeholders})`,
    ).all(...uniqueTurnIds, ...uniqueTurnIds).map((row) => (row as { id: string }).id)
    const contextIds = this.handle.sqlite.prepare(
      `SELECT id FROM v2_context_items WHERE turn_id IN (${placeholders})`,
    ).all(...uniqueTurnIds).map((row) => (row as { id: string }).id)
    const evidenceIds = this.handle.sqlite.prepare(
      `SELECT id FROM v2_evidence_items WHERE turn_id IN (${placeholders})`,
    ).all(...uniqueTurnIds).map((row) => (row as { id: string }).id)
    const capsuleIds = this.handle.sqlite.prepare(
      `SELECT id FROM v2_goal_capsules WHERE created_by_turn_id IN (${placeholders})`,
    ).all(...uniqueTurnIds).map((row) => (row as { id: string }).id)
    const terminalIds = this.handle.sqlite.prepare(
      `SELECT id FROM v2_terminal_sessions WHERE turn_id IN (${placeholders})`,
    ).all(...uniqueTurnIds).map((row) => (row as { id: string }).id)
    const affectedGoalIds = this.handle.sqlite.prepare(
      `SELECT DISTINCT goal_id AS id FROM v2_turns WHERE id IN (${placeholders}) AND goal_id IS NOT NULL`,
    ).all(...uniqueTurnIds).map((row) => (row as { id: string }).id)

    for (const turnId of uniqueTurnIds) this.authorizeEvidenceDeletion("turn", turnId)
    this.deleteContextSources(contextIds, evidenceIds, capsuleIds, messageIds)
    this.deleteRowsByIds("v2_context_dispositions", "context_item_id", contextIds)
    this.deleteRowsByIds("v2_terminal_output_chunks", "terminal_session_id", terminalIds)
    this.deleteRowsByIds("v2_goal_message_links", "message_id", messageIds)
    this.deleteRowsByIds("v2_feedback", "message_id", messageIds)

    for (const table of [
      "v2_turn_runtime_configs", "v2_goal_routing_runs", "v2_context_dispositions", "v2_context_items",
      "v2_runtime_events", "v2_usage_events", "v2_tool_calls", "v2_approvals", "v2_terminal_sessions",
      "v2_errors", "v2_artifacts", "v2_speech_jobs", "v2_feedback", "v2_credential_input_requests",
      "v2_message_attachments", "v2_model_calls",
    ]) {
      this.deleteRowsByIds(table, "turn_id", uniqueTurnIds)
    }
    this.handle.sqlite.prepare(
      `DELETE FROM v2_agent_tasks WHERE root_turn_id IN (${placeholders}) OR current_turn_id IN (${placeholders})`,
    ).run(...uniqueTurnIds, ...uniqueTurnIds)
    this.deleteRowsByIds("v2_goal_transitions", "turn_id", uniqueTurnIds)
    this.deleteRowsByIds("v2_goal_capsules", "created_by_turn_id", uniqueTurnIds)
    this.deleteRowsByIds("v2_evidence_items", "turn_id", uniqueTurnIds)
    this.deleteRowsByIds("v2_messages", "turn_id", uniqueTurnIds)
    this.deleteRowsByIds("v2_turns", "id", uniqueTurnIds)
    this.deleteRowsByIds("v2_deletion_authorizations", "target_id", uniqueTurnIds)
    this.deleteRowsByIds("v2_goal_capsules", "goal_id", affectedGoalIds)
    const state = this.requireState()
    if (state.activeTaskId && taskIds.includes(state.activeTaskId)) {
      this.handle.db.update(globalSocratesState).set({
        activeTaskId: null,
        revision: sql`${globalSocratesState.revision} + 1`,
        updatedAt: nowIso(),
      }).where(eq(globalSocratesState.id, state.id)).run()
    }
  }

  private hasActiveGoalWork(goalId: string): boolean {
    const activeTurn = this.handle.db.select({ id: socratesTurns.id }).from(socratesTurns).where(and(
      eq(socratesTurns.goalId, goalId),
      inArray(socratesTurns.status, [...ACTIVE_TURN_STATUSES]),
    )).limit(1).get()
    if (activeTurn) return true
    const activeTerminal = this.handle.db.select({ id: socratesTerminalSessions.id }).from(socratesTerminalSessions).where(and(
      eq(socratesTerminalSessions.goalId, goalId),
      inArray(socratesTerminalSessions.status, [...ACTIVE_TERMINAL_STATUSES]),
    )).limit(1).get()
    if (activeTerminal) return true
    return Boolean(this.handle.db.select({ id: socratesApprovals.id }).from(socratesApprovals).where(and(
      eq(socratesApprovals.goalId, goalId),
      eq(socratesApprovals.status, "pending"),
    )).limit(1).get())
  }

  private buildGoalExchanges(goal: typeof socratesGoals.$inferSelect): SocratesGoalExchange[] {
    const chronological = this.handle.db.select().from(socratesAgentTasks).where(eq(socratesAgentTasks.goalId, goal.id)).all()
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .flatMap((task) => {
        const lineage = this.goalExchangeLineage(task)
        const rootTurn = this.handle.db.select().from(socratesTurns).where(eq(socratesTurns.id, lineage.rootTurnId)).limit(1).get()
        const currentTurn = this.handle.db.select().from(socratesTurns).where(eq(socratesTurns.id, lineage.currentTurnId)).limit(1).get()
        const user = rootTurn?.userMessageId
          ? this.handle.db.select().from(socratesMessages).where(eq(socratesMessages.id, rootTurn.userMessageId)).limit(1).get()
          : undefined
        if (!user) return []
        const assistant = currentTurn?.assistantMessageId
          ? this.handle.db.select().from(socratesMessages).where(eq(socratesMessages.id, currentTurn.assistantMessageId)).limit(1).get()
          : undefined
        return [{ task, user, assistant, lineage }]
      })
      .map((entry, index) => ({ ...entry, ordinal: index + 1 }))

    return chronological.reverse()
      .map(({ task, user, assistant, lineage, ordinal }): SocratesGoalExchange => {
        const failure = lineage.status === "failed" ? this.goalExchangeFailure(lineage) : undefined
        const taskToolCalls = this.handle.db.select().from(socratesToolCalls)
          .where(inArray(socratesToolCalls.turnId, lineage.turnIds)).orderBy(asc(socratesToolCalls.startedAt)).all().map(mapToolCall)
        const evidence = this.goalExchangeEvidence(lineage.turnIds)
        const visibleToolCalls = taskToolCalls.slice(0, SOCRATES_GOAL_EXCHANGE_WORK_ITEM_MAX)
        const visibleEvidence = evidence.slice(0, SOCRATES_GOAL_EXCHANGE_WORK_ITEM_MAX)
        return {
          taskId: task.id,
          runtimeTaskId: task.id,
          goalId: goal.id,
          sourceRuntime: "socrates",
          ordinal,
          rootTurnId: lineage.rootTurnId,
          currentTurnId: lineage.currentTurnId,
          turnIds: lineage.turnIds,
          status: lineage.status,
          userMessage: mapMessage(user, this.attachmentsForMessage(user.id)),
          ...(assistant ? { assistantMessage: mapMessage(assistant, this.attachmentsForMessage(assistant.id)) } : {}),
          ...(failure ? { failure } : {}),
          work: {
            toolCalls: visibleToolCalls.map((toolCall) => ({
              id: toolCall.id,
              turnId: toolCall.turnId,
              toolName: toolCall.toolName,
              status: toolCall.status,
              requiresApproval: toolCall.requiresApproval,
              ...(toolCall.startedAt ? { startedAt: toolCall.startedAt } : {}),
              ...(toolCall.completedAt ? { completedAt: toolCall.completedAt } : {}),
            })),
            evidence: visibleEvidence,
            totalToolCalls: taskToolCalls.length,
            totalEvidenceItems: evidence.length,
            hasMore: taskToolCalls.length > visibleToolCalls.length || evidence.length > visibleEvidence.length,
          },
          startedAt: task.createdAt,
          updatedAt: lineage.updatedAt,
          ...(lineage.completedAt ? { completedAt: lineage.completedAt } : {}),
        }
      })
  }

  private goalExchangeEvidence(turnIds: string[]): SocratesGoalExchangeEvidenceDisclosure[] {
    return this.handle.db.select().from(socratesEvidenceItems).where(
      inArray(socratesEvidenceItems.turnId, turnIds),
    ).orderBy(asc(socratesEvidenceItems.createdAt)).all().map((row) => ({
      id: row.id,
      ...(row.turnId ? { turnId: row.turnId } : {}),
      sourceKind: normalizeGoalEvidenceKind(row.sourceKind),
      title: row.title.slice(0, 1_000) || "Evidence",
      ...(row.sourceUri ? { sourceUri: row.sourceUri } : {}),
      ...(row.mimeType ? { mimeType: row.mimeType } : {}),
      ...(row.sizeBytes === null ? {} : { sizeBytes: row.sizeBytes }),
      createdAt: row.createdAt,
    }))
  }

  private goalExchangeLineage(task: typeof socratesAgentTasks.$inferSelect): GoalExchangeLineage {
    const turnRows = this.handle.db.select().from(socratesTurns).where(or(
      eq(socratesTurns.id, task.rootTurnId),
      sql`json_extract(${socratesTurns.metadataJson}, '$.terminalTaskId') = ${task.id}`,
    )).orderBy(asc(socratesTurns.ordinal)).all()
    const turnIds = uniqueStrings([task.rootTurnId, ...turnRows.map((turn) => turn.id), task.currentTurnId])
    const currentTurn = turnRows.find((turn) => turn.id === task.currentTurnId)
      ?? this.handle.db.select().from(socratesTurns).where(eq(socratesTurns.id, task.currentTurnId)).limit(1).get()
    const completedAt = task.completedAt ?? currentTurn?.completedAt ?? currentTurn?.failedAt ?? currentTurn?.cancelledAt
    return {
      rootTurnId: task.rootTurnId,
      currentTurnId: task.currentTurnId,
      turnIds,
      runtimeTaskId: task.id,
      status: normalizeAgentTaskStatus(task.status),
      updatedAt: task.updatedAt,
      ...(completedAt ? { completedAt } : {}),
    }
  }

  private goalExchangeFailure(lineage: GoalExchangeLineage): GoalExchangeFailure | undefined {
    const turnRows = this.handle.db.select({ id: socratesTurns.id, errorId: socratesTurns.errorId })
      .from(socratesTurns).where(inArray(socratesTurns.id, lineage.turnIds)).all()
    const currentTurnErrorId = turnRows.find((turn) => turn.id === lineage.currentTurnId)?.errorId
    const row = currentTurnErrorId
      ? this.handle.db.select().from(socratesErrors).where(eq(socratesErrors.id, currentTurnErrorId)).limit(1).get()
      : this.handle.db.select().from(socratesErrors)
          .where(inArray(socratesErrors.turnId, lineage.turnIds))
          .orderBy(desc(socratesErrors.createdAt)).limit(1).get()
    return row ? toGoalExchangeFailure(row) : undefined
  }

  private requireTurn(turnId: string): typeof socratesTurns.$inferSelect {
    const row = this.handle.db.select().from(socratesTurns).where(eq(socratesTurns.id, turnId)).limit(1).get()
    if (!row) throw new SocratesError("socrates_turn_not_found", "Socrates turn not found.", { recoverable: true })
    return row
  }

  private requireWorkspacePath(projectId: string): string {
    const workingRoot = this.options.getGlobalWorkingRoot?.()
    if (workingRoot) return workingRoot
    const row = this.handle.db.select().from(projectWorkspaces).where(and(eq(projectWorkspaces.projectId, projectId), eq(projectWorkspaces.isPrimary, true), inArray(projectWorkspaces.status, ["active", "missing"]))).limit(1).get()
    if (!row?.path) throw new SocratesError("project_workspace_path_missing", "Project does not have a primary workspace path.", { recoverable: true })
    return row.path
  }

  private nextInteger(table: string, column: string, scopeColumn: string, scopeId: string, initial = 1): number {
    const row = this.handle.sqlite.prepare(`SELECT MAX(${column}) AS value FROM ${table} WHERE ${scopeColumn} = ?`).get(scopeId) as { value: number | null }
    return row.value === null ? initial : row.value + 1
  }

  private nextGlobalInteger(table: string, column: string, initial = 1): number {
    const row = this.handle.sqlite.prepare(`SELECT MAX(${column}) AS value FROM ${table}`).get() as { value: number | null }
    return row.value === null ? initial : row.value + 1
  }

  private ensureStateRow(): void {
    this.options.ensureLocalUser?.()
    const existing = this.handle.db.select({ id: globalSocratesState.id }).from(globalSocratesState).limit(1).get()
    if (existing) return
    const now = nowIso()
    this.handle.db.insert(globalSocratesState).values({
      id: "global",
      revision: 0,
      lastEventSequence: 0,
      createdAt: now,
      updatedAt: now,
    }).run()
  }

  private requireState(): typeof globalSocratesState.$inferSelect {
    this.ensureStateRow()
    const row = this.handle.db.select().from(globalSocratesState).where(eq(globalSocratesState.id, "global")).limit(1).get()
    if (!row) throw new SocratesError("socrates_state_missing", "Global Socrates state is unavailable.")
    return row
  }

  private requireGoal(goalId: string): typeof socratesGoals.$inferSelect {
    const row = this.handle.db.select().from(socratesGoals).where(eq(socratesGoals.id, goalId)).limit(1).get()
    if (!row) throw new SocratesError("socrates_goal_not_found", "Goal not found.", { recoverable: true })
    return row
  }

  private goalById(goalId: string): SocratesGoal | undefined {
    const row = this.handle.db.select().from(socratesGoals).where(eq(socratesGoals.id, goalId)).limit(1).get()
    return row ? mapGoal(row) : undefined
  }

  private routingTurns(goalId: string | undefined, limit: number): Array<{ goalId?: string; user: string; assistant: string }> {
    const rows = this.handle.db.select().from(socratesTurns).orderBy(desc(socratesTurns.ordinal)).all()
      .filter((turn) => goalId === undefined || turn.goalId === goalId)
      .slice(0, Math.max(1, limit))
    return rows.flatMap((turn) => {
      if (!turn.userMessageId) return []
      const user = this.handle.db.select().from(socratesMessages).where(eq(socratesMessages.id, turn.userMessageId)).limit(1).get()
      const assistant = turn.assistantMessageId
        ? this.handle.db.select().from(socratesMessages).where(eq(socratesMessages.id, turn.assistantMessageId)).limit(1).get()
        : undefined
      if (!user) return []
      return [{ ...(turn.goalId ? { goalId: turn.goalId } : {}), user: user.content, assistant: assistant?.content ?? "" }]
    })
  }

  private taskIdForTurn(turnId: string): string | undefined {
    const direct = this.handle.db.select({ id: socratesAgentTasks.id }).from(socratesAgentTasks).where(or(
      eq(socratesAgentTasks.rootTurnId, turnId),
      eq(socratesAgentTasks.currentTurnId, turnId),
    )).limit(1).get()?.id
    if (direct) return direct
    const turn = this.handle.db.select({ metadataJson: socratesTurns.metadataJson }).from(socratesTurns).where(eq(socratesTurns.id, turnId)).limit(1).get()
    const candidate = parseJsonObject(turn?.metadataJson).terminalTaskId
    return typeof candidate === "string" ? candidate : undefined
  }

  private taskOrdinalForTurn(goalId: string, turnId: string): number {
    const taskId = this.taskIdForTurn(turnId)
    const tasks = this.handle.db.select().from(socratesAgentTasks).where(eq(socratesAgentTasks.goalId, goalId)).all()
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    const index = tasks.findIndex((task) => task.id === taskId)
    return index < 0 ? tasks.length : index + 1
  }

  private insertGoalTransition(input: {
    goalId: string
    turnId?: string
    routingRunId?: string
    fromStatus: string | null
    toStatus: string
    reason: string
    note?: string
    createdAt: string
  }): typeof socratesGoalTransitions.$inferSelect {
    const id = createId("v2gtr")
    this.handle.db.insert(socratesGoalTransitions).values({
      ...input,
      id,
      sequence: this.nextGlobalInteger("v2_goal_transitions", "sequence"),
    }).run()
    const row = this.handle.db.select().from(socratesGoalTransitions).where(eq(socratesGoalTransitions.id, id)).get()
    if (!row) throw new SocratesError("socrates_goal_transition_failed", "Socrates goal transition could not be saved.")
    return row
  }

  private refreshCapsule(
    goalId: string,
    turnId: string,
    now: string,
    trigger: "turn_completed" | "parked" | "resumed" | "waiting" | "failed" | "cancelled" | "ledger_update",
  ): void {
    const previous = this.handle.db.select().from(socratesGoalCapsules).where(eq(socratesGoalCapsules.goalId, goalId)).orderBy(desc(socratesGoalCapsules.version)).limit(1).get()
    const goal = this.handle.db.select().from(socratesGoals).where(eq(socratesGoals.id, goalId)).limit(1).get()
    if (!goal) return
    const goalMessages = this.handle.db.select().from(socratesMessages).where(eq(socratesMessages.goalId, goalId))
      .orderBy(desc(socratesMessages.ordinal)).all()
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(0, 24)
    const latestUser = goalMessages.find((message) => message.role === "user")?.content
    const latestAssistant = goalMessages.find((message) => message.role === "assistant")?.content
    const evidenceHandles = this.handle.db.select({ handle: socratesEvidenceItems.handle }).from(socratesEvidenceItems).where(eq(socratesEvidenceItems.goalId, goalId)).orderBy(desc(socratesEvidenceItems.createdAt)).limit(50).all().map((row) => row.handle)
    const turnOrdinal = this.taskOrdinalForTurn(goalId, turnId)
    const waitingTurn = this.handle.db.select({ waitingReason: socratesTurns.waitingReason }).from(socratesTurns).where(and(
      eq(socratesTurns.goalId, goalId),
      eq(socratesTurns.status, "waiting"),
    )).orderBy(desc(socratesTurns.ordinal)).limit(1).get()
    const pendingApprovals = this.handle.db.select({ actionKind: socratesApprovals.actionKind }).from(socratesApprovals).where(and(
      eq(socratesApprovals.goalId, goalId),
      eq(socratesApprovals.status, "pending"),
    )).limit(10).all()
    const activeTerminals = this.handle.db.select({ name: socratesTerminalSessions.name, status: socratesTerminalSessions.status }).from(socratesTerminalSessions).where(and(
      eq(socratesTerminalSessions.goalId, goalId),
      inArray(socratesTerminalSessions.status, [...ACTIVE_TERMINAL_STATUSES]),
    )).limit(10).all()
    const latestError = this.handle.db.select({ code: socratesErrors.code, message: socratesErrors.message }).from(socratesErrors).where(eq(socratesErrors.goalId, goalId)).orderBy(desc(socratesErrors.createdAt)).limit(1).get()

    const decisions = uniqueStrings([
      ...parseJsonArray(previous?.decisionsJson ?? "[]"),
      ...extractCapsuleDecisions(latestUser ?? ""),
      ...extractCapsuleDecisions(latestAssistant ?? ""),
    ]).slice(-20)
    const openQuestions = uniqueStrings([
      ...(waitingTurn?.waitingReason ? [`Waiting: ${waitingTurn.waitingReason}`] : []),
      ...pendingApprovals.map((approval) => `Approval needed: ${approval.actionKind.replaceAll("_", " ")}`),
      ...((trigger === "failed" && latestError) ? [`Resolve ${latestError.code}: ${latestError.message}`] : []),
    ]).slice(0, 20)
    const nextActions = uniqueStrings([
      ...(waitingTurn?.waitingReason ? [`Resume when the Terminal wait completes: ${waitingTurn.waitingReason}`] : []),
      ...activeTerminals.map((terminal) => `Continue Terminal ${terminal.name} (${terminal.status}).`),
      ...pendingApprovals.map((approval) => `Resolve approval for ${approval.actionKind.replaceAll("_", " ")}.`),
    ]).slice(0, 20)
    const state = [goal.status, trigger.replaceAll("_", " ")].join(" · ")
    const summary = buildCapsuleSummary({
      title: goal.title,
      objective: goal.summary ?? goal.title,
      ...(latestUser ? { latestRequest: latestUser } : {}),
      ...(latestAssistant ? { latestOutcome: latestAssistant } : {}),
      state,
      openLoopCount: openQuestions.length,
    })
    const previousHandles = parseJsonArray(previous?.evidenceHandlesJson ?? "[]")
    const previousOpenQuestions = parseJsonArray(previous?.openQuestionsJson ?? "[]")
    const materialTurn = !previous
      || previous.version === 1
      || turnOrdinal - previous.sourceThroughSequence >= 2
      || decisions.length > parseJsonArray(previous?.decisionsJson ?? "[]").length
      || openQuestions.length > 0
      || (previousOpenQuestions.length > 0 && openQuestions.length === 0)
      || evidenceHandles.some((handle) => !previousHandles.includes(handle))
      || (latestAssistant?.length ?? 0) >= 600
    if (trigger === "turn_completed" && !materialTurn) return
    if (previous?.status === "active") this.handle.db.update(socratesGoalCapsules).set({ status: "superseded" }).where(eq(socratesGoalCapsules.id, previous.id)).run()
    this.handle.db.insert(socratesGoalCapsules).values({
      id: createId("v2cap"), goalId, version: (previous?.version ?? 0) + 1, status: "active",
      summary,
      decisionsJson: JSON.stringify(decisions),
      openQuestionsJson: JSON.stringify(openQuestions),
      nextActionsJson: JSON.stringify(nextActions),
      evidenceHandlesJson: JSON.stringify(evidenceHandles),
      sourceThroughSequence: turnOrdinal,
      tokenEstimate: estimateTokens([summary, ...decisions, ...openQuestions, ...nextActions].join("\n")),
      createdByTurnId: turnId,
      createdAt: now,
    }).run()
  }

  private insertError(input: {
    projectId: string
    goalId?: string
    turnId?: string
    source: string
    code: string
    message: string
    details?: unknown
    stack?: string
    recoverable: boolean
  }): SocratesErrorRecord {
    const id = createId("v2err")
    this.handle.db.insert(socratesErrors).values({
      id, projectId: input.projectId, goalId: input.goalId, turnId: input.turnId,
      source: input.source, code: input.code, message: input.message, stack: input.stack,
      detailsJson: input.details === undefined ? undefined : JSON.stringify(input.details), recoverable: input.recoverable, createdAt: nowIso(),
    }).run()
    const row = this.handle.db.select().from(socratesErrors).where(eq(socratesErrors.id, id)).get()
    if (!row) throw new SocratesError("socrates_error_persist_failed", "Socrates error could not be saved.")
    return mapError(row)
  }
}

const mapSocratesState = (row: typeof globalSocratesState.$inferSelect): SocratesState => ({
  id: row.id,
  ...(row.foregroundGoalId ? { foregroundGoalId: row.foregroundGoalId } : {}),
  ...(row.activeTaskId ? { activeTaskId: row.activeTaskId } : {}),
  revision: row.revision,
  lastEventSequence: row.lastEventSequence,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const mapGoal = (row: typeof socratesGoals.$inferSelect): SocratesGoal => ({
  id: row.id,
  ordinal: row.ordinal,
  title: row.title,
  ...(row.summary ? { summary: row.summary } : {}),
  kind: row.kind as SocratesGoal["kind"],
  status: row.status as SocratesGoal["status"],
  origin: row.origin as SocratesGoal["origin"],
  priority: row.priority,
  pinned: row.pinned,
  lastActiveAt: row.lastActiveAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  ...(row.completedAt ? { completedAt: row.completedAt } : {}),
  ...(row.archivedAt ? { archivedAt: row.archivedAt } : {}),
})

const mapTransition = (row: typeof socratesGoalTransitions.$inferSelect): SocratesGoalTransition => ({
  id: row.id,
  goalId: row.goalId,
  ...(row.turnId ? { turnId: row.turnId } : {}),
  ...(row.routingRunId ? { routingRunId: row.routingRunId } : {}),
  fromStatus: row.fromStatus as SocratesGoalTransition["fromStatus"],
  toStatus: row.toStatus as SocratesGoalTransition["toStatus"],
  reason: row.reason as SocratesGoalTransition["reason"],
  ...(row.note ? { note: row.note } : {}),
  sequence: row.sequence,
  createdAt: row.createdAt,
})

const mapRoutingRun = (row: typeof socratesGoalRoutingRuns.$inferSelect): SocratesGoalRoutingRun => ({
  id: row.id,
  turnId: row.turnId,
  messageId: row.messageId,
  ...(row.foregroundGoalId ? { foregroundGoalId: row.foregroundGoalId } : {}),
  candidateGoalIds: parseJsonArray(row.candidateGoalIdsJson),
  ...(row.selectedGoalId ? { selectedGoalId: row.selectedGoalId } : {}),
  ...(row.decision ? { decision: row.decision as SocratesGoalRoutingRun["decision"] } : {}),
  ...(row.confidence === null ? {} : { confidence: row.confidence }),
  ...(row.rationale ? { rationale: row.rationale } : {}),
  ...(row.clarificationQuestion ? { clarificationQuestion: row.clarificationQuestion } : {}),
  clarificationCandidateGoalIds: parseJsonArray(row.clarificationCandidateGoalIdsJson),
  ...(row.clarificationAnswerMessageId ? { clarificationAnswerMessageId: row.clarificationAnswerMessageId } : {}),
  ...(row.providerId ? { providerId: row.providerId as SocratesGoalRoutingRun["providerId"] } : {}),
  ...(row.modelId ? { modelId: row.modelId } : {}),
  status: row.status as SocratesGoalRoutingRun["status"],
  ...(row.fallbackReason ? { fallbackReason: row.fallbackReason } : {}),
  startedAt: row.startedAt,
  ...(row.completedAt ? { completedAt: row.completedAt } : {}),
})

const mapCapsule = (row: typeof socratesGoalCapsules.$inferSelect): SocratesGoalCapsule => ({
  id: row.id,
  goalId: row.goalId,
  version: row.version,
  status: row.status as SocratesGoalCapsule["status"],
  summary: row.summary,
  decisions: parseJsonArray(row.decisionsJson),
  openQuestions: parseJsonArray(row.openQuestionsJson),
  nextActions: parseJsonArray(row.nextActionsJson),
  evidenceHandles: parseJsonArray(row.evidenceHandlesJson),
  sourceThroughSequence: row.sourceThroughSequence,
  tokenEstimate: row.tokenEstimate,
  ...(row.createdByTurnId ? { createdByTurnId: row.createdByTurnId } : {}),
  createdAt: row.createdAt,
})

const mapAttachment = (row: typeof socratesMessageAttachments.$inferSelect): SocratesMessageAttachment => ({
  id: row.id,
  ...(row.goalId ? { goalId: row.goalId } : {}),
  ...(row.turnId ? { turnId: row.turnId } : {}),
  ...(row.messageId ? { messageId: row.messageId } : {}),
  artifactId: row.artifactId,
  kind: row.kind as SocratesMessageAttachment["kind"],
  fileName: row.fileName,
  mimeType: row.mimeType,
  sizeBytes: row.sizeBytes,
  uri: row.uri,
  url: `/api/socrates/attachments/${encodeURIComponent(row.id)}/content`,
  status: row.status as SocratesMessageAttachment["status"],
  createdAt: row.createdAt,
})

const mapMessage = (row: typeof socratesMessages.$inferSelect, attachments?: SocratesMessageAttachment[]): SocratesMessage => ({
  id: row.id,
  ...(row.goalId ? { goalId: row.goalId } : {}),
  ...(row.turnId ? { turnId: row.turnId } : {}),
  ordinal: row.ordinal,
  role: row.role as SocratesMessage["role"],
  kind: row.kind as SocratesMessage["kind"],
  content: row.content,
  ...(row.reasoning ? { reasoning: row.reasoning } : {}),
  status: row.status as SocratesMessage["status"],
  ...(row.parentMessageId ? { parentMessageId: row.parentMessageId } : {}),
  ...(attachments && attachments.length > 0 ? { attachments } : {}),
  createdAt: row.createdAt,
  ...(row.completedAt ? { completedAt: row.completedAt } : {}),
})

const mapTurn = (row: typeof socratesTurns.$inferSelect): SocratesTurn => ({
  id: row.id,
  ...(row.goalId ? { goalId: row.goalId } : {}),
  ordinal: row.ordinal,
  ...(row.userMessageId ? { userMessageId: row.userMessageId } : {}),
  ...(row.assistantMessageId ? { assistantMessageId: row.assistantMessageId } : {}),
  status: row.status as SocratesTurn["status"],
  ...(row.waitingReason ? { waitingReason: row.waitingReason } : {}),
  ...(row.errorId ? { errorId: row.errorId } : {}),
  startedAt: row.startedAt,
  updatedAt: row.updatedAt,
  ...(row.completedAt ? { completedAt: row.completedAt } : {}),
  ...(row.failedAt ? { failedAt: row.failedAt } : {}),
  ...(row.cancelledAt ? { cancelledAt: row.cancelledAt } : {}),
})

const mapAgentTask = (row: typeof socratesAgentTasks.$inferSelect): SocratesAgentTask => ({
  id: row.id,
  sourceRuntime: "socrates",
  canonicalTaskId: row.id,
  ...(row.goalId ? { goalId: row.goalId } : {}),
  rootTurnId: row.rootTurnId,
  currentTurnId: row.currentTurnId,
  status: row.status as SocratesAgentTask["status"],
  runtimeConfig: socratesRuntimeConfigSchema.parse(parseJson(row.runtimeConfigJson)),
  waitingOnTerminalIds: parseStringArray(row.waitingOnTerminalIdsJson),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  ...(row.completedAt ? { completedAt: row.completedAt } : {}),
})

const mapRuntimeEvent = (row: typeof socratesRuntimeEvents.$inferSelect): SocratesRuntimeEvent => ({
  id: row.id,
  ...(row.goalId ? { goalId: row.goalId } : {}),
  ...(row.turnId ? { turnId: row.turnId } : {}),
  sequence: row.sequence,
  type: row.type,
  source: row.source,
  payload: parseJson(row.payloadJson),
  createdAt: row.createdAt,
})

const mapModelCall = (row: typeof socratesModelCalls.$inferSelect): SocratesModelCall => ({
  id: row.id,
  ...(row.goalId ? { goalId: row.goalId } : {}),
  ...(row.turnId ? { turnId: row.turnId } : {}),
  role: row.role as SocratesModelCall["role"],
  providerId: row.providerId as SocratesModelCall["providerId"],
  modelId: row.modelId,
  status: row.status as SocratesModelCall["status"],
  ...(row.errorId ? { errorId: row.errorId } : {}),
  startedAt: row.startedAt,
  ...(row.completedAt ? { completedAt: row.completedAt } : {}),
})

const mapUsage = (row: typeof socratesUsageEvents.$inferSelect): SocratesUsageEvent => ({
  id: row.id,
  ...(row.goalId ? { goalId: row.goalId } : {}),
  ...(row.turnId ? { turnId: row.turnId } : {}),
  modelCallId: row.modelCallId,
  providerId: row.providerId as SocratesUsageEvent["providerId"],
  modelId: row.modelId,
  inputTokens: row.inputTokens,
  outputTokens: row.outputTokens,
  reasoningTokens: row.reasoningTokens,
  cachedInputTokens: row.cachedInputTokens,
  totalTokens: row.totalTokens,
  ...(row.costUsd === null ? {} : { costUsd: row.costUsd }),
  createdAt: row.createdAt,
})

const mapToolCall = (row: typeof socratesToolCalls.$inferSelect): SocratesToolCall => ({
  id: row.id,
  ...(row.goalId ? { goalId: row.goalId } : {}),
  turnId: row.turnId,
  ...(row.modelCallId ? { modelCallId: row.modelCallId } : {}),
  toolName: row.toolName,
  status: row.status as SocratesToolCall["status"],
  arguments: parseJson(row.argumentsJson),
  ...(row.resultJson ? { result: parseJson(row.resultJson) } : {}),
  requiresApproval: row.requiresApproval,
  ...(row.approvalId ? { approvalId: row.approvalId } : {}),
  ...(row.errorId ? { errorId: row.errorId } : {}),
  ...(row.startedAt ? { startedAt: row.startedAt } : {}),
  ...(row.completedAt ? { completedAt: row.completedAt } : {}),
})

const mapApproval = (row: typeof socratesApprovals.$inferSelect): SocratesApproval => ({
  id: row.id,
  ...(row.goalId ? { goalId: row.goalId } : {}),
  turnId: row.turnId,
  ...(row.toolCallId ? { toolCallId: row.toolCallId } : {}),
  status: row.status as SocratesApproval["status"],
  actionKind: row.actionKind,
  action: parseJson(row.actionJson),
  ...(row.decision ? { decision: row.decision as NonNullable<SocratesApproval["decision"]> } : {}),
  ...(row.reason ? { reason: row.reason } : {}),
  requestedAt: row.requestedAt,
  ...(row.decidedAt ? { decidedAt: row.decidedAt } : {}),
})

const mapFeedback = (row: typeof socratesFeedback.$inferSelect): SocratesFeedback => ({
  id: row.id,
  ...(row.goalId ? { goalId: row.goalId } : {}),
  ...(row.turnId ? { turnId: row.turnId } : {}),
  messageId: row.messageId,
  ...(row.modelCallId ? { modelCallId: row.modelCallId } : {}),
  rating: row.rating as SocratesFeedback["rating"],
  ...(row.reasonCode ? { reasonCode: row.reasonCode } : {}),
  ...(row.note ? { note: row.note } : {}),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const mapCredentialRequest = (row: typeof socratesCredentialInputRequests.$inferSelect): SocratesCredentialInputRequest => ({
  id: row.id,
  ...(row.goalId ? { goalId: row.goalId } : {}),
  turnId: row.turnId,
  toolCallId: row.toolCallId,
  ...(row.providerToolCallId ? { providerToolCallId: row.providerToolCallId } : {}),
  serverId: row.serverId,
  ...(row.serverLabel ? { serverLabel: row.serverLabel } : {}),
  envKey: row.envKey,
  source: row.source as SocratesCredentialInputRequest["source"],
  status: row.status as SocratesCredentialInputRequest["status"],
  requestedAt: row.requestedAt,
  ...(row.resolvedAt ? { resolvedAt: row.resolvedAt } : {}),
})

const mapEvidence = (row: typeof socratesEvidenceItems.$inferSelect): SocratesEvidenceItem => ({
  id: row.id,
  handle: row.handle,
  ...(row.goalId ? { goalId: row.goalId } : {}),
  ...(row.turnId ? { turnId: row.turnId } : {}),
  sourceKind: row.sourceKind as SocratesEvidenceItem["sourceKind"],
  ...(row.sourceId ? { sourceId: row.sourceId } : {}),
  ...(row.sourceUri ? { sourceUri: row.sourceUri } : {}),
  title: row.title,
  ...(row.mimeType ? { mimeType: row.mimeType } : {}),
  ...(row.content === null ? {} : { content: row.content }),
  contentHash: row.contentHash,
  ...(row.sizeBytes === null ? {} : { sizeBytes: row.sizeBytes }),
  ...(row.tokenEstimate === null ? {} : { tokenEstimate: row.tokenEstimate }),
  ...(row.locatorJson ? { locator: parseJson(row.locatorJson) } : {}),
  createdAt: row.createdAt,
})

const mapCoreEvidence = (row: typeof socratesEvidenceItems.$inferSelect): ImmutableEvidenceRecord => ({
  ref: {
    evidenceId: row.id,
    taskId: row.turnId ?? row.id,
    sourceType: row.sourceKind,
    sourceLocator: row.handle,
    contentHash: row.contentHash,
    capturedAt: row.createdAt,
  },
  exactContent: row.content ?? "",
  ...(row.metadataJson ? { metadata: parseJsonObject(row.metadataJson) } : {}),
})

const mapTerminal = (row: typeof socratesTerminalSessions.$inferSelect): SocratesTerminal => ({
  id: row.id,
  ...(row.goalId ? { goalId: row.goalId } : {}),
  ...(row.turnId ? { turnId: row.turnId } : {}),
  name: row.name,
  command: row.command,
  cwd: row.cwd,
  status: row.status as SocratesTerminal["status"],
  awaitingInput: row.awaitingInput,
  stateVersion: row.stateVersion,
  ...(row.exitCode === null ? {} : { exitCode: row.exitCode }),
  startedAt: row.startedAt,
  updatedAt: row.updatedAt,
  ...(row.completedAt ? { completedAt: row.completedAt } : {}),
})

const mapTerminalRuntimeRecord = (row: typeof socratesTerminalSessions.$inferSelect): SocratesTerminalRuntimeRecord => {
  const metadata = parseJsonObject(row.metadataJson)
  const inputMode = metadata.inputMode === "user" ? "user" as const : "none" as const
  return {
    terminal: mapTerminal(row),
    projectId: row.projectId,
    workspacePath: row.workspacePath,
    ...(row.processId ? { processId: row.processId } : {}),
    ...(row.platform ? { platform: row.platform } : {}),
    ...(row.shellKind ? { shellKind: row.shellKind } : {}),
    ...(row.shellExecutable ? { shellExecutable: row.shellExecutable } : {}),
    ...(row.signal ? { signal: row.signal } : {}),
    autoDetached: row.autoDetached,
    ...(row.lastPrompt ? { lastPrompt: row.lastPrompt } : {}),
    supervisorOutputSequence: nonNegativeNumber(metadata.supervisorOutputSequence),
    modelVisibleOutputSequence: nonNegativeNumber(metadata.modelVisibleOutputSequence),
    inputMode,
    metadata,
  }
}

const wakeEventForSocratesTerminal = (row: typeof socratesTerminalSessions.$inferSelect): TerminalWaitWakeOn | undefined => {
  if (row.status === "awaiting_input" || row.awaitingInput) return "input_required"
  if (row.status === "exited") return row.exitCode === 0 ? "completed" : "failed"
  if (["stopped", "detached", "stale", "missing"].includes(row.status)) return "failed"
  return undefined
}

const mapArtifact = (row: typeof socratesArtifacts.$inferSelect): SocratesArtifact => ({
  id: row.id,
  ...(row.goalId ? { goalId: row.goalId } : {}),
  ...(row.turnId ? { turnId: row.turnId } : {}),
  kind: row.kind,
  ...(row.path ? { path: row.path } : {}),
  ...(row.uri ? { uri: row.uri } : {}),
  ...(row.contentHash ? { contentHash: row.contentHash } : {}),
  ...(row.mimeType ? { mimeType: row.mimeType } : {}),
  ...(row.sizeBytes === null ? {} : { sizeBytes: row.sizeBytes }),
  createdAt: row.createdAt,
})

const mapSpeechJob = (row: typeof socratesSpeechJobs.$inferSelect): SocratesSpeechJob => ({
  id: row.id,
  ...(row.goalId ? { goalId: row.goalId } : {}),
  ...(row.turnId ? { turnId: row.turnId } : {}),
  ...(row.messageId ? { messageId: row.messageId } : {}),
  kind: row.kind,
  engine: row.engine,
  modelId: row.modelId,
  status: row.status,
  ...(row.inputArtifactId ? { inputArtifactId: row.inputArtifactId } : {}),
  ...(row.inputText ? { inputText: row.inputText } : {}),
  ...(row.outputArtifactId ? { outputArtifactId: row.outputArtifactId } : {}),
  ...(row.transcriptText ? { transcriptText: row.transcriptText } : {}),
  ...(row.voiceId ? { voiceId: row.voiceId } : {}),
  ...(row.speed === null ? {} : { speed: row.speed }),
  ...(row.language ? { language: row.language } : {}),
  ...(row.durationMs === null ? {} : { durationMs: row.durationMs }),
  ...(row.errorId ? { errorId: row.errorId } : {}),
  ...(row.startedAt ? { startedAt: row.startedAt } : {}),
  ...(row.completedAt ? { completedAt: row.completedAt } : {}),
  createdAt: row.createdAt,
} as SocratesSpeechJob)

const mapError = (row: typeof socratesErrors.$inferSelect): SocratesErrorRecord => ({
  id: row.id,
  ...(row.goalId ? { goalId: row.goalId } : {}),
  ...(row.turnId ? { turnId: row.turnId } : {}),
  source: row.source,
  code: row.code,
  message: row.message,
  recoverable: row.recoverable,
  ...(row.detailsJson ? { details: parseJson(row.detailsJson) } : {}),
  createdAt: row.createdAt,
})

const toGoalExchangeFailure = (row: {
  source: string
  code: string
  message: string
  recoverable: boolean
  createdAt: string
}): GoalExchangeFailure => ({
  source: row.source,
  code: row.code,
  message: row.message,
  recoverable: row.recoverable,
  occurredAt: row.createdAt,
})

const formatSocratesAttachmentReference = (
  attachments: Array<{ kind: string; fileName: string; uri: string; mimeType: string; sizeBytes: number }>,
): string =>
  [
    "Conversation attachments are stored in the workspace. Before answering from an attached text file, inspect it with read or search instead of guessing. For an Agent Skill ZIP, use skills preview_import with the exact attachmentPath below; do not read or unzip it with generic tools:",
    ...attachments.map(
      (attachment) =>
        `- ${attachment.kind} ${attachment.fileName}: ${socratesAttachmentReferencePath(attachment.uri)} (${attachment.mimeType}, ${attachment.sizeBytes} bytes)`,
    ),
  ].join("\n")

const messageRoleOrder = (role: string): number => role === "user" ? 0 : role === "assistant" ? 1 : 2

const normalizeAgentTaskStatus = (status: string): SocratesAgentTask["status"] => {
  if (status === "waiting" || status === "ready" || status === "completed" || status === "failed" || status === "cancelled") {
    return status
  }
  return "running"
}

const socratesAttachmentReferencePath = (uri: string): string => {
  const normalized = uri.split(path.sep).join("/")
  const marker = "/.socrates/"
  const markerIndex = normalized.indexOf(marker)
  return markerIndex >= 0 ? normalized.slice(markerIndex + 1) : path.basename(uri)
}

const normalizeSocratesAttachmentReference = (value: string): string => {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\//, "")
  const marker = "/.socrates/"
  const markerIndex = normalized.indexOf(marker)
  return markerIndex >= 0 ? normalized.slice(markerIndex + 1) : normalized.replace(/^\/+/, "")
}

const truncateInline = (value: string, maxLength: number): string => {
  const normalized = value.trim().replace(/\s+/g, " ")
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

const imageMimeTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/heic", "image/svg+xml"])
const textMimeTypes = new Set(["text/plain"])
const zipMimeTypes = new Set(["application/zip", "application/x-zip-compressed"])

const attachmentKind = (mimeType: string): "image" | "text" | "skill_zip" | undefined =>
  imageMimeTypes.has(mimeType) ? "image" : textMimeTypes.has(mimeType) ? "text" : zipMimeTypes.has(mimeType) ? "skill_zip" : undefined

const normalizeMimeType = (mimeType: string | undefined, fileName: string): string => {
  if (mimeType && mimeType !== "application/octet-stream") return mimeType.toLowerCase()
  const lower = fileName.toLowerCase()
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".gif")) return "image/gif"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".heic")) return "image/heic"
  if (lower.endsWith(".svg")) return "image/svg+xml"
  if (lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".log")) return "text/plain"
  if (lower.endsWith(".zip")) return "application/zip"
  return mimeType?.toLowerCase() ?? "application/octet-stream"
}

const validateAttachmentBatch = (inputs: UploadedFile[]): void => {
  if (inputs.length === 0) throw new SocratesError("attachment_file_required", "Choose at least one Socrates attachment.", { recoverable: true })
  if (inputs.length > MAX_MESSAGE_ATTACHMENTS) throw new SocratesError("attachment_upload_limit_exceeded", `Attach up to ${MAX_MESSAGE_ATTACHMENTS} files to one message.`, { recoverable: true })
  const total = inputs.reduce((sum, input) => sum + input.data.byteLength, 0)
  if (total > MAX_MESSAGE_ATTACHMENT_BYTES) throw new SocratesError("attachment_total_too_large", "Attachments for one message must be 20 MB or smaller in total.", { recoverable: true })
}

const validateAttachmentSize = (kind: "image" | "text" | "skill_zip", input: UploadedFile): void => {
  const max = kind === "image" ? MAX_IMAGE_ATTACHMENT_BYTES : kind === "skill_zip" ? MAX_SKILL_ZIP_ATTACHMENT_BYTES : MAX_TEXT_ATTACHMENT_BYTES
  if (input.data.byteLength > max) throw new SocratesError("attachment_too_large", "This Socrates attachment exceeds the allowed size.", {
    details: { fileName: input.originalName, sizeBytes: input.data.byteLength, maxAttachmentBytes: max }, recoverable: true,
  })
}

const routingDecisionContract = (decision: SocratesGoalRoutingDecision): SocratesGoalRoutingRun["decision"] =>
  decision.action === "continue" ? "continue_foreground" : decision.action === "resume" ? "resume_parked" : "create_goal"

const deriveGoalTitle = (content: string): string => {
  const normalized = content.trim().replace(/\s+/g, " ")
  if (!normalized) return "New goal"
  return normalized.length <= 80 ? normalized : `${normalized.slice(0, 77).trimEnd()}…`
}

const buildCapsuleSummary = (input: {
  title: string
  objective: string
  latestRequest?: string
  latestOutcome?: string
  state: string
  openLoopCount?: number
}): string => [
  `Goal: ${truncateInline(input.title, 500)}`,
  `Objective: ${truncateInline(input.objective, 2_000)}`,
  ...(input.latestRequest ? [`Latest request: ${truncateInline(input.latestRequest, 4_000)}`] : []),
  ...(input.latestOutcome ? [`Latest outcome: ${truncateInline(input.latestOutcome, 4_000)}`] : []),
  `State: ${truncateInline(input.state, 500)}`,
  ...((input.openLoopCount ?? 0) > 0 ? [`Open loops: ${input.openLoopCount}`] : []),
].join("\n")

const capsuleSentences = (content: string): string[] => content
  .split(/(?<=[.!?])\s+|\n+/)
  .map((value) => truncateInline(value, 1_000))
  .filter(Boolean)

const extractCapsuleDecisions = (content: string): string[] => uniqueStrings(
  capsuleSentences(content).filter((sentence) =>
    /\b(must|should|shall|never|always|do not|don't|decid(?:e|ed)|agree(?:d)?|constraint|require(?:d|ment)?|will use|keep|separate|only)\b/i.test(sentence),
  ),
).slice(0, 12)

const extractQuestions = (content: string): string[] => uniqueStrings(
  capsuleSentences(content).filter((sentence) => sentence.endsWith("?")),
).slice(0, 10)

const estimateTokens = (content: string): number => Math.max(1, Math.ceil(content.length / 4))
const nonNegative = (value: number | undefined): number => Math.max(0, Math.floor(Number.isFinite(value) ? value ?? 0 : 0))
const uniqueStrings = (values: readonly string[]): string[] => [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))]
const uniqueById = <T extends { id: string }>(values: readonly T[]): T[] => [...new Map(values.map((value) => [value.id, value])).values()]

const normalizeGoalEvidenceKind = (sourceKind: string): SocratesGoalExchangeEvidenceDisclosure["sourceKind"] => {
  switch (sourceKind) {
    case "user_attachment":
    case "tool_output":
    case "terminal_output":
    case "file":
    case "pdf_page":
    case "retrieval_chunk":
    case "web_resource":
    case "model_output":
    case "system":
      return sourceKind
    case "tool_call":
      return "tool_output"
    case "shell":
      return "terminal_output"
    case "patch":
      return "file"
    case "message":
      return "model_output"
    default:
      return "system"
  }
}

const compareGlobalGoalRows = (
  left: Pick<typeof socratesGoals.$inferSelect, "id" | "createdAt">,
  right: Pick<typeof socratesGoals.$inferSelect, "id" | "createdAt">,
): number => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)

const encodeGlobalGoalCursor = (goal: Pick<typeof socratesGoals.$inferSelect, "id" | "createdAt">): string =>
  Buffer.from(JSON.stringify({ createdAt: goal.createdAt, id: goal.id }), "utf8").toString("base64url")

const decodeGlobalGoalCursor = (cursor: string): { createdAt: string; id: string } => {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string" || !parsed.createdAt || !parsed.id) throw new Error("invalid")
    return { createdAt: parsed.createdAt, id: parsed.id }
  } catch {
    throw new SocratesError("invalid_query", "The global goal cursor is invalid.", { recoverable: true })
  }
}

const parseJson = (value: string): unknown => {
  try { return JSON.parse(value) as unknown } catch { return null }
}

const parseJsonArray = (value: string): string[] => {
  const parsed = parseJson(value)
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
}

const parseStringArray = (value: string | null | undefined): string[] => {
  if (!value) return []
  const parsed = parseJson(value)
  return Array.isArray(parsed) ? uniqueStrings(parsed.filter((item): item is string => typeof item === "string")) : []
}

const parseSocratesTaskWait = (value: unknown): { terminalNames: string[]; wakeOn: TerminalWaitWakeOn[]; reason: string } | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const terminalNames = Array.isArray(record.terminalNames)
    ? uniqueStrings(record.terminalNames.filter((item): item is string => typeof item === "string"))
    : []
  const wakeOn: TerminalWaitWakeOn[] = Array.isArray(record.wakeOn)
    ? [...new Set(record.wakeOn.filter((item): item is TerminalWaitWakeOn => item === "completed" || item === "failed" || item === "input_required"))]
    : []
  if (terminalNames.length === 0 || wakeOn.length === 0 || typeof record.reason !== "string" || !record.reason.trim()) return undefined
  return { terminalNames, wakeOn, reason: record.reason }
}

const parseSocratesTaskReady = (value: unknown): { terminalId: string; wakeEvent: TerminalWaitWakeOn; reason: string } | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.terminalId !== "string" || typeof record.reason !== "string") return undefined
  if (record.wakeEvent !== "completed" && record.wakeEvent !== "failed" && record.wakeEvent !== "input_required") return undefined
  return { terminalId: record.terminalId, wakeEvent: record.wakeEvent, reason: record.reason }
}

const parseJsonObject = (value: string | null | undefined): Record<string, unknown> => {
  if (!value) return {}
  const parsed = parseJson(value)
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
}

const parseReconciliationWatermark = (value: unknown): ReconciliationWatermarkState | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const state = value as Record<string, unknown>
  if (
    !Number.isInteger(state.lastReconciledEvidenceSequence) ||
    !Number.isInteger(state.lastObservedEvidenceSequence) ||
    !Number.isInteger(state.lastVerifiedMutationBoundary) ||
    (state.lastReconciledEvidenceSequence as number) < 0 ||
    (state.lastObservedEvidenceSequence as number) < (state.lastReconciledEvidenceSequence as number) ||
    (state.lastVerifiedMutationBoundary as number) < 0 ||
    (state.lastVerifiedMutationBoundary as number) > (state.lastObservedEvidenceSequence as number) ||
    typeof state.lastCheckpointAt !== "string" ||
    !Number.isFinite(Date.parse(state.lastCheckpointAt))
  ) return undefined
  const reason = state.pendingCheckpointReason
  const allowedReasons = new Set<NonNullable<ReconciliationWatermarkState["pendingCheckpointReason"]>>([
    "substantial_verified_mutation",
    "milestone_completion",
    "suspension_resume",
    "context_compaction",
    "long_task_activity",
    "documented_state_contradiction",
  ])
  return {
    lastReconciledEvidenceSequence: state.lastReconciledEvidenceSequence as number,
    lastObservedEvidenceSequence: state.lastObservedEvidenceSequence as number,
    lastCheckpointAt: state.lastCheckpointAt,
    lastVerifiedMutationBoundary: state.lastVerifiedMutationBoundary as number,
    ...(typeof reason === "string" && allowedReasons.has(reason as NonNullable<ReconciliationWatermarkState["pendingCheckpointReason"]>)
      ? { pendingCheckpointReason: reason as NonNullable<ReconciliationWatermarkState["pendingCheckpointReason"]> }
      : {}),
  }
}

const nonNegativeNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0

const insertSocratesRuntimeConfig = (
  handle: DatabaseHandle,
  id: string,
  turnId: string,
  runtimeConfig: SocratesRuntimeConfig,
  createdAt: string,
): void => {
  handle.db.insert(socratesTurnRuntimeConfigs).values({
    id,
    turnId,
    providerId: runtimeConfig.providerId,
    authMode: runtimeConfig.authMode ?? "api_key",
    modelId: runtimeConfig.modelId,
    thinkingEnabled: runtimeConfig.thinkingEnabled,
    thinkingEffort: runtimeConfig.thinkingEffort,
    approvalMode: runtimeConfig.approvalMode,
    sandboxMode: runtimeConfig.sandboxMode,
    contextWindowTokens: runtimeConfig.contextWindowTokens,
    createdAt,
  }).run()
}

const normalizeUnknownError = (error: unknown): {
  code: string
  message: string
  details?: unknown
  recoverable: boolean
  stack?: string
} => {
  if (error instanceof SocratesError) return {
    code: error.code,
    message: error.message,
    ...(error.details === undefined ? {} : { details: error.details }),
    recoverable: error.recoverable,
    ...(error.stack ? { stack: error.stack } : {}),
  }
  if (error instanceof Error) return { code: "v2_turn_failed", message: error.message, recoverable: true, ...(error.stack ? { stack: error.stack } : {}) }
  return { code: "v2_turn_failed", message: String(error), recoverable: true }
}
