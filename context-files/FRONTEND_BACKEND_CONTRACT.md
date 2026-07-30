# Socrates Frontend Backend Contract

Shared Zod schemas and TypeScript types in `packages/contracts` are executable authority. The frontend does not invent response/event shapes and the backend does not emit unvalidated global events.

## Product coordinates

The primary contract has goals, root tasks, exact exchanges, turns, and transport sessions. It has no project, conversation, or compatibility-container coordinate.

A WebSocket session is transport/recovery state only. Client history selection is presentation state only.

## Routes

```text
/                 -> /welcome
/welcome          one Open Socrates action
/chat             global Socrates shell
/onboarding       redirect to /chat
/projects/*       redirect to /chat
/seamless/*       redirect to /chat
```

## HTTP

```text
POST   /api/socrates/bootstrap
GET    /api/socrates/state
GET    /api/socrates/messages
GET    /api/socrates/goals
GET    /api/socrates/goals/:goalId/exchanges
GET    /api/socrates/history/search
GET    /api/socrates/events
GET    /api/socrates/context
POST   /api/socrates/evidence/retrieve
POST   /api/socrates/attachments
GET    /api/socrates/attachments/:attachmentId/content
DELETE /api/socrates/goals/:goalId
DELETE /api/socrates/goals/:goalId/exchanges/:taskId
DELETE /api/socrates/turns/:turnId
GET    /api/socrates/resources
POST   /api/socrates/resources/confirm
PATCH  /api/socrates/resources/:resourceId
POST   /api/socrates/resources/:resourceId/relink
GET    /api/socrates/knowledge
POST   /api/socrates/knowledge
PATCH  /api/socrates/knowledge/:entryId
DELETE /api/socrates/knowledge/:entryId
GET    /api/socrates/backups
POST   /api/socrates/backups/:backupId/reveal
```

Speech uses the same global prefix:

```text
GET/POST/DELETE /api/socrates/speech/packs...
POST            /api/socrates/speech/artifacts
POST/GET         /api/socrates/speech/jobs...
GET              /api/socrates/speech/artifacts/:artifactId/content
```

Filesystem authority is global:

```text
GET    /api/access
PATCH  /api/access
POST   /api/access/paths
PATCH  /api/access/paths/:rootId
DELETE /api/access/paths/:rootId
```

## Bootstrap and snapshot

`POST /api/socrates/bootstrap` is idempotent. It ensures the verified released-state archive and fresh canonical seed are complete, then returns a `SocratesSnapshot`. It never imports old work. `GET /api/socrates/state` is the non-mutating refresh.

The snapshot includes the global state, foreground goal, goal page, current capsules with resource projections, active/latest root task, exact messages, canonical tool calls, pending interactions, active terminals, live activity, and recovery sequence.

The backend supplies one active/latest root task explicitly. The frontend never chooses authority from array order.

## Exact exchanges

`SocratesGoalExchange` groups one canonical root task and all durable continuation turns. It contains the exact root user message, optional saved assistant answer, goal id, task/root/current turn ids, ordered turn ids, status, timestamps, work/evidence projection, and optional failure.

Pagination is by whole exchange and stable ordinal. Cursors never split a user/assistant pair. Search results resolve back to an exact exchange.

## WebSocket

Endpoint:

```text
WS /api/socrates/ws
```

Commands:

- `socrates.subscribe`, `socrates.unsubscribe`;
- `socrates.message.send`;
- `socrates.routing.clarification.respond`;
- `socrates.goal.update`;
- `socrates.turn.cancel`;
- `socrates.approval.decide`;
- `socrates.feedback.submit`;
- `socrates.interaction.resolve` for approvals, credentials, clarification, Frontier, and proposals;
- `socrates.resource.confirm`, `socrates.resource.bind`, and `socrates.resource.relink`;
- `socrates.terminal.stop/input/resize/rename`.

Events use `socrates.*` types and one monotonic global sequence. Hydration and replay cover state, tasks/messages, goal routing/transitions/capsules/resources, activity, tools, typed interactions, Terminal lifecycle/output, compaction, failures, feedback, artifacts, speech, and Frontier handover.

Reconnect sends the last acknowledged sequence. If replay is unavailable or the client is stale, the server returns a fresh snapshot. Events are idempotently reduced by canonical id.

## Presentation contract

One pure selector combines the snapshot/reducer state, exact exchange pages, socket status, and client view into:

- displayed exchange;
- canonical current exchange;
- whether history or live tail is displayed;
- one stage: idle, recovery, working, awaiting input, final, failed, or cancelled;
- safe Live Work items.

Components do not independently derive foreground state.

Exactly one safe activity label is live at a time. Raw provider chain-of-thought is not a display contract. Detailed public reasoning availability and exact work appear only in the disclosure.

A final answer is rendered only from a validated, atomically persisted assistant message. OpenRouter’s internal structured-final submission projection is normalized inside the provider adapter and never enters the canonical tool/event ledger.

## Client-only state

The browser may store:

- sidebar open state;
- `displayMode`, `viewedGoalId`, `viewedExchangeId`;
- query expansion;
- note positions and z-order;
- drawer/disclosure open state;
- composer draft and unsent attachments.

It may not store or mutate the current goal pointer, task binding, capsule, lifecycle, exact evidence, or access authority.

## Composer

The composer sends exact text and attachment ids with one runtime config. Model/thinking selection is initialized from one canonical source and reused by global settings and new sends. Send while viewing history first clears the client-only history view, then creates the canonical live-tail task. Stop sends cancellation for the active turn.

## Accessibility and recovery

Drawers/modals expose labels, trap focus where appropriate, restore focus on close, and honor Escape. Live status is announced without replaying an activity feed. Notes support keyboard movement. Reduced motion keeps all semantic states visible.

After reload/restart, the server snapshot—not stale browser state—restores running/waiting/failed/completed truth. Pending approvals, credentials, clarification, and Terminal input remain actionable.

## Evolution rule

Change the canonical schema first, then backend/store/runtime, generated guidance if applicable, frontend reducer/selector/components, and focused tests. Do not add a second socket family, frontend-only semantic enum, provider-only final schema, or compatibility owner.
