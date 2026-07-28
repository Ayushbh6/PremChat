import type { ConversationToolApproval, ConversationToolRun, ServerEvent } from "@socrates/contracts";

export type ToolTimelineStatus = ConversationToolRun["status"];

export type PendingApproval = ConversationToolApproval & {
  toolCallId?: string;
};

export type PendingCredentialInput = Extract<ServerEvent, { type: "credential.input.requested" }>["payload"] & {
  turnId: string;
  status: "pending" | "submitted" | "cancelled";
};

export type ToolTimelineItem = Omit<ConversationToolRun, "approval"> & {
  displayName: string;
  category: string;
  status: ToolTimelineStatus;
  argsPreview?: string;
  output: string;
  stdout?: string;
  stderr?: string;
  error?: string;
  modelCallId?: string;
  stepIndex?: number;
  approval?: ConversationToolApproval;
  // Set while the model is still streaming this tool call's arguments (pre-approval/pre-run).
  phase?: "streaming";
  pathPreview?: string;
};

export const toolRunToTimelineItem = (run: ConversationToolRun): ToolTimelineItem => ({
  ...run,
  displayName: displayNameForTool(run.toolName),
  category: categoryForTool(run.toolName),
  output: run.shell ? [run.shell.stdout, run.shell.stderr].filter(Boolean).join("\n") : run.resultPreview ?? "",
  stdout: run.shell?.stdout,
  stderr: run.shell?.stderr,
});

export const displayNameForTool = (toolName: string): string => {
  switch (toolName) {
    case "read":
      return "Read";
    case "search":
      return "Search";
    case "edit":
      return "Edit";
    case "apply_patch":
      return "Apply Patch";
    case "bash":
      return "Terminal";
    case "wait":
      return "Wait";
    case "trace_retrieve":
      return "Trace";
    case "capability_manager":
      return "Capability Manager";
    case "memory_note":
      return "Memory Note";
    case "context_disposition":
      return "Context Disposition";
    case "current_time":
      return "Current Time";
    case "url_fetch":
      return "URL Fetch";
    case "handover_to_frontier":
      return "Calling Frontier model";
    default:
      if (toolName.startsWith("mcp__")) {
        return toolName.replace(/^mcp__/, "MCP ");
      }
      return toolName;
  }
};

export const categoryForTool = (toolName: string): string => {
  switch (toolName) {
    case "read":
      return "file";
    case "search":
      return "search";
    case "edit":
    case "apply_patch":
      return "patch";
    case "bash":
    case "wait":
      return "shell";
    case "trace_retrieve":
      return "trace";
    case "capability_manager":
      return "mcp";
    default:
      if (toolName.startsWith("mcp__")) {
        return "mcp";
      }
      return "other";
  }
};
