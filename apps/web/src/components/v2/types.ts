export type FlowPresenceState =
  | "offline"
  | "idle"
  | "listening"
  | "routing"
  | "thinking"
  | "working"
  | "awaiting_input"
  | "complete"
  | "error";

export type FlowGoalStatus =
  | "foreground"
  | "parked"
  | "blocked"
  | "completed"
  | "discarded"
  | "archived";

export interface FlowGoalView {
  id: string;
  title: string;
  kind: "general" | "work";
  status: FlowGoalStatus;
  summary?: string;
  pinned: boolean;
  updatedAt?: string;
}

export interface FlowVoiceOption {
  id: string;
  label: string;
}

export interface FlowContextItemView {
  id: string;
  label: string;
  sourceType: string;
  tokenEstimate?: number;
}

export interface FlowContextSummary {
  items?: FlowContextItemView[];
  preservedEvidenceCount?: number;
  contextUsageLabel?: string;
  lastCompactedAt?: string;
  unavailableReason?: string;
}
