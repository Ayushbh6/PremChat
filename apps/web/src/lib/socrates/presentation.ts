import type {
  SocratesGoalExchange,
  SocratesMessage,
  SocratesToolCall,
} from "@socrates/contracts";
import type { SocratesRuntimeState } from "./reducer";
import type { SocratesSocketStatus } from "./socket";

export type SocratesDisplayMode = "current" | "history";

export type SocratesClientView = Readonly<{
  displayMode: SocratesDisplayMode;
  viewedGoalId?: string;
  viewedExchangeId?: string;
}>;

export type SocratesDisplayedExchange = Readonly<{
  id: string;
  taskId?: string;
  goalId?: string;
  rootTurnId: string;
  currentTurnId: string;
  status: "running" | "waiting" | "completed" | "failed" | "cancelled";
  userMessage: SocratesMessage;
  assistantMessage?: SocratesMessage;
  streamingAnswer?: string;
  exactExchange?: SocratesGoalExchange;
}>;

export type SocratesStage =
  | Readonly<{ kind: "idle"; label: string }>
  | Readonly<{ kind: "recovery"; label: string }>
  | Readonly<{ kind: "working"; label: string; phase: string }>
  | Readonly<{ kind: "awaiting_input"; label: string }>
  | Readonly<{ kind: "final"; label: string }>
  | Readonly<{ kind: "failed"; label: string }>
  | Readonly<{ kind: "cancelled"; label: string }>;

export type SocratesLiveWorkItem = Readonly<{
  id: string;
  label: string;
  detail: string;
  kind: "tool" | "file" | "memory" | "terminal" | "evidence" | "context";
  state: "active" | "completed" | "waiting" | "failed";
}>;

const ACTIVE_TURN_STATUSES = new Set(["queued", "routing", "awaiting_clarification", "running", "waiting", "suspended"]);

const safeString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, 140) : undefined;

const safeToolDetail = (tool: SocratesToolCall): string => {
  if (!tool.arguments || typeof tool.arguments !== "object" || Array.isArray(tool.arguments)) return tool.status;
  const input = tool.arguments as Record<string, unknown>;
  const key = ["path", "filePath", "uri", "query", "command", "name"]
    .find((candidate) => safeString(input[candidate]));
  return key ? safeString(input[key])! : tool.status.replaceAll("_", " ");
};

const toolKind = (name: string): SocratesLiveWorkItem["kind"] => {
  const normalized = name.toLowerCase();
  if (normalized.includes("terminal") || normalized.includes("exec")) return "terminal";
  if (normalized.includes("memory") || normalized.includes("note") || normalized.includes("repo_docs")) return "memory";
  if (normalized.includes("read") || normalized.includes("write") || normalized.includes("edit") || normalized.includes("file")) return "file";
  if (normalized.includes("search") || normalized.includes("retriev")) return "evidence";
  return "tool";
};

const toolState = (status: SocratesToolCall["status"]): SocratesLiveWorkItem["state"] => {
  if (status === "completed") return "completed";
  if (status === "failed" || status === "cancelled") return "failed";
  if (status === "awaiting_approval") return "waiting";
  return "active";
};

const exchangeFromCanonical = (exchange: SocratesGoalExchange): SocratesDisplayedExchange => ({
  id: exchange.taskId,
  taskId: exchange.taskId,
  goalId: exchange.goalId,
  rootTurnId: exchange.rootTurnId,
  currentTurnId: exchange.currentTurnId,
  status: exchange.status === "ready" ? "waiting" : exchange.status,
  userMessage: exchange.userMessage,
  ...(exchange.assistantMessage ? { assistantMessage: exchange.assistantMessage } : {}),
  exactExchange: exchange,
});

const latestMessage = (
  messages: readonly SocratesMessage[],
  predicate: (message: SocratesMessage) => boolean,
): SocratesMessage | undefined => [...messages].reverse().find(predicate);

