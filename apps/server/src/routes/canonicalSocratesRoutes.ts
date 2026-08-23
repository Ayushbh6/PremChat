import { spawn } from "node:child_process"
import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import {
  globalSocratesBootstrapResponseSchema,
  globalSocratesEventsPageRequestSchema,
  globalSocratesEventsPageSchema,
  globalSocratesExchangePageRequestSchema,
  globalSocratesExchangePageSchema,
  globalSocratesGoalPageRequestSchema,
  globalSocratesGoalPageSchema,
  globalSocratesKnowledgeSchema,
  globalSocratesResourceBindRequestSchema,
  globalSocratesResourceRelinkRequestSchema,
  globalSocratesResourceSchema,
} from "@socrates/contracts"
import { SocratesError } from "@socrates/shared"
import { listVerifiedCutoverArchives } from "../db/cutoverArchive"
import { fail, ok, toApiError } from "../http"
import type { CanonicalSocratesStore } from "../services/canonical/canonicalSocratesStore"

const goalParamsSchema = z.object({ goalId: z.string().min(1) }).strict()
const goalExchangeParamsSchema = goalParamsSchema.extend({ taskId: z.string().min(1) }).strict()
const resourceParamsSchema = z.object({ resourceId: z.string().min(1) }).strict()
const knowledgeQuerySchema = z.object({
  scope: z.enum(["global", "resource"]),
  resourceId: z.string().min(1).optional(),
  includePending: z.coerce.boolean().optional(),
}).strict().superRefine((value, context) => {
  if ((value.scope === "resource") !== Boolean(value.resourceId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["resourceId"], message: "Resource knowledge requires exactly one resource." })
  }
})

const parse = <T>(schema: z.ZodType<T>, value: unknown, code: string): T => {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  throw new SocratesError(code, "Request did not match the canonical global Socrates contract.", {
    details: result.error.flatten(),
    recoverable: true,
  })
}

const sendRouteError = (reply: FastifyReply, error: unknown) => {
  const api = toApiError(error)
  const statusCode = api.code.includes("not_found") ? 404 : api.code.includes("invalid") || api.code.includes("required") ? 400 : 500
  return reply.code(statusCode).send(fail(api))
}

/**
 * The fresh-runtime HTTP surface. It deliberately takes only the canonical
 * store: a route cannot reach released project/conversation/Flow data through
 * a hidden dependency.
 */
