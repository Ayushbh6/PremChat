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
  assertRoleManifestMatchesTools,
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
  anchorRepairAgentDefinition,
  chatCompressorAgentDefinition,
  globalMemoryAgentDefinition,
  memoryCompressorAgentDefinition,
  phaseOneAgentDefinitionInventory,
  phaseOneAgentDefinitions,
  skillWriterAgentDefinition,
  socratesMainAgentDefinition,
  soulConfirmationAgentDefinition,
  titleGeneratorAgentDefinition,
  type DynamicSystemPromptContext,
} from "./agent/agentDefinitions"
export {
  MemoryRouterAgent,
  type MemoryRouterAgentModelSettings,
  type MemoryRouterPreTurnInput,
  type ActiveGoalCard,
  type GoalCandidateCard,
} from "./agent/MemoryRouterAgent"
export {
  createResolvedTurnContextSeed,
  prepareTurnContext,
  renderResolvedTurnContext,
} from "./agent/prepareTurnContext"
export {
  GoalRouterAgent,
  type GoalRouterAgentInput,
  type GoalRouterAgentModelSettings,
} from "./agent/GoalRouterAgent"
export {
  TitleGeneratorAgent,
  type TitleGeneratorAgentInput,
  type TitleGeneratorAgentModelSettings,
  type TitleGeneratorAgentResult,
} from "./agent/TitleGeneratorAgent"
export {
  SoulConfirmationAgent,
  type SoulConfirmationAgentInput,
  type SoulConfirmationAgentModelSettings,
  type SoulConfirmationAgentResult,
} from "./agent/SoulConfirmationAgent"
export {
  DEFAULT_COMPRESSOR_MODEL,
  DEFAULT_COMPRESSOR_FALLBACK_MODEL,
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
  BOUNDED_GOAL_HISTORY_MAX_CHARS,
  BOUNDED_GOAL_HISTORY_MAX_RECENT_MESSAGES,
  BOUNDED_GOAL_HISTORY_MAX_RETRIEVED_ITEMS,
  selectBoundedGoalHistory,
  type RetrievedGoalHistoryItem,
} from "./context/boundedGoalHistory"
export {
  RECONCILIATION_ACTIVITY_EVIDENCE_LIMIT,
  RECONCILIATION_LONG_TASK_MS,
  ReconciliationWatermarkController,
  buildSocratesProgressReconciliationCheckpoint,
  type ReconciliationCheckpoint,
  type ReconciliationCheckpointReason,
  type ReconciliationWatermarkState,
} from "./agent/reconciliationWatermark"
export { buildSocratesDynamicContext, buildSocratesSystemPrompt, socratesBasePrompt, type SocratesPromptContext } from "./prompts/socratesPrompt"
export { buildMemoryAgentSystemPrompt, memoryAgentBasePrompt, type MemoryAgentPromptContext } from "./prompts/memoryPrompt"
export { buildSkillWriterSystemPrompt, skillWriterBasePrompt, type SkillWriterPromptContext } from "./prompts/skillWriterPrompt"
export { TITLE_GENERATOR_SYSTEM_PROMPT } from "./prompts/titleGeneratorPrompt"
export { SOUL_CONFIRMATION_AGENT_SYSTEM_PROMPT, buildSoulConfirmationUserContent } from "./prompts/soulConfirmationPrompt"
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
export { createCompressorToolRegistry, createDefaultToolRegistry, createFinalAnswerToolRegistry, createGoalRouterToolRegistry, createMemoryRouterToolRegistry, createMemoryToolRegistry, createSkillWriterToolRegistry, createSoulConfirmationToolRegistry, createTitleGeneratorToolRegistry, ToolRegistry } from "./tools/registry"
export type { ApprovalDecision, ApprovalRequest, ToolExecutorContext, ToolExecutors, ToolLifecycleEvent } from "./tools/types"
export * from "./retrieval"
export * from "./v2"
export { SOCRATES_SURFACES, renderSocratesSurfaceMap, socratesSurface, type SocratesSurface } from "@socrates/contracts"