const currentExchange = (
  runtime: SocratesRuntimeState,
  exchanges: readonly SocratesGoalExchange[],
): SocratesDisplayedExchange | null => {
  const { snapshot } = runtime;
  const task = snapshot.activeTask ?? snapshot.latestTask;
  const turn = snapshot.activeTurn;
  const matchingCanonical = task
    ? exchanges.find((exchange) => exchange.taskId === task.id || exchange.rootTurnId === task.rootTurnId)
    : undefined;
  if (matchingCanonical && !turn) return exchangeFromCanonical(matchingCanonical);

  const rootTurnId = task?.rootTurnId ?? turn?.id;
  const currentTurnId = task?.currentTurnId ?? turn?.id;
  const userMessage = rootTurnId
    ? latestMessage(snapshot.messages, (message) => message.role === "user" && message.turnId === rootTurnId)
    : latestMessage(snapshot.messages, (message) => message.role === "user" && message.kind !== "routing_clarification");
  if (!userMessage) return matchingCanonical ? exchangeFromCanonical(matchingCanonical) : null;

  const answerTurnId = currentTurnId ?? userMessage.turnId;
  const assistantMessage = latestMessage(snapshot.messages, (message) =>
    message.role === "assistant" && (!answerTurnId || message.turnId === answerTurnId));
  const streamEntry = Object.entries(runtime.streams)
    .filter(([messageId]) => !answerTurnId || messageId.includes(answerTurnId))
    .at(-1)?.[1];
  const taskStatus = task?.status;
  const status: SocratesDisplayedExchange["status"] = taskStatus === "waiting" || taskStatus === "ready"
    ? "waiting"
    : taskStatus === "failed"
      ? "failed"
      : taskStatus === "cancelled"
        ? "cancelled"
        : taskStatus === "completed" || assistantMessage?.status === "completed"
          ? "completed"
          : "running";
  return {
    id: task?.id ?? rootTurnId ?? userMessage.id,
    ...(task ? { taskId: task.id } : {}),
    goalId: task?.goalId ?? turn?.goalId ?? userMessage.goalId,
    rootTurnId: rootTurnId ?? userMessage.turnId ?? userMessage.id,
    currentTurnId: currentTurnId ?? userMessage.turnId ?? userMessage.id,
    status,
    userMessage,
    ...(assistantMessage ? { assistantMessage } : {}),
    ...(streamEntry?.answer ? { streamingAnswer: streamEntry.answer } : {}),
    ...(matchingCanonical ? { exactExchange: matchingCanonical } : {}),
  };
};

