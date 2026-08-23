import Fastify from "fastify"
import cors from "@fastify/cors"
import multipart from "@fastify/multipart"
import path from "node:path"
import { openDatabase, runMigrations, type DatabaseHandle } from "./db/client"
import { SocratesStore } from "./services/store"
import { createDefaultSocratesAgent, type SocratesAgent } from "@socrates/core"
import { McpRuntime } from "@socrates/mcp"
import type { EmbeddingProvider, ModelProvider } from "@socrates/providers"
import { ProviderCredentialStore } from "./services/providerCredentials"
import { registerSocratesRoutes } from "./routes/socratesRoutes"
import { registerSocratesSpeechRoutes } from "./routes/socratesSpeechRoutes"
import { GlobalSocratesStore } from "./services/socrates/socratesStore"
import {
  LocalKokoroSynthesizer,
  LocalWhisperTranscriber,
  OpenRouterTranscriber,
  SpeechPackManager,
} from "./services/socrates/speech"
import { registerSocratesWebSocketRoutes } from "./runtime/websocket"

export type BuildServerOptions = {
  dbPath: string
  logger?: boolean
  databaseHandle?: DatabaseHandle
  agent?: SocratesAgent
  embeddingProvider?: EmbeddingProvider
  memoryProvider?: ModelProvider
  socratesHome?: string
  preserveTerminalsOnClose?: boolean
}

export const buildServer = async (options: BuildServerOptions) => {
  const handle = options.databaseHandle ?? openDatabase(options.dbPath)
  runMigrations(handle)

  const socratesHome = options.socratesHome ?? (options.dbPath === ":memory:" ? undefined : path.dirname(options.dbPath))
  const credentials = new ProviderCredentialStore(socratesHome ? { socratesHome } : {})
  const store = new SocratesStore(handle, options.embeddingProvider, credentials, {
    ...(socratesHome ? { socratesHome } : {}),
    ...(options.memoryProvider ? { memoryProvider: options.memoryProvider } : {}),
  })
  store.cancelStaleActiveTurns()
  store.requeueInterruptedTerminalTasks()
  await store.initializeRetrieval()
  store.startGlobalMemoryScheduler()
  const agent = options.agent ?? createDefaultSocratesAgent(credentials)
  const mcpRuntime = new McpRuntime(socratesHome ? { socratesHome } : {})
  const app = Fastify({ logger: options.logger ?? false })
  const speechHome = socratesHome ?? path.dirname(options.dbPath)
  const socratesStore = new GlobalSocratesStore(handle, {
    globalWorkspacePath: path.resolve(speechHome, "global-workspace"),
    ensureLocalUser: () => { store.ensureLocalUser() },
    getGlobalWorkingRoot: () => store.getDefaultFilesystemWorkingRoot(),
  })
  socratesStore.recoverInterruptedTurns()
  const speechPacks = new SpeechPackManager(speechHome)
  const runtimeRoot = process.env.SOCRATES_RUNTIME_DIR ?? path.join(speechHome, "runtime")
  const executableName = (name: string): string => process.platform === "win32" ? `${name}.exe` : name
  const speechBinary = (environmentName: string, defaultName: string): string =>
    process.env[environmentName] ?? path.join(runtimeRoot, "speech", "bin", executableName(defaultName))
  const whisperCliOverride = process.env.SOCRATES_WHISPER_CPP_BINARY
  const openRouterTranscriber = new OpenRouterTranscriber(credentials)
  const localWhisperTranscriber = new LocalWhisperTranscriber({
    binaryPath: speechBinary("SOCRATES_WHISPER_CPP_BINARY", "whisper-cli"),
    modelPath: (model) => speechPacks.status(model === "base.en" ? "whisper-base.en" : "whisper-small.en").path,
    preferCli: Boolean(whisperCliOverride),
  })

  app.get("/api/socrates/capabilities", async () => ({
    ok: true,
    data: {
      enabled: true,
      product: "socrates",
      contractVersion: 3,
      speech: {
        localStt: ["whisper.cpp/base.en", "whisper.cpp/small.en"],
        hostedStt: [
          "nvidia/parakeet-tdt-0.6b-v3",
          "microsoft/mai-transcribe-1.5",
          "mistralai/voxtral-mini-transcribe",
        ],
        localTts: ["kokoro-82m"],
      },
    },
  }))

  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024,
      files: 25,
    },
  })
  await app.register(cors, {
    origin: [/^http:\/\/127\.0\.0\.1:\d+$/, /^http:\/\/localhost:\d+$/],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })

  await registerSocratesRoutes(app, socratesStore, store, { ...(socratesHome ? { socratesHome } : {}) })
  const socratesWebSocketRuntime = await registerSocratesWebSocketRoutes(app, {
      store: socratesStore,
      sharedStore: store,
      agent,
      mcpRuntime,
      supervisorScope: socratesHome ?? path.dirname(options.dbPath),
    })

  await registerSocratesSpeechRoutes(app, {
      persistence: socratesStore,
      packs: speechPacks,
      openRouter: openRouterTranscriber,
      localWhisper: localWhisperTranscriber,
      kokoro: new LocalKokoroSynthesizer({
        binaryPath: speechBinary("SOCRATES_SHERPA_ONNX_TTS_BINARY", "sherpa-onnx-offline-tts"),
        modelDirectory: path.dirname(speechPacks.status("kokoro-en-v0_19").path),
      }),
    })

  app.addHook("onClose", async () => {
    await socratesWebSocketRuntime.shutdown()
    socratesStore.recoverInterruptedTurns("Socrates shut down before this response completed.")
    store.cancelStaleActiveTurns("Socrates shut down before this response completed.")
    store.requeueInterruptedTerminalTasks()
    await store.close()
  })

  return app
}
