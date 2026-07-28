import {
  traceRetrieveGlobalToolInputSchema,
  traceRetrieveGlobalToolOutputSchema,
  traceRetrieveMainToolInputSchema,
  traceRetrieveMainToolOutputSchema,
  type TraceRetrieveGlobalToolOutput,
  type TraceRetrieveMainToolInput,
  type TraceRetrieveMainToolOutput,
} from "@socrates/contracts"
import type { SocratesTool } from "./types"

export const traceRetrieveTool: SocratesTool<typeof traceRetrieveMainToolInputSchema._type, typeof traceRetrieveMainToolOutputSchema._type> = {
  name: "trace_retrieve",
  description:
    "Recall prior visible work in the active project. Search the full project by default. Use lexical with a concise literal query (128 characters max), semantic for conceptual recall, combined for hybrid recall, and audit only for tool/shell/file/patch/error evidence. Narrow to presented_context or current_goal only when useful. Search returns at most 8 numbered results; use inspect with resultNumber for the exact Q&A parent, then continue a bounded inspection with offset=truncation.nextOffset. Internal conversation, Flow, goal, task, and turn ids are resolved by the backend and must not be requested or inferred. This tool cannot search other projects.",
  inputSchema: traceRetrieveMainToolInputSchema,
  resultSchema: traceRetrieveMainToolOutputSchema,
  permission: "read",
  executeLane: "parallel",
  category: "trace",
  decidePolicy: () => ({ type: "auto" }),
  execute: (input, context) => context.executors.trace_retrieve(input as TraceRetrieveMainToolInput, context) as Promise<TraceRetrieveMainToolOutput>,
  summary: (output) => `Retrieved ${output.results.length} trace result(s).`,
  resultPreview: (output) =>
    output.results
      .map((result) => `${result.resultNumber}. ${result.conversationTitle} turn ${result.turnNumber} (${result.matchedRole}): ${result.content.slice(0, 240)}`)
      .join("\n"),
}

export const globalTraceRetrieveTool: SocratesTool<typeof traceRetrieveGlobalToolInputSchema._type, typeof traceRetrieveGlobalToolOutputSchema._type> = {
  name: "trace_retrieve",
  description:
    "Recall any prior visible conversation across Socrates projects. This uses the same retrieval behavior as the main agent: lexical with a concise literal query (128 characters max), semantic for conceptual recall, combined for hybrid recall, and audit only for tool/shell/file/patch/error evidence. Search all projects by default or select projects by id/title. Search returns at most 8 numbered results; use inspect with resultNumber, turnId, or project/conversation/turn coordinates for the exact Q&A parent, then continue a bounded inspection with offset=truncation.nextOffset.",
  inputSchema: traceRetrieveGlobalToolInputSchema,
  resultSchema: traceRetrieveGlobalToolOutputSchema,
  permission: "read",
  executeLane: "parallel",
  category: "trace",
  decidePolicy: () => ({ type: "auto" }),
  execute: (input, context) => context.executors.trace_retrieve(input, context) as Promise<TraceRetrieveGlobalToolOutput>,
  summary: (output) => `Retrieved ${output.results.length} trace result(s).`,
  resultPreview: (output) =>
    output.results
      .map((result) => `${result.resultNumber}. ${result.projectTitle} / ${result.conversationTitle} turn ${result.turnNumber} (${result.matchedRole}): ${result.content.slice(0, 240)}`)
      .join("\n"),
}
