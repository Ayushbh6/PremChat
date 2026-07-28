import type {
  ApplyPatchToolInput,
  ApplyPatchToolOutput,
  BashToolInput,
  BashToolOutput,
  CapabilityManagerToolInput,
  CapabilityManagerToolOutput,
  CurrentTimeToolInput,
  CurrentTimeToolOutput,
  ContextDispositionToolInput,
  ContextDispositionToolOutput,
  EditToolInput,
  EditToolOutput,
  MemoryNoteToolInput,
  MemoryNoteToolOutput,
  MemoryNotesToolInput,
  MemoryNotesToolOutput,
  ReadMemoryJournalToolInput,
  ReadMemoryJournalToolOutput,
  ModelToolDefinition,
  EditFilesToolInput,
  EditFilesToolOutput,
  ProjectsToolInput,
  ProjectsToolOutput,
  ReadToolInput,
  ReadToolOutput,
  RuntimeConfig,
  SearchToolInput,
  SearchToolOutput,
  SkillWriteToolInput,
  SkillWriteToolOutput,
  ToolName,
  ToolPermission,
  TraceRetrieveGlobalToolInput,
  TraceRetrieveGlobalToolOutput,
  TraceRetrieveMainToolInput,
  TraceRetrieveMainToolOutput,
  TraceRetrieveToolInput,
  TraceRetrieveToolOutput,
  UrlFetchToolInput,
  UrlFetchToolOutput,
  WaitToolInput,
  WaitToolOutput,
} from "@socrates/contracts"
import type { SocratesError } from "@socrates/shared"

export type FileFreshnessTracker = {
  record: (path: string, contentHash: string | undefined, workspacePath: string) => void
  validate: (path: string, actualHash: string | undefined, workspacePath: string) => void
}

export type ToolExecutorContext = {
  projectId: string
  conversationId: string
  sessionId: string
  turnId: string
  toolCallId?: string
  workspacePath: string
  runtimeConfig: RuntimeConfig
  fileFreshness?: FileFreshnessTracker
  /** Internal approval preview flag. Never part of a model-facing tool schema. */
  previewOnly?: boolean
  abortSignal?: AbortSignal
  onOutput?: (output: { stream: "stdout" | "stderr" | "log" | "result"; text?: string; data?: unknown }) => void
}

export type ToolExecutors = {
  read: (input: ReadToolInput, context: ToolExecutorContext) => Promise<ReadToolOutput>
  search: (input: SearchToolInput, context: ToolExecutorContext) => Promise<SearchToolOutput>
  url_fetch: (input: UrlFetchToolInput, context: ToolExecutorContext) => Promise<UrlFetchToolOutput>
  edit: (input: EditToolInput, context: ToolExecutorContext) => Promise<EditToolOutput>
  apply_patch: (input: ApplyPatchToolInput, context: ToolExecutorContext) => Promise<ApplyPatchToolOutput>
  bash: (input: BashToolInput, context: ToolExecutorContext) => Promise<BashToolOutput>
  capability_manager?: (
    input: CapabilityManagerToolInput,
    context: ToolExecutorContext,
    resolvedSecretEnv?: Readonly<Record<string, string>>,
  ) => Promise<CapabilityManagerToolOutput>
  wait?: (input: WaitToolInput, context: ToolExecutorContext) => Promise<WaitToolOutput>
  current_time: (input: CurrentTimeToolInput, context: ToolExecutorContext) => Promise<CurrentTimeToolOutput>
  trace_retrieve: (
    input: TraceRetrieveMainToolInput | TraceRetrieveGlobalToolInput | TraceRetrieveToolInput,
    context: ToolExecutorContext,
  ) => Promise<TraceRetrieveMainToolOutput | TraceRetrieveGlobalToolOutput | TraceRetrieveToolOutput>
  projects?: (input: ProjectsToolInput, context: ToolExecutorContext) => Promise<ProjectsToolOutput>
  edit_files?: (input: EditFilesToolInput, context: ToolExecutorContext) => Promise<EditFilesToolOutput>
  memory_note?: (input: MemoryNoteToolInput, context: ToolExecutorContext) => Promise<MemoryNoteToolOutput>
  memory_notes?: (input: MemoryNotesToolInput, context: ToolExecutorContext) => Promise<MemoryNotesToolOutput>
  read_memory_journal?: (input: ReadMemoryJournalToolInput, context: ToolExecutorContext) => Promise<ReadMemoryJournalToolOutput>
  skill_write?: (input: SkillWriteToolInput, context: ToolExecutorContext) => Promise<SkillWriteToolOutput>
  mcp_dynamic?: (input: { dynamicName: string; input: unknown }, context: ToolExecutorContext) => Promise<unknown>
}

