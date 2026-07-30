# Socrates Application Flow

This document describes the live product journey. The semantic product is goals containing exact Q&A exchanges and task-owned work. There is no project, conversation, or alternate-mode selection in the primary experience.

## Entry

```text
/ -> /welcome
/welcome -- Open Socrates --> /chat
```

`/welcome` contains one primary action. `/chat` bootstraps the durable global Socrates state directly. Old project and seamless URLs redirect to `/chat`; they do not render a second product.

`/onboarding` is obsolete and redirects statelessly to `/chat`. Identity, provider credentials, and model choices are managed from the full Settings and Memory Agent surfaces.

## The /chat shell

The shell occupies `100dvh` and has three visual layers without hard header/footer bands:

```text
fixed header      [Goals toggle]                         [Paths] [Access] [Settings]
middle scroll     one exact user query + live work or one exact saved answer
fixed composer    attachments | primary model | thinking | voice | send/stop
```

Only the middle layer scrolls. The composer reserves its own bottom inset so answer text never sits behind it.

The center shows exactly one exchange. A long user message remains exact in persistence but collapses visually after the configured line threshold with Show more/Show less.

## Goals and exact history

The left drawer is a searchable two-stage navigator, not an expandable hierarchy:

```text
Goals                         select             Exact exchanges
Current goal                ---------->         <- Goals
Earlier goal                                     exact Q&A
Completed goal                                   exact Q&A
```

Opening the drawer always starts on Goals. Choosing one goal replaces the drawer body with that goal's exact exchanges; the fixed back control restores the goal list. Goals and exchanges are never concatenated into one scrolling surface and exchanges never appear nested beneath a goal row.

Opening a saved Q&A is passive. It changes only `viewedGoalId`, `viewedExchangeId`, and `displayMode` in client presentation state. It never mutates `foregroundGoalId`, reopens a goal, or branches history.

The composer stays usable while history is open. Sending always returns to the canonical live tail, persists a new root task/user message, and runs the ordinary same-Socrates goal decision. A user can explicitly continue an earlier goal, but merely viewing it is not that instruction.

## Turn lifecycle

Every user send follows one backend-owned sequence:

```text
persist exact user message
  -> retrieve goal, memory, and capability candidates in parallel
  -> same-Socrates decision: current | retrieved older | new | clarify
  -> bind root task to one canonical goal
  -> deterministically select exact memory
  -> run one foreground Socrates tool loop
  -> validate the terminal answer plus goal state
  -> atomically commit answer, task, goal, capsule, usage, and evidence
  -> publish the saved answer
  -> run asynchronous memory enrichment
```

An explicit reference to “this goal”, “the current goal”, or “the same goal” selects the current goal unless the user names a different retrieved goal. A new goal requires a genuinely independent outcome.

The main model may call tools repeatedly. After every tool result it either calls another real capability or submits the canonical structured final object. OpenRouter models receive that same final schema through a provider-native terminal submission projection; the projection is normalized immediately and is never shown or persisted as a user tool.

## Living sphere and live work

One persistent sphere represents presentation state only:

- idle: quiet and ready;
- routing/memory: gathering the right context;
- working: one current safe activity sentence;
- awaiting input: approval, clarification, credential, or Terminal controls are visible;
- preparing answer: the validated commit is being prepared;
- final: the sphere recedes behind the saved answer;
- recovery/failure/cancel: the exact durable state is shown truthfully.

Activity copy replaces itself in one line. It never accumulates into a feed. Detailed reasoning availability, tools, approvals, credentials, Terminal output, compaction, recovery, and evidence live in one expandable work disclosure.

The answer enters the foreground only after the atomic commit. Provider preambles, malformed output, partial tool calls, and unsaved drafts never become a visible final answer.

## Movable notes

Desktop keeps two poster-board notes above the canvas:

- Live Work: recent files, tools, memory, evidence, compaction, and Terminal state.
- Live Goal: the backend-authoritative foreground goal and active/latest task.

They are presentation projections only. Dragging uses explicit handles; keyboard arrows move by a fixed step, Shift moves farther, and positions are clamped to the visible surface. One versioned per-device layout stores positions and z-order. The canvas exposes no reset-notes control. Narrow screens fold the notes into accessible panels so they cannot cover the exchange or composer.

## Paths, Access, and Settings

Paths manages canonical filesystem roots. Access is one durable global mode:

- Read only: structured read/search is automatic globally; every mutation and Terminal `run/start` requires approval.
- Selected: structured read/search remains global; writes inside selected canonical roots are automatic, writes elsewhere and every Terminal `run/start` require approval.
- Full access: ordinary structured mutations, Terminal launches, capability changes, and external side effects are automatic.

Every task captures an immutable access snapshot. Later header changes affect later tasks only. Terminal `inspect/list/stop` remains automatic. Frontier always requires approval and rejection disables it for the current task. Credentials and clarifications remain typed waits. Catastrophic operations are hard denied in every mode. A native platform adapter is the Terminal containment authority; preflight remains defense in depth and automatic Full Terminal fails closed if containment is unavailable.

The fixed Settings control navigates to the existing full `/settings` page; `/chat` does not implement a parallel settings drawer. That page owns provider credentials, global MCP configuration for Main Socrates, canonical worker models, voice packs, embedding prerequisites, updates, and related preferences, and its **Memory Agent** action opens the existing `/memory` Memory Center. The Memory Center has no MCP management or dynamic MCP tool access. It may surface evidence-backed skill proposals, while approved skill writes remain owned by the separate Skill Writer.

## Interactive continuation

Clarification, approval, credential, and Terminal input are first-class live states. Terminal continuation stays attached to the same root task/exchange without creating a new user message. A reconnect or server restart hydrates the active task, turn, pending action, terminals, outputs, and runtime event sequence before live events resume.

Stop cancels the current turn without manufacturing an answer. Retry creates a truthful new attempt on the live tail and preserves the failed exchange/evidence.

## Deletion

Deleting a saved exchange or goal is explicit and backend-authorized. Canonical evidence cannot be removed by routine runtime code. A narrow deletion authorization covers the requested task/turn/goal, then expires. Workspace files and durable memory are separate authorities and are never silently deleted with UI history.

## Responsive and motion rules

- Desktop and tablet retain fixed header/composer and middle-only scrolling.
- Sidebar and settings overlay the canvas rather than permanently shrinking it.
- Mobile keeps the composer reachable and folds movable notes.
- Focus is trapped in modal/drawer surfaces and restored on close.
- Status changes use live-region semantics without announcing every animation frame.
- `prefers-reduced-motion` removes continuous sphere/transition motion while keeping state legible.

## Verification contract

Mutating tests use an isolated `SOCRATES_HOME`, SQLite database, workspace, ports, provider credentials, and Terminal state. Production readiness requires contract/store/runtime tests, builds and typechecks, real browser checks, provider acceptance, multi-turn goal/history checks, access modes, central global/resource knowledge, Terminal/MCP/skills, compaction, reconnect/restart, trace recovery, responsive layouts, and reduced motion. Disposable E2E state is evidence only; it never proves or mutates the user’s normal `~/.Socrates`.
