"use client";

import {
  apiResponseSchema,
  socratesBootstrapResponseSchema,
  socratesBackupInventorySchema,
  socratesListMessagesResponseSchema,
  socratesStateResponseSchema,
  socratesDeleteGoalExchangeResponseSchema,
  socratesDeleteGoalResponseSchema,
  socratesDeleteTurnResponseSchema,
  socratesListGoalExchangesResponseSchema,
  socratesListGlobalGoalsResponseSchema,
  socratesMessageAttachmentSchema,
  socratesSearchGlobalHistoryResponseSchema,
  type ApiError,
  type ApiResponse,
  type SocratesSnapshot,
  type SocratesDeleteGoalExchangeResponse,
  type SocratesDeleteGoalResponse,
  type SocratesDeleteTurnResponse,
  type SocratesGoal,
  type SocratesGoalExchange,
  type SocratesGoalExchangeWindow,
  type SocratesGlobalGoalWindow,
  type SocratesMessage,
  type SocratesMessageAttachment,
  type SocratesMessageWindow,
  type SocratesSearchGlobalHistoryResponse,
} from "@socrates/contracts";
import { z } from "zod";
import { socratesApiBaseUrl } from "@/lib/api";

const attachmentUploadResponseSchema = z.object({ attachments: z.array(socratesMessageAttachmentSchema) }).strict();

export type SocratesMessagePage = Readonly<{ messages: SocratesMessage[]; messageWindow: SocratesMessageWindow }>;
export type SocratesGoalPage = Readonly<{ goals: SocratesGoal[]; goalWindow: SocratesGlobalGoalWindow }>;
export type SocratesExchangePage = Readonly<{ exchanges: SocratesGoalExchange[]; exchangeWindow: SocratesGoalExchangeWindow }>;

export class SocratesApiError extends Error {
  readonly error: ApiError;

  constructor(error: ApiError) {
    super(error.message);
    this.name = "SocratesApiError";
    this.error = error;
  }
}

const apiUrl = (path: string): string => `${socratesApiBaseUrl()}${path}`;

const readJson = async (response: Response): Promise<unknown> => {
  const body = await response.text();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(body.trim() || `${response.status} ${response.statusText}`);
  }
};

const request = async <TSchema extends z.ZodTypeAny>(
  path: string,
  schema: TSchema,
  init: RequestInit = {},
): Promise<z.infer<TSchema>> => {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(apiUrl(path), { ...init, headers, cache: "no-store" });
  const raw = await readJson(response);
  const envelope = apiResponseSchema(schema).safeParse(raw);
  if (!envelope.success) {
    throw new Error(`Socrates returned an invalid response (${response.status}).`);
  }
  const parsed = envelope.data as ApiResponse<z.infer<TSchema>>;
  if (!parsed.ok) throw new SocratesApiError(parsed.error);
  return parsed.data;
};

const query = (values: Record<string, string | number | undefined>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
};

export const socratesApi = {
  bootstrap: async (): Promise<SocratesSnapshot> => {
    const response = await request("/api/socrates/bootstrap", socratesBootstrapResponseSchema, {
      method: "POST",
      body: JSON.stringify({}),
    });
    return response.snapshot;
  },

  getState: async (): Promise<SocratesSnapshot> => {
    const response = await request("/api/socrates/state", socratesStateResponseSchema);
    return response.snapshot;
  },

  listBackups: (): Promise<z.infer<typeof socratesBackupInventorySchema>> =>
    request("/api/socrates/backups", socratesBackupInventorySchema),

  revealBackup: (backupId: string): Promise<void> =>
    request(
      `/api/socrates/backups/${encodeURIComponent(backupId)}/reveal`,
      z.object({ revealed: z.literal(true), backupId: z.string().min(1) }).strict(),
      { method: "POST" },
    ).then(() => undefined),

  listMessages: (beforeOrdinal?: number, limit = 100): Promise<SocratesMessagePage> =>
    request(`/api/socrates/messages${query({ beforeOrdinal, limit })}`, socratesListMessagesResponseSchema),

  listGoals: (beforeCursor?: string, limit = 25): Promise<SocratesGoalPage> =>
    request(`/api/socrates/goals${query({ beforeCursor, limit })}`, socratesListGlobalGoalsResponseSchema),

  listGoalExchanges: (goalId: string, beforeOrdinal?: number, limit = 25): Promise<SocratesExchangePage> =>
    request(
      `/api/socrates/goals/${encodeURIComponent(goalId)}/exchanges${query({ beforeOrdinal, limit })}`,
      socratesListGoalExchangesResponseSchema,
    ),

  searchHistory: (searchQuery: string, limit = 25): Promise<SocratesSearchGlobalHistoryResponse> =>
    request(
      `/api/socrates/history/search${query({ query: searchQuery, limit })}`,
      socratesSearchGlobalHistoryResponseSchema,
    ),

  deleteGoal: (goalId: string): Promise<SocratesDeleteGoalResponse> =>
    request(`/api/socrates/goals/${encodeURIComponent(goalId)}`, socratesDeleteGoalResponseSchema, { method: "DELETE" }),

  deleteExchange: (goalId: string, taskId: string): Promise<SocratesDeleteGoalExchangeResponse> =>
    request(
      `/api/socrates/goals/${encodeURIComponent(goalId)}/exchanges/${encodeURIComponent(taskId)}`,
      socratesDeleteGoalExchangeResponseSchema,
      { method: "DELETE" },
    ),

  deleteTurn: (turnId: string): Promise<SocratesDeleteTurnResponse> =>
    request(`/api/socrates/turns/${encodeURIComponent(turnId)}`, socratesDeleteTurnResponseSchema, { method: "DELETE" }),

  uploadAttachments: async (files: readonly File[]): Promise<SocratesMessageAttachment[]> => {
    const body = new FormData();
    for (const file of files) body.append("file", file);
    const response = await request("/api/socrates/attachments", attachmentUploadResponseSchema, {
      method: "POST",
      body,
    });
    return response.attachments;
  },

  attachmentContentUrl: (attachmentId: string): string =>
    apiUrl(`/api/socrates/attachments/${encodeURIComponent(attachmentId)}/content`),
};
