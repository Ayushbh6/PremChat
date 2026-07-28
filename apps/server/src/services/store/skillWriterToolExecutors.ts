import type {
  ApplyPatchToolOutput,
  BashToolOutput,
  EditToolOutput,
  MemoryNoteToolOutput,
  ReadToolInput,
  ReadToolOutput,
  SearchToolInput,
  SearchToolOutput,
  SkillWriteToolInput,
  SkillWriteToolOutput,
  TraceRetrieveGlobalToolInput,
  TraceRetrieveGlobalToolOutput,
  UrlFetchToolOutput,
} from "@socrates/contracts"
import type { ToolExecutors } from "@socrates/core"
import { SocratesError } from "@socrates/shared"
import { currentRuntimeTime } from "./runtimeContext"

export type SkillWriterToolCallbacks = {
  traceRetrieve: (input: TraceRetrieveGlobalToolInput) => Promise<TraceRetrieveGlobalToolOutput> | TraceRetrieveGlobalToolOutput
  read: (input: ReadToolInput) => Promise<ReadToolOutput> | ReadToolOutput
  search: (input: SearchToolInput) => Promise<SearchToolOutput> | SearchToolOutput
  skillWrite: (input: SkillWriteToolInput) => Promise<SkillWriteToolOutput> | SkillWriteToolOutput
}

export const createSkillWriterToolExecutors = (tools: SkillWriterToolCallbacks): ToolExecutors => {
  const unavailable = async <T>(): Promise<T> => {
    throw new SocratesError("skill_writer_tool_unavailable", "This tool is not available to the Skill Writer Agent.", { recoverable: true })
  }
  return {
    read: async (input) => tools.read(input),
    search: async (input) => tools.search(input),
    url_fetch: () => unavailable<UrlFetchToolOutput>(),
    edit: () => unavailable<EditToolOutput>(),
    apply_patch: () => unavailable<ApplyPatchToolOutput>(),
    bash: () => unavailable<BashToolOutput>(),
    current_time: () => Promise.resolve(currentRuntimeTime()),
    trace_retrieve: async (input) => tools.traceRetrieve(input as TraceRetrieveGlobalToolInput),
    memory_note: () => unavailable<MemoryNoteToolOutput>(),
    skill_write: async (input) => tools.skillWrite(input),
  }
}
