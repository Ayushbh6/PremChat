import {
  precomputeContextSnapshot,
  prepareContextForModelCall,
} from "../context/contextCompression"

export type ContextPipelinePrepareInput = Parameters<typeof prepareContextForModelCall>[0]
export type ContextPipelinePrepareResult = Awaited<ReturnType<typeof prepareContextForModelCall>>
export type ContextPipelinePrecomputeInput = Parameters<typeof precomputeContextSnapshot>[0]
export type ContextPipelinePrecomputeResult = Awaited<ReturnType<typeof precomputeContextSnapshot>>

export interface AgentContextPipeline {
  prepare(input: ContextPipelinePrepareInput): Promise<ContextPipelinePrepareResult>
  precompute(input: ContextPipelinePrecomputeInput): Promise<ContextPipelinePrecomputeResult>
}

export class ContextPipeline implements AgentContextPipeline {
  prepare(input: ContextPipelinePrepareInput): Promise<ContextPipelinePrepareResult> {
    return prepareContextForModelCall(input)
  }

  precompute(input: ContextPipelinePrecomputeInput): Promise<ContextPipelinePrecomputeResult> {
    return precomputeContextSnapshot(input)
  }
}
