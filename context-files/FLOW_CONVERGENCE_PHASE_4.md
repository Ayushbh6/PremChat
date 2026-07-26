# Flow Convergence Phase 4

> Historical implementation report only. `UNIFIED_SOCRATES_LIFECYCLE.md` is the current target for cross-view execution, bounded navigation/state, and remaining pre-merge cleanup.

Phase 4 completes the planned Flow-convergence presentation layer on top of the canonical work identity delivered in Phase 3. It implements Projects to Goals to Queries navigation, persistent focus selection, and the live-orb to validated-answer choreography without introducing another router, runner, store, or semantic workflow.

## Delivered Product Contract

Flow now presents one project Flow as three deliberate navigation levels:

```text
Projects
  -> Goals
       -> Queries
```

- Opening the drawer starts on Queries for the selected goal.
- One back action opens Goals for the current project; another opens Projects.
- Every level keeps its heading and controls fixed around one bounded scrolling list.
- Query counts and rows are computed from the canonical goal-to-message bindings returned by the backend.
- Selecting a goal changes presentation selection only. Completed, parked, or general goals are not reopened or otherwise mutated.
- Sending while a historical or completed goal is selected supplies that goal as a strong routing candidate; the Goal Router still owns the semantic continuation/new-goal decision.
- Goal completion never forces the visible focus back to General Conversation. The completed goal and its last task remain inspectable until the user or router selects something else.

Classic and Flow continue to project the same canonical tasks, messages, tool history, evidence, attachments, approvals, Terminal state, and goal lifecycle. **Open in Classic** lazily creates or reuses a presentation home; **Continue in Flow View** returns to the same canonical work. No Q&A copy is created.

## Runtime-Authored Live Activity

The server is the only authority for the live activity sentence. `V2LiveActivity` is a strict shared contract containing a turn id, a bounded phase, and a user-safe label. The runtime emits events for routing, model work, tool work, answer preparation, and actionable waits. The Flow store exposes only the latest activity for the active turn.

The frontend renders exactly one fixed activity slot beneath the active orb. Every new activity replaces the previous sentence in place; it is never accumulated as tags or a vertical log. Tool activity is mapped by the backend to bounded labels such as reading, searching, comparing, or updating. Raw tool arguments, opaque ids, undefined values, and unbounded provider errors are not activity labels.

Approvals, credentials, clarification, and Terminal input remain full interactive components because they require action rather than passive status. Errors use the bounded live-stage label `Flow needs attention` and expose useful detail separately in an accessible alert.

## Answer Choreography

While a turn is active:

1. The current user request remains visible.
2. The orb is the prominent anchor.
3. Exactly one server-authored activity sentence changes in place.
4. Provisional assistant text is not presented as a final answer.

Once a validated assistant message is durably available, the live stage disappears, the answer becomes foreground content, and the orb returns to its subtle background state. Persisted tool/reasoning history is one collapsed execution disclosure. Historical exchanges show only their saved answer and disclosure; live activity is never replayed as if work were still occurring. Reduced-motion preferences disable nonessential orbital and transition movement.

## Conservative Routing Recovery

The Goal Router remains the sole semantic routing authority and retains its three-call maximum for `goal_search`. Real-provider verification exposed one reliability edge: when the bounded router timed out, the deterministic fallback ignored an explicit user control such as `Create a new goal: ...` and continued General Conversation.

The fallback now recognizes only narrow, explicit create/start/open goal or focus commands. It does not infer topical similarity or replace normal model routing. Ordinary ambiguous language remains conservative and stays with the validated foreground goal.

## Code Homogeneity

Phase 4 extends existing shared seams:

- shared contracts own the live-activity schema and WebSocket event;
- the existing V2 runtime emits activity alongside its normal turn events;
- the existing Flow store owns persisted/replayed activity and view selection;
- the existing Goal Router coordinator receives the selected goal as a preferred candidate;
- the existing shared Classic transcript, composer, activity components, runtime, and canonical projections remain in use;
- Flow-specific React components own presentation only.

`runtime.ts` was kept below 1,000 lines by extracting telemetry helpers. There is no parallel activity runner, frontend tool parser, duplicate goal store, or Flow-only answer path.

## Verification

Automated coverage includes strict contract validation, replacement-style activity state, safe backend activity labels, runtime event order and replay, selection without lifecycle mutation, goal-scoped query grouping, explicit fallback routing, and Phase 0 gate promotion.

The isolated real DeepSeek browser run is recorded in `evals/flow-convergence/phase-4-real-e2e.md`. It verifies desktop and mobile activity replacement, multi-goal navigation, completed-focus persistence, selection without reopening, historical queries, and the Classic/Flow round trip against disposable state. This phase is an implementation and bounded validation milestone, not a release, cross-platform archive certification, or unattended 24-hour soak.
