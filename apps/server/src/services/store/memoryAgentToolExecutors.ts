import type {
  ApplyPatchToolOutput,
  BashToolOutput,
  EditFilesToolInput,
  EditFilesToolOutput,
  EditToolOutput,
  MemoryNoteToolOutput,
  MemoryNotesToolInput,
  MemoryNotesToolOutput,
  ProjectsToolInput,
  ProjectsToolOutput,
  ReadMemoryJournalToolInput,
  ReadMemoryJournalToolOutput,
  ReadToolInput,
  ReadToolOutput,
  SearchToolInput,
  SearchToolOutput,
  TraceRetrieveGlobalToolInput,
  TraceRetrieveGlobalToolOutput,
  UrlFetchToolOutput,
} from "@socrates/contracts"
import type { ToolExecutors } from "@socrates/core"
import { SocratesError } from "@socrates/shared"
import { currentRuntimeTime } from "./runtimeContext"

export type MemoryAgentToolCallbacks = {
  traceRetrieve: (input: TraceRetrieveGlobalToolInput) => Promise<TraceRetrieveGlobalToolOutput> | TraceRetrieveGlobalToolOutput
  projects: (input: ProjectsToolInput) => Promise<ProjectsToolOutput> | ProjectsToolOutput
  read: (input: ReadToolInput) => Promise<ReadToolOutput> | ReadToolOutput
  search: (input: SearchToolInput) => Promise<SearchToolOutput> | SearchToolOutput
  memoryNotes: (input: MemoryNotesToolInput) => Promise<MemoryNotesToolOutput> | MemoryNotesToolOutput
  readMemoryJournal: (input: ReadMemoryJournalToolInput) => Promise<ReadMemoryJournalToolOutput> | ReadMemoryJournalToolOutput
  editFiles: (input: EditFilesToolInput) => Promise<EditFilesToolOutput> | EditFilesToolOutput
}

export const createMemoryAgentToolExecutors = (tools: MemoryAgentToolCallbacks): ToolExecutors => {
  const unavailable = async <T>(): Promise<T> => {
    throw new SocratesError("memory_agent_tool_unavailable", "This tool is not available to the backend memory agent.", { recoverable: true })
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
    projects: async (input) => tools.projects(input),
    memory_notes: async (input) => tools.memoryNotes(input),
    read_memory_journal: async (input) => tools.readMemoryJournal(input),
    edit_files: async (input) => tools.editFiles(input),
    memory_note: () => unavailable<MemoryNoteToolOutput>(),
  }
}