export const registerCanonicalSocratesRoutes = async (
  app: FastifyInstance,
  input: { store: CanonicalSocratesStore; socratesHome?: string },
): Promise<void> => {
  app.post("/api/socrates/bootstrap", async (request, reply) => {
    try {
      parse(z.object({}).strict(), request.body ?? {}, "invalid_request")
      return ok(globalSocratesBootstrapResponseSchema.parse({ snapshot: input.store.getSnapshot() }))
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.get("/api/socrates/state", async (_request, reply) => {
    try {
      return ok(globalSocratesBootstrapResponseSchema.parse({ snapshot: input.store.getSnapshot() }))
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.get("/api/socrates/goals", async (request, reply) => {
    try {
      const query = parse(globalSocratesGoalPageRequestSchema, request.query, "invalid_query")
      const goals = input.store.listGoals(query.limit, query.beforeOrdinal)
      return ok(globalSocratesGoalPageSchema.parse({
        goals,
        ...(goals.length === query.limit ? { nextBeforeOrdinal: goals.at(-1)?.ordinal } : {}),
      }))
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.get("/api/socrates/goals/:goalId/exchanges", async (request, reply) => {
    try {
      const { goalId } = parse(goalParamsSchema, request.params, "invalid_route_params")
      const query = parse(globalSocratesExchangePageRequestSchema, request.query, "invalid_query")
      const exchanges = input.store.listGoalExchanges(goalId, query.limit, query.beforeOrdinal)
      return ok(globalSocratesExchangePageSchema.parse({
        exchanges,
        ...(exchanges.length === query.limit ? { nextBeforeOrdinal: exchanges.at(-1)?.task.ordinal } : {}),
      }))
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.get("/api/socrates/goals/:goalId/exchanges/:taskId", async (request, reply) => {
    try {
      const { goalId, taskId } = parse(goalExchangeParamsSchema, request.params, "invalid_route_params")
      return ok(globalSocratesExchangePageSchema.parse({ exchanges: [input.store.getGoalExchange(goalId, taskId)] }))
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.get("/api/socrates/events", async (request, reply) => {
    try {
      const query = parse(globalSocratesEventsPageRequestSchema, request.query, "invalid_query")
      const events = input.store.listEvents(query.afterSequence, query.limit)
      return ok(globalSocratesEventsPageSchema.parse({ events, nextSequence: events.at(-1)?.sequence ?? query.afterSequence }))
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.get("/api/socrates/resources", async (_request, reply) => {
    try {
      return ok({ resources: input.store.listResources().map((resource) => globalSocratesResourceSchema.parse(resource)) })
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.post("/api/socrates/resources/bind", async (request, reply) => {
    try {
      const body = parse(globalSocratesResourceBindRequestSchema, request.body, "invalid_request")
      const binding = input.store.bindConfirmedResource({
        ownerKind: body.ownerKind,
        ownerId: body.ownerId,
        requestedPath: body.path,
        ...(body.label ? { label: body.label } : {}),
        confirmedBy: body.confirmedBy,
      })
      return ok({ binding })
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.post("/api/socrates/resources/:resourceId/relink", async (request, reply) => {
    try {
      const { resourceId } = parse(resourceParamsSchema, request.params, "invalid_route_params")
      const body = parse(globalSocratesResourceRelinkRequestSchema, request.body, "invalid_request")
      return ok(input.store.relinkResource({ resourceId, requestedPath: body.path, confirmedBy: "relink_confirmation" }))
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.get("/api/socrates/knowledge", async (request, reply) => {
    try {
      const query = parse(knowledgeQuerySchema, request.query, "invalid_query")
      return ok({ knowledge: input.store.listKnowledge({
        scope: query.scope,
        ...(query.resourceId ? { resourceId: query.resourceId } : {}),
        ...(query.includePending !== undefined ? { includePending: query.includePending } : {}),
      }).map((entry) => globalSocratesKnowledgeSchema.parse(entry)) })
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.get("/api/socrates/backups", async (_request, reply) => {
    try {
      const backups = input.socratesHome
        ? listVerifiedCutoverArchives(input.socratesHome).map(({ id, archivePath, manifest }) => ({
            id,
            createdAt: manifest.createdAt,
            archivePath,
            sizeBytes: manifest.totalSizeBytes,
            sourceSchemaVersion: manifest.sourceSchemaVersion,
            integrity: manifest.integrity,
            manifestSha256: manifest.manifestSha256,
          }))
        : []
      return ok({ backups })
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })

  app.post("/api/socrates/backups/:backupId/reveal", async (request, reply) => {
    try {
      if (!input.socratesHome) throw new SocratesError("backup_home_unavailable", "The Socrates backup directory is unavailable.")
      const backupId = z.string().regex(/^cutover-[A-Za-z0-9-]+$/).parse((request.params as { backupId?: unknown }).backupId)
      const backup = listVerifiedCutoverArchives(input.socratesHome).find((candidate) => candidate.id === backupId)
      if (!backup) throw new SocratesError("backup_not_found", "That verified cutover archive was not found.", { recoverable: true })
      revealInFileManager(backup.archivePath)
      return ok({ revealed: true, backupId })
    } catch (error) {
      return sendRouteError(reply, error)
    }
  })
}

const revealInFileManager = (target: string): void => {
  if (process.platform === "darwin") spawn("open", ["-R", target], { detached: true, stdio: "ignore" }).unref()
  else if (process.platform === "win32") spawn("explorer.exe", ["/select,", target], { detached: true, stdio: "ignore" }).unref()
  else spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref()
}