export const selectSocratesPresentation = (input: Readonly<{
  runtime: SocratesRuntimeState;
  exchanges: readonly SocratesGoalExchange[];
  view: SocratesClientView;
  socketStatus: SocratesSocketStatus;
  socketError?: string | null;
}>): Readonly<{
  displayedExchange: SocratesDisplayedExchange | null;
  currentExchange: SocratesDisplayedExchange | null;
  isDisplayingCurrent: boolean;
  stage: SocratesStage;
  liveWork: readonly SocratesLiveWorkItem[];
}> => {
  const current = currentExchange(input.runtime, input.exchanges);
  const historical = input.view.displayMode === "history"
    ? input.exchanges.find((exchange) =>
      exchange.goalId === input.view.viewedGoalId &&
      (exchange.taskId === input.view.viewedExchangeId || exchange.rootTurnId === input.view.viewedExchangeId))
    : undefined;
  const displayed = historical ? exchangeFromCanonical(historical) : current;
  const isDisplayingCurrent = !historical;
  const { snapshot } = input.runtime;
  const awaiting = Boolean(snapshot.pendingClarification)
    || snapshot.pendingApprovals.length > 0
    || snapshot.pendingCredentialRequests.length > 0
    || snapshot.activeTerminals.some((terminal) => terminal.awaitingInput);
  const active = Boolean(snapshot.activeTurn && ACTIVE_TURN_STATUSES.has(snapshot.activeTurn.status));

  let stage: SocratesStage;
  if ((input.socketStatus === "reconnecting" || input.socketStatus === "connecting" || input.socketStatus === "subscribing") && active) {
    stage = { kind: "recovery", label: "Recovering the live task and exact work trace…" };
  } else if (displayed?.status === "failed" || input.runtime.lastError) {
    stage = { kind: "failed", label: displayed?.exactExchange?.failure?.message ?? input.runtime.lastError?.message ?? "This task needs attention." };
  } else if (displayed?.status === "cancelled") {
    stage = { kind: "cancelled", label: "This task was cancelled." };
  } else if (awaiting && isDisplayingCurrent) {
    stage = {
      kind: "awaiting_input",
      label: snapshot.pendingClarification?.clarificationQuestion
        ?? (snapshot.pendingApprovals.length ? "Socrates needs your approval to continue." : "Socrates is waiting for your input."),
    };
  } else if (active && isDisplayingCurrent) {
    stage = {
      kind: "working",
      label: snapshot.liveActivity?.label ?? (snapshot.activeTurn?.status === "routing" ? "Finding the right focus…" : "Working on your request…"),
      phase: snapshot.liveActivity?.phase ?? snapshot.activeTurn?.status ?? "thinking",
    };
  } else if (displayed?.assistantMessage || displayed?.streamingAnswer) {
    stage = { kind: "final", label: historical ? "Historical exchange" : "Answer ready" };
  } else {
    stage = { kind: "idle", label: input.socketError ? "Reconnecting…" : "Ready for your next thought" };
  }

  const liveTools = isDisplayingCurrent ? snapshot.canonicalToolCalls : [];
  const canonicalTools = displayed?.exactExchange?.work?.toolCalls ?? [];
  const toolItems: SocratesLiveWorkItem[] = liveTools.length
    ? liveTools.map((tool) => ({
      id: tool.id,
      label: tool.toolName.replaceAll("_", " "),
      detail: safeToolDetail(tool),
      kind: toolKind(tool.toolName),
      state: toolState(tool.status),
    }))
    : canonicalTools.map((tool) => ({
      id: tool.id,
      label: tool.toolName.replaceAll("_", " "),
      detail: tool.status.replaceAll("_", " "),
      kind: toolKind(tool.toolName),
      state: toolState(tool.status),
    }));
  const evidenceItems: SocratesLiveWorkItem[] = (displayed?.exactExchange?.work?.evidence ?? []).map((evidence) => ({
    id: evidence.id,
    label: evidence.title,
    detail: evidence.sourceUri ?? evidence.sourceKind.replaceAll("_", " "),
    kind: evidence.sourceKind === "file" ? "file" : "evidence",
    state: "completed",
  }));
  const terminalItems: SocratesLiveWorkItem[] = (isDisplayingCurrent ? snapshot.activeTerminals : []).map((terminal) => ({
    id: terminal.id,
    label: terminal.name,
    detail: terminal.awaitingInput ? "Waiting for input" : `${terminal.status} · ${terminal.cwd}`,
    kind: "terminal",
    state: terminal.awaitingInput ? "waiting" : terminalStatusToWorkState(terminal.status),
  }));
  const compactionItems: SocratesLiveWorkItem[] = input.runtime.compactionLabel
    ? [{ id: "context-compaction", label: "Model context", detail: input.runtime.compactionLabel, kind: "context", state: "completed" }]
    : [];

  return {
    displayedExchange: displayed,
    currentExchange: current,
    isDisplayingCurrent,
    stage,
    liveWork: [...toolItems, ...terminalItems, ...evidenceItems, ...compactionItems].slice(-12),
  };
};

const terminalStatusToWorkState = (status: string): SocratesLiveWorkItem["state"] => {
  if (status === "exited" || status === "stopped") return "completed";
  if (status === "missing" || status === "stale") return "failed";
  return "active";
};
