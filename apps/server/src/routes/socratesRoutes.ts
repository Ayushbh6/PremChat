import fs from "node:fs"
import { spawn } from "node:child_process"
import type { FastifyInstance, FastifyReply } from "fastify"
import "@fastify/multipart"
import { z } from "zod"
import {
  MAX_MESSAGE_ATTACHMENTS,
  SOCRATES_GOAL_PAGE_SIZE,
  SOCRATES_MESSAGE_PAGE_MAX,
  SOCRATES_SNAPSHOT_MESSAGE_LIMIT,
  socratesBootstrapRequestSchema,
  socratesBootstrapResponseSchema,
  socratesListMessagesRequestSchema,
  socratesListMessagesResponseSchema,
  socratesStateResponseSchema,
  socratesBackupInventorySchema,
  socratesDeleteGoalExchangeResponseSchema,
  socratesDeleteGoalResponseSchema,
  socratesDeleteTurnResponseSchema,
  socratesListGoalExchangesRequestSchema,
  socratesListGoalExchangesResponseSchema,
  socratesListGlobalGoalsRequestSchema,
  socratesListGlobalGoalsResponseSchema,
  socratesListTimelineRequestSchema,
  socratesSearchGlobalHistoryRequestSchema,
  socratesSearchGlobalHistoryResponseSchema,
} from "@socrates/contracts"
import { SocratesError } from "@socrates/shared"
import { fail, ok, toApiError } from "../http"
import type { GlobalSocratesStore } from "../services/socrates/socratesStore"
import type { SocratesStore } from "../services/store"
import { listVerifiedCutoverArchives } from "../db/cutoverArchive"

const attachmentParamsSchema = z.object({ attachmentId: z.string().min(1) }).strict()
const goalParamsSchema = z.object({ goalId: z.string().min(1) }).strict()
const goalExchangeParamsSchema = goalParamsSchema.extend({ taskId: z.string().min(1) }).strict()
const turnParamsSchema = z.object({ turnId: z.string().min(1) }).strict()
const evidenceRetrieveSchema = z.object({ evidenceIds: z.array(z.string().min(1)).min(1).max(50) }).strict()

const parse = <T>(schema: z.ZodType<T>, value: unknown, code: string): T => {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new SocratesError(code, "Request did not match the global Socrates contract.", {
      details: parsed.error.flatten(),
      recoverable: true,
    })
  }
  return parsed.data
}

const routeError = (error: unknown) => {
  const api = toApiError(error)
  const statusCode =
    api.code === "invalid_route_params" ||
    api.code === "invalid_query" ||
    api.code === "invalid_request" ||
    api.code.startsWith("attachment_type_") ||
    api.code === "attachment_upload_limit_exceeded"
      ? 400
      : api.code.includes("too_large") || api.code.includes("limit_exceeded")
        ? 413
        : api.code.endsWith("_not_found") || api.code === "project_workspace_path_missing"
          ? 404
          : api.code.includes("still_active") || api.code.includes("already_active") || api.code.includes("conflict")
            ? 409
            : 500
  return { statusCode, response: fail(api) }
}

const sendRouteError = (reply: FastifyReply, error: unknown) => {
  const { statusCode, response } = routeError(error)
  return reply.code(statusCode).send(response)
}

