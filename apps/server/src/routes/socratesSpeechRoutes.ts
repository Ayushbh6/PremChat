import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import "@fastify/multipart"
import { z } from "zod"
import {
  SOCRATES_LOCAL_KOKORO_MODEL_ID,
  SOCRATES_OPENROUTER_STT_MODEL_IDS,
  type SocratesArtifact,
  type SocratesCreateSpeechJobRequest,
  type SocratesSpeechJob,
  socratesArtifactSchema,
  socratesCreateSpeechJobRequestSchema,
  socratesCreateSpeechJobResponseSchema,
  socratesSpeechJobSchema,
} from "@socrates/contracts"
import { SocratesError, normalizeError } from "@socrates/shared"
import { fail, ok, toApiError } from "../http"
import {
  SOCRATES_SPEECH_PACK_MANIFEST,
  type LocalKokoroSynthesizer,
  type LocalWhisperTranscriber,
  type OpenRouterTranscriber,
  type SpeechPackId,
  type SpeechPackManager,
  type SpeechTranscription,
} from "../services/socrates/speech"

const MAX_SPEECH_UPLOAD_BYTES = 50 * 1024 * 1024
const SUPPORTED_AUDIO_MIME_TYPES = new Set([
  "audio/flac",
  "audio/m4a",
  "audio/mp3",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "audio/x-wav",
])

const artifactParamsSchema = z.object({ artifactId: z.string().min(1) }).strict()
const jobParamsSchema = z.object({ jobId: z.string().min(1) }).strict()
const speechPackParamsSchema = z.object({ packId: z.string().min(1) }).strict()

type Awaitable<T> = T | Promise<T>

export type SocratesSpeechArtifactContent = {
  artifact: SocratesArtifact
  data?: Buffer
  path?: string
}

export type SocratesSpeechJobUpdate =
  | { status: "running"; startedAt: string }
  | {
      status: "completed"
      completedAt: string
      durationMs: number
      transcriptText: string
      usage?: SpeechTranscription["usage"]
      providerRaw?: unknown
    }
  | {
      status: "completed"
      completedAt: string
      durationMs: number
      outputArtifactId: string
    }
  | {
      status: "failed"
      completedAt: string
      error: { code: string; message: string; details?: unknown; recoverable: boolean }
    }

/**
 * The speech HTTP layer has no database dependency. The global Socrates store
 * supplies this narrow persistence adapter without a project or conversation scope.
 */
export interface SocratesSpeechPersistence {
  createSpeechArtifact(input: {
    goalId?: string
    turnId?: string
    kind: "speech_input" | "speech_output"
    fileName: string
    mimeType: string
    data: Buffer
  }): Awaitable<SocratesArtifact>
  readSpeechArtifact(input: { artifactId: string }): Awaitable<SocratesSpeechArtifactContent>
  createSpeechJob(input: {
    request: SocratesCreateSpeechJobRequest
  }): Awaitable<SocratesSpeechJob>
  updateSpeechJob(input: {
    jobId: string
    update: SocratesSpeechJobUpdate
  }): Awaitable<SocratesSpeechJob>
  getSpeechJob(jobId: string): Awaitable<SocratesSpeechJob>
}

type SpeechPackService = Pick<SpeechPackManager, "status" | "install" | "remove">
type LocalWhisperService = Pick<LocalWhisperTranscriber, "transcribe">
type OpenRouterService = Pick<OpenRouterTranscriber, "transcribe">
type KokoroService = Pick<LocalKokoroSynthesizer, "synthesize">

export type SocratesSpeechRouteServices = {
  persistence: SocratesSpeechPersistence
  packs: SpeechPackService
  localWhisper: LocalWhisperService
  openRouter: OpenRouterService
  kokoro: KokoroService
  now?: () => string
  maxUploadBytes?: number
}

const parse = <T>(schema: z.ZodType<T>, value: unknown, code: string): T => {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new SocratesError(code, "Request did not match the Socrates speech contract.", {
      details: parsed.error.flatten(),
      recoverable: true,
    })
  }
  return parsed.data
}

