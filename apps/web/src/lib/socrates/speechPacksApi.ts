"use client";

import { socratesApiBaseUrl } from "../api";
import { apiResponseSchema, type ApiError, type ApiResponse } from "@socrates/contracts";
import { z } from "zod";

export const SOCRATES_SPEECH_PACK_IDS = [
  "whisper-base.en",
  "whisper-small.en",
  "kokoro-en-v0_19",
] as const;

export const socratesSpeechPackIdSchema = z.enum(SOCRATES_SPEECH_PACK_IDS);
export type SocratesSpeechPackId = z.infer<typeof socratesSpeechPackIdSchema>;

export const socratesSpeechPackSchema = z
  .object({
    id: socratesSpeechPackIdSchema,
    installed: z.boolean(),
    verified: z.boolean(),
    path: z.string(),
  })
  .strict();

const socratesSpeechPackListResponseSchema = z
  .object({ packs: z.array(socratesSpeechPackSchema) })
  .strict();
const socratesSpeechPackResponseSchema = z.object({ pack: socratesSpeechPackSchema }).strict();
const socratesSpeechPackRemoveResponseSchema = z
  .object({ removedPackId: socratesSpeechPackIdSchema, pack: socratesSpeechPackSchema })
  .strict();

export type SocratesSpeechPack = z.infer<typeof socratesSpeechPackSchema>;

export const SOCRATES_SPEECH_PACK_CATALOG = {
  "whisper-base.en": {
    name: "Whisper base.en",
    shortName: "Base",
    purpose: "Speech to text",
    description: "Fast English transcription with the lightest local footprint.",
    sizeBytes: 147_964_211,
    modelId: "base.en",
  },
  "whisper-small.en": {
    name: "Whisper small.en",
    shortName: "Small",
    purpose: "Speech to text",
    description: "More accurate English transcription for stronger local machines.",
    sizeBytes: 487_614_201,
    modelId: "small.en",
  },
  "kokoro-en-v0_19": {
    name: "Kokoro",
    shortName: "Kokoro",
    purpose: "Read aloud",
    description: "Local English voice generation for Socrates responses.",
    sizeBytes: 319_625_534,
    modelId: "kokoro-82m",
  },
} as const satisfies Record<
  SocratesSpeechPackId,
  {
    name: string;
    shortName: string;
    purpose: "Speech to text" | "Read aloud";
    description: string;
    sizeBytes: number;
    modelId: string;
  }
>;

export class SocratesSpeechPackApiError extends Error {
  readonly error: ApiError;

  constructor(error: ApiError) {
    super(error.message);
    this.name = "SocratesSpeechPackApiError";
    this.error = error;
  }
}

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(text.trim() || `${response.status} ${response.statusText}`);
  }
};

const request = async <TSchema extends z.ZodTypeAny>(
  path: string,
  schema: TSchema,
  init: RequestInit = {},
): Promise<z.infer<TSchema>> => {
  const response = await fetch(`${socratesApiBaseUrl()}${path}`, {
    ...init,
    cache: "no-store",
  });
  const payload = await readJson(response);
  const parsed = apiResponseSchema(schema).safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Socrates returned an invalid speech-pack response (${response.status}).`);
  }
  const envelope = parsed.data as ApiResponse<z.infer<TSchema>>;
  if (!envelope.ok) throw new SocratesSpeechPackApiError(envelope.error);
  return envelope.data;
};

const packPath = (packId: SocratesSpeechPackId): string =>
  `/api/socrates/speech/packs/${encodeURIComponent(packId)}`;

export const socratesSpeechPacksApi = {
  list: async (signal?: AbortSignal): Promise<SocratesSpeechPack[]> => {
    const data = await request("/api/socrates/speech/packs", socratesSpeechPackListResponseSchema, { signal });
    return data.packs;
  },

  install: async (packId: SocratesSpeechPackId): Promise<SocratesSpeechPack> => {
    const data = await request(`${packPath(packId)}/install`, socratesSpeechPackResponseSchema, { method: "POST" });
    return data.pack;
  },

  remove: async (packId: SocratesSpeechPackId): Promise<SocratesSpeechPack> => {
    const data = await request(packPath(packId), socratesSpeechPackRemoveResponseSchema, { method: "DELETE" });
    return data.pack;
  },
};