export const registerSocratesRoutes = async (
  app: FastifyInstance,
  store: GlobalSocratesStore,
  sharedStore?: SocratesStore,
  options: { socratesHome?: string } = {},
): Promise<void> => {
  app.post("/api/socrates/bootstrap", async (request, reply) => {
    try {
      parse(socratesBootstrapRequestSchema, request.body ?? {}, "invalid_request")
      return ok(socratesBootstrapResponseSchema.parse({ snapshot: store.bootstrap() }))
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.get("/api/socrates/state", async (_request, reply) => {
    try {
      return ok(socratesStateResponseSchema.parse({ snapshot: store.getSnapshot() }))
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.get("/api/socrates/backups", async (_request, reply) => {
    try {
      const backups = options.socratesHome
        ? listVerifiedCutoverArchives(options.socratesHome).map(({ id, archivePath, manifest }) => ({
            id,
            createdAt: manifest.createdAt,
            archivePath,
            sizeBytes: manifest.totalSizeBytes,
            sourceSchemaVersion: manifest.sourceSchemaVersion,
            integrity: manifest.integrity,
            manifestSha256: manifest.manifestSha256,
          }))
        : []
      return ok(socratesBackupInventorySchema.parse({ backups }))
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.post("/api/socrates/backups/:backupId/reveal", async (request, reply) => {
    try {
      if (!options.socratesHome) throw new SocratesError("backup_home_unavailable", "The Socrates backup directory is unavailable.")
      const backupId = z.string().regex(/^cutover-[A-Za-z0-9-]+$/).parse((request.params as { backupId?: unknown }).backupId)
      const backup = listVerifiedCutoverArchives(options.socratesHome).find((candidate) => candidate.id === backupId)
      if (!backup) throw new SocratesError("backup_not_found", "That verified cutover archive was not found.", { recoverable: true })
      revealInFileManager(backup.archivePath)
      return ok({ revealed: true, backupId })
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.get("/api/socrates/messages", async (request, reply) => {
    try {
      const query = parse(socratesListMessagesRequestSchema, request.query, "invalid_query")
      return ok(socratesListMessagesResponseSchema.parse(store.listMessages(query.beforeOrdinal, query.limit)))
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.get("/api/socrates/goals", async (request, reply) => {
    try {
      const query = parse(socratesListGlobalGoalsRequestSchema, request.query, "invalid_query")
      return ok(socratesListGlobalGoalsResponseSchema.parse(store.listGoals(query.beforeCursor, query.limit)))
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.get("/api/socrates/goals/:goalId/exchanges", async (request, reply) => {
    try {
      const { goalId } = parse(goalParamsSchema, request.params, "invalid_route_params")
      const query = parse(socratesListGoalExchangesRequestSchema, request.query, "invalid_query")
      return ok(socratesListGoalExchangesResponseSchema.parse(store.listGoalExchanges(goalId, query.beforeOrdinal, query.limit)))
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.get("/api/socrates/history/search", async (request, reply) => {
    try {
      const query = parse(socratesSearchGlobalHistoryRequestSchema, request.query, "invalid_query")
      return ok(socratesSearchGlobalHistoryResponseSchema.parse(store.searchHistory(query.query, query.limit)))
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.get("/api/socrates/events", async (request, reply) => {
    try {
      const query = parse(socratesListTimelineRequestSchema, request.query, "invalid_query")
      const events = store.listRuntimeEvents(query.afterSequence, query.limit)
      return ok({
        events,
        nextSequence: events.at(-1)?.sequence ?? query.afterSequence,
      })
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.delete("/api/socrates/goals/:goalId", async (request, reply) => {
    try {
      const { goalId } = parse(goalParamsSchema, request.params, "invalid_route_params")
      const retrievalGroups = store.goalRetrievalParentGroups(goalId)
      const result = store.deleteGoal(goalId)
      for (const group of retrievalGroups) sharedStore?.deleteSocratesRetrievalParents(group.projectId, group.parentIds)
      return ok(socratesDeleteGoalResponseSchema.parse(result))
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.delete("/api/socrates/goals/:goalId/exchanges/:taskId", async (request, reply) => {
    try {
      const { goalId, taskId } = parse(goalExchangeParamsSchema, request.params, "invalid_route_params")
      const retrievalGroups = store.goalExchangeRetrievalParentGroups(goalId, taskId)
      const result = store.deleteGoalExchange(goalId, taskId)
      for (const group of retrievalGroups) sharedStore?.deleteSocratesRetrievalParents(group.projectId, group.parentIds)
      return ok(socratesDeleteGoalExchangeResponseSchema.parse(result))
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.delete("/api/socrates/turns/:turnId", async (request, reply) => {
    try {
      const { turnId } = parse(turnParamsSchema, request.params, "invalid_route_params")
      const turn = store.getTurn(turnId)
      const result = store.deleteTurn(turnId)
      if (turn.goalId) sharedStore?.deleteSocratesTurnRetrieval(store.getGoalHomeProjectId(turn.goalId), turnId)
      return ok(socratesDeleteTurnResponseSchema.parse(result))
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.get("/api/socrates/context", async (_request, reply) => {
    try {
      const state = store.getState()
      return ok({
        state: { evidence: [], items: store.getExactEvidenceProjections(state.foregroundGoalId) },
        counts: store.getContextCounts(),
      })
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.post("/api/socrates/evidence/retrieve", async (request, reply) => {
    try {
      const { evidenceIds } = parse(evidenceRetrieveSchema, request.body, "invalid_request")
      return ok({ evidence: store.retrieveExactEvidence(evidenceIds) })
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.post("/api/socrates/attachments", async (request, reply) => {
    try {
      const inputs: Array<{ originalName: string; data: Buffer; mimeType?: string }> = []
      for await (const part of request.files()) {
        if (inputs.length >= MAX_MESSAGE_ATTACHMENTS) {
          throw new SocratesError("attachment_upload_limit_exceeded", `Attach up to ${MAX_MESSAGE_ATTACHMENTS} files to one message.`, { recoverable: true })
        }
        inputs.push({
          originalName: part.filename,
          data: await part.toBuffer(),
          ...(part.mimetype ? { mimeType: part.mimetype } : {}),
        })
      }
      if (inputs.length === 0) throw new SocratesError("attachment_file_required", "Choose at least one file to attach.", { recoverable: true })
      return ok({ attachments: store.createDraftAttachments(inputs) })
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.get("/api/socrates/attachments/:attachmentId/content", async (request, reply) => {
    try {
      const { attachmentId } = parse(attachmentParamsSchema, request.params, "invalid_route_params")
      const attachment = store.getAttachmentContent(attachmentId)
      const data = fs.readFileSync(attachment.uri)
      reply.header("Content-Type", attachment.mimeType)
      reply.header("Content-Length", String(data.byteLength))
      reply.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`)
      return reply.send(data)
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })
}

const revealInFileManager = (target: string): void => {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open"
  const child = spawn(command, [target], { detached: true, stdio: "ignore" })
  child.unref()
}

export const socratesRouteLimits = {
  messagePage: SOCRATES_MESSAGE_PAGE_MAX,
  snapshotMessages: SOCRATES_SNAPSHOT_MESSAGE_LIMIT,
  goalPage: SOCRATES_GOAL_PAGE_SIZE,
} as const