const parseSpeechPackId = (value: unknown): SpeechPackId => {
  const { packId } = parse(speechPackParamsSchema, value, "invalid_route_params")
  if (!Object.prototype.hasOwnProperty.call(SOCRATES_SPEECH_PACK_MANIFEST, packId)) {
    throw new SocratesError("v2_speech_pack_not_found", "That speech pack is not available.", {
      details: { packId, availablePackIds: Object.keys(SOCRATES_SPEECH_PACK_MANIFEST) },
      recoverable: true,
    })
  }
  return packId as SpeechPackId
}

const routeError = (error: unknown) => {
  if (error && typeof error === "object" && "code" in error && error.code === "FST_REQ_FILE_TOO_LARGE") {
    return {
      statusCode: 413,
      response: fail({
        code: "v2_audio_too_large",
        message: "The recording exceeds the speech upload limit.",
        recoverable: true,
      }),
    }
  }
  const api = toApiError(error)
  const statusCode =
    api.code === "invalid_request" ||
    api.code === "invalid_route_params" ||
    api.code === "v2_audio_file_required" ||
    api.code === "v2_audio_empty" ||
    api.code === "v2_audio_type_not_supported" ||
    api.code === "v2_audio_too_large" ||
    api.code === "v2_local_stt_wav_required" ||
    api.code === "v2_kokoro_voice_invalid" ||
    api.code === "v2_stt_model_not_allowed" ||
    api.code === "v2_tts_text_required"
      ? 400
      : api.code.endsWith("_not_found") || api.code === "v2_audio_missing"
        ? 404
        : api.code === "v2_speech_pack_busy"
          ? 409
          : api.code === "v2_stt_failed" || api.code === "v2_speech_pack_download_failed"
            ? 502
            : api.code.startsWith("v2_speech_runtime_") ||
                api.code.startsWith("v2_whisper_") ||
                api.code.startsWith("v2_kokoro_") ||
                api.code === "openrouter_credential_missing"
              ? 503
              : 500
  return { statusCode, response: fail(api) }
}

const readArtifactBytes = (content: SocratesSpeechArtifactContent): Buffer => {
  if (content.data) return content.data
  if (content.path) {
    try {
      return fs.readFileSync(content.path)
    } catch {
      throw new SocratesError("v2_audio_missing", "The stored speech artifact could not be read.", {
        details: { artifactId: content.artifact.id },
        recoverable: true,
      })
    }
  }
  throw new SocratesError("v2_audio_missing", "The stored speech artifact has no readable content.", {
    details: { artifactId: content.artifact.id },
    recoverable: true,
  })
}

const artifactAudioFormat = (artifact: SocratesArtifact): string => {
  if (artifact.mimeType) return artifact.mimeType
  const candidate = artifact.path ?? artifact.uri ?? ""
  const extension = path.extname(candidate).replace(/^\./, "")
  return extension || "application/octet-stream"
}

const isWavArtifact = (artifact: SocratesArtifact): boolean => {
  const format = artifactAudioFormat(artifact).toLowerCase()
  return format === "wav" || format === "audio/wav" || format === "audio/x-wav" || format === "audio/wave"
}

const safeUploadName = (value: string): string => {
  const base = path.basename(value).replace(/[\u0000-\u001f\u007f]/g, "").trim()
  return base.slice(0, 240) || "recording"
}

