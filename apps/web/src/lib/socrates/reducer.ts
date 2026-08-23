import type {
  SocratesSnapshot,
  SocratesAgentTask,
  SocratesCredentialInputRequest,
  SocratesErrorRecord,
  SocratesServerEvent,
} from "@socrates/contracts";

export type SocratesMessageStream = Readonly<{ answer: string; reasoningAvailable: boolean }>;
export type SocratesTerminalOutput = Readonly<{ sequence: number; stream: string; text: string; redacted: boolean }>;

export type SocratesRuntimeState = Readonly<{
  snapshot: SocratesSnapshot;
  streams: Record<string, SocratesMessageStream>;
  terminalOutputs: Record<string, readonly SocratesTerminalOutput[]>;
  credentialRequests: Record<string, SocratesCredentialInputRequest>;
  lastError?: SocratesErrorRecord;
  compactionLabel?: string;
}>;

const upsert = <T extends { id: string }>(items: readonly T[], item: T): T[] => {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index < 0) return [...items, item];
  const next = [...items];
  next[index] = item;
  return next;
};

const without = <T extends { id: string }>(items: readonly T[], id: string): T[] =>
  items.filter((item) => item.id !== id);

const credentialsFromSnapshot = (snapshot: SocratesSnapshot): Record<string, SocratesCredentialInputRequest> =>
  Object.fromEntries(snapshot.pendingCredentialRequests.map((request) => [request.id, request]));

export const createSocratesRuntimeState = (snapshot: SocratesSnapshot): SocratesRuntimeState => ({
  snapshot,
  streams: {},
  terminalOutputs: {},
  credentialRequests: credentialsFromSnapshot(snapshot),
});

const terminalStatusIsActive = (status: string): boolean =>
  ["starting", "running", "awaiting_input", "detached"].includes(status);

