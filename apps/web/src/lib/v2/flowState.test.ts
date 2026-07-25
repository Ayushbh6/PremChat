import type { V2FlowSnapshot, V2Goal, V2ServerEvent } from "@socrates/contracts";
import { describe, expect, it } from "vitest";
import { initialV2FlowRuntimeState, v2FlowRuntimeReducer } from "./flowState";

const timestamp = "2026-07-25T12:00:00.000Z";

const goal = (status: V2Goal["status"]): V2Goal => ({
  id: "goal_review",
  flowId: "flow_1",
  projectId: "project_1",
  ordinal: 1,
  title: "Review the focus ledger",
  kind: "work",
  status,
  origin: "router",
  priority: 50,
  pinned: false,
  lastActiveAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  ...(status === "completed" ? { completedAt: timestamp } : {}),
});

const snapshot = (selectedGoal: V2Goal): V2FlowSnapshot => ({
  flow: {
    id: "flow_1",
    projectId: "project_1",
    status: "active",
    foregroundGoalId: selectedGoal.id,
    revision: 1,
    lastEventSequence: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  foregroundGoal: selectedGoal,
  goals: [selectedGoal],
  latestCapsules: [],
  messages: [],
  messageWindow: { hasEarlier: false },
  canonicalToolCalls: [],
  activeTerminals: [],
  pendingApprovals: [],
  lastEventSequence: 0,
});

describe("V2 Flow runtime focus state", () => {
  it("keeps a completed goal selected when lifecycle changes", () => {
    const active = goal("foreground");
    const completed = goal("completed");
    const event = {
      id: "event_1",
      schemaVersion: 2,
      timestamp,
      projectId: "project_1",
      flowId: "flow_1",
      goalId: completed.id,
      actor: { type: "system" },
      type: "v2.goal.transitioned",
      payload: {
        goal: completed,
        transition: {
          id: "transition_1",
          flowId: "flow_1",
          goalId: completed.id,
          fromStatus: "foreground",
          toStatus: "completed",
          reason: "completed",
          sequence: 1,
          createdAt: timestamp,
        },
      },
    } satisfies V2ServerEvent;

    const next = v2FlowRuntimeReducer(initialV2FlowRuntimeState(snapshot(active)), { type: "event", event });

    expect(next.snapshot.flow.foregroundGoalId).toBe(completed.id);
    expect(next.snapshot.foregroundGoal).toEqual(completed);
  });

  it("replaces live activity in one slot and clears it when the turn becomes terminal", () => {
    const active = goal("foreground");
    const initial = initialV2FlowRuntimeState(snapshot(active));
    const activityEvent = (id: string, label: string): V2ServerEvent => ({
      id,
      schemaVersion: 2,
      timestamp,
      projectId: "project_1",
      flowId: "flow_1",
      turnId: "turn_1",
      actor: { type: "system" },
      type: "v2.activity.updated",
      payload: { activity: { turnId: "turn_1", phase: "tool", label } },
    });
    const first = v2FlowRuntimeReducer(initial, { type: "event", event: activityEvent("event_2", "Searching the workspace…") });
    const replaced = v2FlowRuntimeReducer(first, { type: "event", event: activityEvent("event_3", "Reading runtime.ts…") });
    expect(replaced.liveActivity).toMatchObject({ label: "Reading runtime.ts…" });

    const terminalEvent = {
      id: "event_4",
      schemaVersion: 2,
      timestamp,
      projectId: "project_1",
      flowId: "flow_1",
      turnId: "turn_1",
      actor: { type: "system" },
      type: "v2.turn.updated",
      payload: {
        turn: {
          id: "turn_1",
          flowId: "flow_1",
          projectId: "project_1",
          ordinal: 1,
          status: "completed",
          startedAt: timestamp,
          completedAt: timestamp,
          updatedAt: timestamp,
        },
      },
    } satisfies V2ServerEvent;
    expect(v2FlowRuntimeReducer(replaced, { type: "event", event: terminalEvent }).liveActivity).toBeUndefined();
  });
});
