export { createDefaultSocratesAgent, findModelOption, listModels } from "./agent/createDefaultSocratesAgent"
export {
  SocratesAgent,
  type SocratesAgentContextPrecomputeInput,
  type SocratesAgentEvent,
  type SocratesAgentTurnInput,
  type StableCachePreludeSnapshot,
} from "./agent/SocratesAgent"
export {
  CompressorAgent,
  type CompressorAgentMode,
  type CompressorAgentModel,
  type CompressorAgentResult,
  type CompressorAgentRunInput,
} from "./agent/CompressorAgent"
export {
  AgentRuntime,
  type AgentRuntimeResult,
  type AgentRuntimeStructuredInput,
  type AgentRuntimeStructuredResult,
  type AgentRuntimeTextInput,
  type AgentRuntimeTextResult,
} from "./agent/AgentRuntime"
export {
  AgentInstance,
  type AgentInstanceInput,
} from "./agent/AgentInstance"
export {
  assertRoleManifestMatchesCapabilities,
  defineAgent,
  defineContextProfile,
  defineRoleManifest,
  describeAgentDefinition,
  type AgentCompletionDefinition,
  type AgentContextStage,
  type AgentDefinition,
  type AgentDefinitionInventoryEntry,
  type AgentLimits,
  type AgentPersistenceScope,
  type AgentPromptDefinition,
  type AgentStructuredOutputSchema,
  type ContextProfile,
  type RoleManifest,
} from "./agent/AgentDefinition"
export {
  ContextPipeline,
  type AgentContextPipeline,
  type ContextPipelinePrecomputeInput,
  type ContextPipelinePrecomputeResult,
  type ContextPipelinePrepareInput,
  type ContextPipelinePrepareResult,
} from "./agent/ContextPipeline"
export {
  chatCompressorAgentDefinition,
  globalMemoryAgentDefinition,
  memoryCompressorAgentDefinition,
  phaseOneAgentDefinitionInventory,
  phaseOneAgentDefinitions,
  skillWriterAgentDefinition,
  socratesMainAgentDefinition,
  type DynamicSystemPromptContext,
} from "./agent/agentDefinitions"
export type { ActiveGoalCard, GoalCandidateCard } from "./agent/goalContext"
export {
  createResolvedTurnContextSeed,
  prepareTurnContext,
  renderResolvedTurnContext,
} from "./agent/prepareTurnContext"
export {
  DEFAULT_COMPRESSOR_MODEL,
  DEFAULT_COMPRESSOR_FALLBACK_MODEL,
  CONTEXT_MODEL_DISPATCH_CEILING_TOKENS,
  DEFAULT_CONTEXT_COMPRESSION_THRESHOLDS,
  COMPRESSOR_SYSTEM_PROMPT,
  buildCompressorUserMessageContent,
  estimateModelContextTokens,
  estimateTokens,
  type CompleteCompactionSnapshotInput,
  type ContextCompactionLifecycleEvent,
  type ContextCompactionSummary,
  type ContextCompressionThresholds,
  type ContextCompressionRuntime,
  type FailCompactionSnapshotInput,
  type StartCompactionSnapshotInput,
} from "./context/contextCompression"
export {
  EXACT_GOAL_HISTORY_MAX_RECENT_MESSAGES,
  EXACT_GOAL_HISTORY_MAX_RETRIEVED_ITEMS,
  selectExactGoalHistory,
  type RetrievedExactGoalHistoryItem,
} from "./context/exactGoalHistory"
export {
  RECONCILIATION_ACTIVITY_EVIDENCE_LIMIT,
  RECONCILIATION_LONG_TASK_MS,
  ReconciliationWatermarkController,
  buildSocratesReconciliationNotice,
  type ReconciliationCheckpoint,
  type ReconciliationCheckpointReason,
  type ReconciliationWatermarkState,
} from "./agent/reconciliationWatermark"
export { buildSocratesDynamicContext, buildSocratesSystemPrompt, socratesBasePrompt, type SocratesPromptContext } from "./prompts/socratesPrompt"
export { buildMemoryAgentSystemPrompt, memoryAgentBasePrompt, type MemoryAgentPromptContext } from "./prompts/memoryPrompt"
export { buildSkillWriterSystemPrompt, skillWriterBasePrompt, type SkillWriterPromptContext } from "./prompts/skillWriterPrompt"
export type { SocratesGoalResolutionCandidate } from "./prompts/socratesGoalResolutionPrompt"
export {
  SOCRATES_COMPRESSOR_SYSTEM_PROMPT,
  buildSocratesCompressorUserContent,
  renderChatCompactionMarkdown,
  type CompressorTurnInput,
  type SocratesCompressorUserPromptInput,
} from "./prompts/socratesCompressorPrompt"
export {
  MEMORY_AGENT_COMPRESSOR_SYSTEM_PROMPT,
  buildMemoryAgentCompressorUserContent,
  renderMemoryCompactionMarkdown,
  type MemoryAgentCompressorUserPromptInput,
} from "./prompts/memoryAgentCompressorPrompt"
export {
  CapabilityCatalog,
  CapabilitySet,
  capabilityCatalog,
  capabilityInventory,
  canonicalCapabilities,
  emptyCapabilitySet,
} from "./capabilities/CapabilityCatalog"
export type {
  CapabilityDefinition,
  CapabilityInventoryEntry,
  CapabilityKind,
  ModelToolCapabilityDefinition,
} from "./capabilities/CapabilityDefinition"
export { canonicalProviderInputSchema, projectModelTool } from "./capabilities/providerProjection"
export type { ApprovalDecision, ApprovalRequest, FileFreshnessTracker, ToolExecutorContext, ToolExecutors, ToolLifecycleEvent } from "./tools/types"
export * from "./retrieval"
export * from "./socrates"
export { SOCRATES_SURFACES, renderSocratesSurfaceMap, socratesSurface, type SocratesSurface } from "@socrates/contracts"