export function reduceSocratesEvent(state: SocratesRuntimeState, event: SocratesServerEvent): SocratesRuntimeState {
  switch (event.type) {
    case "socrates.connection.ready":
      return state;
    case "socrates.state.snapshot":
      return {
        ...state,
        snapshot: event.payload.snapshot,
        credentialRequests: credentialsFromSnapshot(event.payload.snapshot),
        terminalOutputs: Object.fromEntries(Object.entries(state.terminalOutputs).filter(([terminalId]) =>
          event.payload.snapshot.activeTerminals.some((terminal) => terminal.id === terminalId))),
      };
    case "socrates.turn.started":
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          activeTurn: event.payload.turn,
          messages: upsert(state.snapshot.messages, event.payload.userMessage),
          canonicalToolCalls: [],
          liveActivity: {
            turnId: event.payload.turn.id,
            phase: "routing",
            label: "Finding the right focus…",
          },
        },
        lastError: undefined,
      };
    case "socrates.turn.updated": {
      const active = ["queued", "routing", "awaiting_clarification", "running", "waiting", "suspended"]
        .includes(event.payload.turn.status);
      const task = state.snapshot.activeTask ?? state.snapshot.latestTask;
      const terminalTaskStatus: SocratesAgentTask["status"] | undefined = event.payload.turn.status === "completed"
        ? "completed"
        : event.payload.turn.status === "failed"
          ? "failed"
          : event.payload.turn.status === "cancelled"
            ? "cancelled"
            : undefined;
      const updatedTask = task && terminalTaskStatus
        ? { ...task, status: terminalTaskStatus, currentTurnId: event.payload.turn.id, updatedAt: event.payload.turn.updatedAt }
        : task;
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          ...(active ? { activeTurn: event.payload.turn } : { activeTurn: undefined }),
          ...(active ? {} : { activeTask: undefined }),
          ...(updatedTask ? { latestTask: updatedTask } : {}),
          ...(active ? {} : { liveActivity: undefined }),
          state: active ? state.snapshot.state : { ...state.snapshot.state, activeTaskId: undefined },
        },
      };
    }
    case "socrates.activity.updated":
      return { ...state, snapshot: { ...state.snapshot, liveActivity: event.payload.activity } };
    case "socrates.message.delta": {
      const current = state.streams[event.payload.messageId] ?? { answer: "", reasoningAvailable: false };
      return {
        ...state,
        streams: {
          ...state.streams,
          [event.payload.messageId]: event.payload.channel === "answer"
            ? { ...current, answer: current.answer + event.payload.text }
            : { ...current, reasoningAvailable: true },
        },
      };
    }
    case "socrates.message.completed": {
      const streams = { ...state.streams };
      delete streams[event.payload.message.id];
      return {
        ...state,
        streams,
        snapshot: { ...state.snapshot, messages: upsert(state.snapshot.messages, event.payload.message) },
      };
    }
    case "socrates.goal.routed": {
      const goal = event.payload.goal;
      if (!goal) return state;
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          foregroundGoal: goal,
          goals: upsert(state.snapshot.goals, goal),
          state: { ...state.snapshot.state, foregroundGoalId: goal.id },
          pendingClarification: undefined,
        },
      };
    }
    case "socrates.routing.clarification.requested":
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          pendingClarification: event.payload.routingRun,
          messages: upsert(state.snapshot.messages, event.payload.message),
        },
      };
    case "socrates.routing.clarification.resolved":
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          pendingClarification: undefined,
          messages: upsert(state.snapshot.messages, event.payload.answerMessage),
        },
      };
    case "socrates.goal.transitioned":
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          goals: upsert(state.snapshot.goals, event.payload.goal),
          ...(event.payload.goal.status === "foreground" ? { foregroundGoal: event.payload.goal } : {}),
        },
      };
    case "socrates.goal.capsule.updated":
      return { ...state, snapshot: { ...state.snapshot, latestCapsules: upsert(state.snapshot.latestCapsules, event.payload.capsule) } };
    case "socrates.tool.call.updated":
      return { ...state, snapshot: { ...state.snapshot, canonicalToolCalls: upsert(state.snapshot.canonicalToolCalls, event.payload.toolCall) } };
    case "socrates.approval.updated":
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          pendingApprovals: event.payload.approval.status === "pending"
            ? upsert(state.snapshot.pendingApprovals, event.payload.approval)
            : without(state.snapshot.pendingApprovals, event.payload.approval.id),
        },
      };
    case "socrates.credential.input.requested":
      return {
        ...state,
        credentialRequests: { ...state.credentialRequests, [event.payload.request.id]: event.payload.request },
        snapshot: {
          ...state.snapshot,
          pendingCredentialRequests: upsert(state.snapshot.pendingCredentialRequests, event.payload.request),
        },
      };
    case "socrates.credential.input.resolved": {
      const credentialRequests = { ...state.credentialRequests };
      delete credentialRequests[event.payload.request.id];
      return {
        ...state,
        credentialRequests,
        snapshot: {
          ...state.snapshot,
          pendingCredentialRequests: without(state.snapshot.pendingCredentialRequests, event.payload.request.id),
        },
      };
    }
    case "socrates.terminal.updated":
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          activeTerminals: terminalStatusIsActive(event.payload.terminal.status)
            ? upsert(state.snapshot.activeTerminals, event.payload.terminal)
            : without(state.snapshot.activeTerminals, event.payload.terminal.id),
        },
      };
    case "socrates.terminal.output": {
      const previous = state.terminalOutputs[event.payload.terminalId] ?? [];
      const deduplicated = previous.filter((output) => output.sequence !== event.payload.sequence);
      return {
        ...state,
        terminalOutputs: {
          ...state.terminalOutputs,
          [event.payload.terminalId]: [...deduplicated, event.payload]
            .sort((left, right) => left.sequence - right.sequence)
            .slice(-500),
        },
      };
    }
    case "socrates.error.created":
      return { ...state, lastError: event.payload.error };
    case "socrates.context.compaction.started":
      return { ...state, compactionLabel: "Compacting older completed work while keeping the live request and newest evidence exact…" };
    case "socrates.context.compaction.completed":
      return { ...state, compactionLabel: "Older completed work was compacted with provenance; the live request and newest evidence remain exact." };
    case "socrates.context.compaction.failed":
      return { ...state, compactionLabel: "Automatic context compaction needs attention." };
    case "socrates.agent.handover":
    case "socrates.feedback.updated":
    case "socrates.artifact.created":
    case "socrates.speech.job.updated":
      return state;
  }
}