const withTemporaryWav = async <T>(data: Buffer, operation: (wavPath: string) => Promise<T>): Promise<T> => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-v2-stt-"))
  const wavPath = path.join(directory, "input.wav")
  try {
    fs.writeFileSync(wavPath, data, { flag: "wx", mode: 0o600 })
    return await operation(wavPath)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

const parseKokoroSpeaker = (voiceId: string): number => {
  const match = /^(?:speaker-)?(\d{1,2})$/.exec(voiceId)
  const speakerId = match?.[1] === undefined ? Number.NaN : Number(match[1])
  if (!Number.isInteger(speakerId) || speakerId < 0 || speakerId > 10) {
    throw new SocratesError("v2_kokoro_voice_invalid", "Kokoro voiceId must be a speaker number from 0 to 10.", {
      details: { voiceId },
      recoverable: true,
    })
  }
  return speakerId
}

const failCreatedJob = async (
  services: SocratesSpeechRouteServices,
  job: SocratesSpeechJob,
  error: unknown,
  now: () => string,
): Promise<void> => {
  const normalized = normalizeError(error)
  try {
    await services.persistence.updateSpeechJob({
      jobId: job.id,
      update: {
        status: "failed",
        completedAt: now(),
        error: {
          code: normalized.code,
          message: normalized.message,
          ...(normalized.details === undefined ? {} : { details: normalized.details }),
          recoverable: normalized.recoverable,
        },
      },
    })
  } catch {
    // Preserve the speech engine error as the response. Persistence can report
    // its own failure through Socrates recovery/telemetry without masking root cause.
  }
}

const executeSpeechJob = async (
  services: SocratesSpeechRouteServices,
  request: SocratesCreateSpeechJobRequest,
  job: SocratesSpeechJob,
  now: () => string,
): Promise<SocratesSpeechJob> => {
  const startedAt = Date.now()
  await services.persistence.updateSpeechJob({ jobId: job.id, update: { status: "running", startedAt: now() } })

  if (request.kind === "transcription") {
    const artifactContent = await services.persistence.readSpeechArtifact({
      artifactId: request.inputArtifactId,
    })
    const audio = readArtifactBytes(artifactContent)
    let result: SpeechTranscription
    if (request.engine === "local_whisper") {
      if (!isWavArtifact(artifactContent.artifact)) {
        throw new SocratesError("v2_local_stt_wav_required", "Local Whisper requires mono WAV input. Recordings must be normalized before transcription.", {
          details: { artifactId: request.inputArtifactId, mimeType: artifactContent.artifact.mimeType },
          recoverable: true,
        })
      }
      result = await withTemporaryWav(audio, (wavPath) =>
        services.localWhisper.transcribe({
          modelId: request.modelId,
          wavPath,
          ...(request.language ? { language: request.language } : {}),
        }),
      )
    } else {
      result = await services.openRouter.transcribe({
        modelId: request.modelId,
        audio,
        format: artifactAudioFormat(artifactContent.artifact),
        ...(request.language ? { language: request.language } : {}),
      })
    }
    return socratesSpeechJobSchema.parse(await services.persistence.updateSpeechJob({
      jobId: job.id,
      update: {
        status: "completed",
        completedAt: now(),
        durationMs: Math.max(0, Math.round((result.durationSeconds ?? (Date.now() - startedAt) / 1_000) * 1_000)),
        transcriptText: result.text,
        ...(result.usage ? { usage: result.usage } : {}),
        ...(result.raw === undefined ? {} : { providerRaw: result.raw }),
      },
    }))
  }

  if (request.modelId !== SOCRATES_LOCAL_KOKORO_MODEL_ID) {
    throw new SocratesError("v2_tts_model_not_allowed", "That speech synthesizer is not enabled for Socrates.", {
      recoverable: true,
    })
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-v2-tts-"))
  const outputPath = path.join(directory, "speech.wav")
  try {
    await services.kokoro.synthesize({
      text: request.inputText,
      outputPath,
      speakerId: parseKokoroSpeaker(request.voiceId),
      speed: request.speed,
    })
    const audio = fs.readFileSync(outputPath)
    const artifact = socratesArtifactSchema.parse(await services.persistence.createSpeechArtifact({
      ...(request.goalId ? { goalId: request.goalId } : {}),
      ...(request.turnId ? { turnId: request.turnId } : {}),
      kind: "speech_output",
      fileName: `socrates-${job.id}.wav`,
      mimeType: "audio/wav",
      data: audio,
    }))
    return socratesSpeechJobSchema.parse(await services.persistence.updateSpeechJob({
      jobId: job.id,
      update: {
        status: "completed",
        completedAt: now(),
        durationMs: Math.max(0, Date.now() - startedAt),
        outputArtifactId: artifact.id,
      },
    }))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

export const registerSocratesSpeechRoutes = async (
  app: FastifyInstance,
  services: SocratesSpeechRouteServices,
): Promise<void> => {
  const now = services.now ?? (() => new Date().toISOString())
  const maxUploadBytes = services.maxUploadBytes ?? MAX_SPEECH_UPLOAD_BYTES

  app.get("/api/socrates/speech/packs", async (_request, reply) => {
    try {
      return ok({
        packs: Object.keys(SOCRATES_SPEECH_PACK_MANIFEST).map((packId) =>
          services.packs.status(packId as SpeechPackId),
        ),
      })
    } catch (error) {
      const { statusCode, response } = routeError(error)
      return reply.code(statusCode).send(response)
    }
  })

  app.get("/api/socrates/speech/packs/:packId", async (request, reply) => {
    try {
      return ok({ pack: services.packs.status(parseSpeechPackId(request.params)) })
    } catch (error) {
      const { statusCode, response } = routeError(error)
      return reply.code(statusCode).send(response)
    }
  })

  app.post("/api/socrates/speech/packs/:packId/install", async (request, reply) => {
    try {
      const packId = parseSpeechPackId(request.params)
      await services.packs.install(packId)
      return ok({ pack: services.packs.status(packId) })
    } catch (error) {
      const { statusCode, response } = routeError(error)
      return reply.code(statusCode).send(response)
    }
  })

  app.delete("/api/socrates/speech/packs/:packId", async (request, reply) => {
    try {
      const packId = parseSpeechPackId(request.params)
      services.packs.remove(packId)
      return ok({ removedPackId: packId, pack: services.packs.status(packId) })
    } catch (error) {
      const { statusCode, response } = routeError(error)
      return reply.code(statusCode).send(response)
    }
  })

  app.post("/api/socrates/speech/artifacts", async (request, reply) => {
    try {
      const upload = await request.file({ limits: { files: 1, fileSize: maxUploadBytes } })
      if (!upload) {
        throw new SocratesError("v2_audio_file_required", "Upload one audio recording.", { recoverable: true })
      }
      const mimeType = upload.mimetype.toLowerCase()
      if (!SUPPORTED_AUDIO_MIME_TYPES.has(mimeType)) {
        throw new SocratesError("v2_audio_type_not_supported", "That audio format is not supported for transcription.", {
          details: { mimeType, supportedMimeTypes: [...SUPPORTED_AUDIO_MIME_TYPES] },
          recoverable: true,
        })
      }
      const data = await upload.toBuffer()
      if (data.byteLength === 0) {
        throw new SocratesError("v2_audio_empty", "The recording is empty.", { recoverable: true })
      }
      if (data.byteLength > maxUploadBytes) {
        throw new SocratesError("v2_audio_too_large", "The recording exceeds the speech upload limit.", {
          details: { maxBytes: maxUploadBytes, receivedBytes: data.byteLength },
          recoverable: true,
        })
      }
      const artifact = socratesArtifactSchema.parse(await services.persistence.createSpeechArtifact({
        kind: "speech_input",
        fileName: safeUploadName(upload.filename),
        mimeType,
        data,
      }))
      return ok({ artifact })
    } catch (error) {
      const { statusCode, response } = routeError(error)
      return reply.code(statusCode).send(response)
    }
  })

  app.post("/api/socrates/speech/jobs", async (request, reply) => {
    let job: SocratesSpeechJob | undefined
    try {
      const input = parse(socratesCreateSpeechJobRequestSchema, request.body, "invalid_request") as SocratesCreateSpeechJobRequest
      job = socratesSpeechJobSchema.parse(await services.persistence.createSpeechJob({ request: input }))
      const completed = await executeSpeechJob(services, input, job, now)
      return ok(socratesCreateSpeechJobResponseSchema.parse({ job: completed }))
    } catch (error) {
      if (job) await failCreatedJob(services, job, error, now)
      const { statusCode, response } = routeError(error)
      return reply.code(statusCode).send(response)
    }
  })

  app.get("/api/socrates/speech/jobs/:jobId", async (request, reply) => {
    try {
      const { jobId } = parse(jobParamsSchema, request.params, "invalid_route_params")
      return ok({ job: socratesSpeechJobSchema.parse(await services.persistence.getSpeechJob(jobId)) })
    } catch (error) {
      const { statusCode, response } = routeError(error)
      return reply.code(statusCode).send(response)
    }
  })

  app.get("/api/socrates/speech/artifacts/:artifactId/content", async (request, reply) => {
    try {
      const { artifactId } = parse(artifactParamsSchema, request.params, "invalid_route_params")
      const content = await services.persistence.readSpeechArtifact({ artifactId })
      const data = readArtifactBytes(content)
      return reply
        .type(content.artifact.mimeType ?? "application/octet-stream")
        .header("content-disposition", "inline; filename=\"socrates-speech.wav\"")
        .send(data)
    } catch (error) {
      const { statusCode, response } = routeError(error)
      return reply.code(statusCode).send(response)
    }
  })
}

export const SOCRATES_SPEECH_HOSTED_MODEL_ALLOWLIST = SOCRATES_OPENROUTER_STT_MODEL_IDS