export type ApprovalRequest = {
  approvalId: string
  toolCallId: string
  providerToolCallId?: string | undefined
  toolName: ToolName
  actionKind: "shell_command" | "file_write" | "patch_apply" | "git_commit" | "git_push" | "other"
  title: string
  description?: string
  actionPreview: string
  risk: "low" | "medium" | "high"
}

export type ApprovalDecision = {
  decision: "approved" | "rejected"
  reason?: string
}

export type CredentialInputRequest = {
  credentialRequestId: string
  toolCallId: string
  serverId: string
  serverLabel?: string | undefined
  envKey: string
  source: "user_input" | "workspace_env"
}

export type CredentialInputDecision = {
  decision: "submitted" | "cancelled"
  value?: string | undefined
  source: "user_input" | "workspace_env"
}

export type ToolRuntimeContext = Omit<ToolExecutorContext, "onOutput"> & {
  executors: ToolExecutors
  requestApproval: (request: ApprovalRequest) => Promise<ApprovalDecision>
  requestCredentialInput?: (request: CredentialInputRequest) => Promise<CredentialInputDecision>
  frontierModel?: {
    providerId: string
    modelId: string
  }
  modelCallId?: string | undefined
  stepIndex?: number | undefined
  applyContextDisposition?: (input: ContextDispositionToolInput) => Promise<ContextDispositionToolOutput>
}

export type ToolPolicyDecision =
  | { type: "auto" }
  | { type: "approval_required"; request: Omit<ApprovalRequest, "approvalId" | "toolCallId" | "toolName"> }
  | { type: "denied"; reason: string; code?: string; recoverable?: boolean; details?: SocratesError["details"] }

export type SocratesTool<TInput, TOutput> = Omit<ModelToolDefinition, "providerInputSchema"> & {
  name: ToolName
  displayName?: string
  resultSchema: NonNullable<ModelToolDefinition["resultSchema"]>
  permission: ToolPermission
  executeLane: "parallel" | "mutation"
  category: "file" | "search" | "shell" | "patch" | "trace" | "mcp" | "other"
  resultPreview: (output: TOutput) => string
  summary: (output: TOutput) => string
  metrics?: (output: TOutput) => {
    filesRead?: number
    filesEdited?: number
    commandsRun?: number
    searchesRun?: number
  }
  decidePolicy: (input: TInput, context: ToolRuntimeContext) => ToolPolicyDecision | Promise<ToolPolicyDecision>
  execute: (
    input: TInput,
    context: ToolRuntimeContext & {
      onOutput: NonNullable<ToolExecutorContext["onOutput"]>
    },
  ) => Promise<TOutput>
}

export type ToolLifecycleEvent =
  | {
      type: "tool.call.streaming"
      toolCallId: string
      providerToolCallId?: string | undefined
      toolName: ToolName
      category: SocratesTool<unknown, unknown>["category"]
      displayName: string
      argsPreview?: string
      pathPreview?: string
      modelCallId?: string | undefined
      stepIndex?: number | undefined
    }
  | {
      type: "tool.call.started"
      toolCallId: string
      providerToolCallId?: string | undefined
      toolName: ToolName
      category: SocratesTool<unknown, unknown>["category"]
      displayName: string
      argsPreview?: string
      input?: unknown
      requiresApproval: boolean
      modelCallId?: string | undefined
      stepIndex?: number | undefined
    }
  | {
      type: "tool.call.output"
      toolCallId: string
      providerToolCallId?: string | undefined
      stream: "stdout" | "stderr" | "log" | "result"
      text?: string
      data?: unknown
      modelCallId?: string | undefined
      stepIndex?: number | undefined
    }
  | {
      type: "tool.call.completed"
      toolCallId: string
      providerToolCallId?: string | undefined
      toolName: ToolName
      output: unknown
      summary: string
      resultPreview?: string
      metrics?: {
        filesRead?: number
        filesEdited?: number
        commandsRun?: number
        searchesRun?: number
      }
      durationMs?: number
      modelCallId?: string | undefined
      stepIndex?: number | undefined
    }
  | {
      type: "tool.call.failed"
      toolCallId: string
      providerToolCallId?: string | undefined
      toolName: ToolName
      error: SocratesError
      modelCallId?: string | undefined
      stepIndex?: number | undefined
    }
  | { type: "approval.requested"; request: ApprovalRequest }
  | { type: "approval.resolved"; approvalId: string; toolCallId: string; providerToolCallId?: string | undefined; decision: "approved" | "rejected" }
