# Socrates Flow North Star

This document is the product-intent authority for how Classic and Flow must feel and behave as Socrates converges on one underlying runtime state. It defines the durable user model and invariants. `UNIFIED_SOCRATES_LIFECYCLE.md` is the detailed technical target and required cleanup boundary. `V2_FLOW_ARCHITECTURE.md` records current implementation and migration mechanics; `FLOW_CONVERGENCE_PHASE_*.md` files are historical evidence only. When current mechanics or phase reports conflict with this North Star or the unified lifecycle, they are migration debt rather than product precedent.

## User Promise

Flow exists for a user who has a task and wants to start doing it without first managing chats, context windows, or topic boundaries.

The user should be able to say:

> I need this done.

Socrates must determine where that work belongs, preserve the relevant continuity, suppress unrelated material, and begin useful work. Entering Flow must reduce context-management work for the user rather than transfer that work to the main model through repeated retrieval.

## One Socrates, Two Views

Classic and Flow are two presentations of the same Socrates. They must converge on one canonical work state:

- The same projects, workspace, `.socrates` surfaces, global memory, identity, skills, MCPs, providers, and model settings.
- The same user and assistant turns, tool history, evidence, artifacts, approvals, Terminal state, waits, continuations, usage, errors, and task lifecycle.
- The same goals, goal notes, task state, retrieval foundation, context compressor, main-agent loop, permissions, and finalization semantics.
- The same canonical identity for a piece of work regardless of which view displays or continues it.

The views may differ only in presentation and in how the next active scope is selected:

```text
Classic UI -- user-selected conversation scope --+
                                                +--> one Socrates runtime state
Flow UI ------- Socrates-selected goal scope -----+
```

The shared prepared context must tell the main model which presentation produced the turn and what history aperture it received: Classic means the selected conversation; Flow means the selected goal. This is one small typed context clause inside the same Socrates prompt and runtime, not separate Classic and Flow personas or prompt harnesses.

Cross-view navigation must use references and projections over canonical work. Copying visible Q&A into replacement turns or messages is not the target architecture because duplicated semantic state can drift.

## Canonical Product Concepts

### Conversation

A Classic conversation is a user-selected presentation and grouping boundary. It can contain several goals. Selecting a Classic conversation gives Socrates strong initial scope, but it does not create a separate memory, tool, task, or execution universe.

### Goal

A goal is a coherent workstream or desired outcome. It can contain several tasks, survive view changes, remain selected after completion, and be reopened when the user meaningfully continues it.

A goal must not be fragmented merely because one answer completed one task. Its title may evolve when the same workstream expands, for example:

```text
Review the focus ledger
  -> Review and improve the focus ledger
```

### Task

A task is one user-request lifecycle inside a goal. It begins with a user request and includes the model work, tools, approvals, Terminal waits, automatic continuations, and final answer required to handle that request.

Tasks complete frequently. Goals complete only when the coherent workstream's currently requested outcome has been achieved.

### Flow

Flow is the project-level focus experience. It presents one selected goal and, within it, one current task. A Flow is not a Classic conversation, a browser visit, or a new persistence universe. One project Flow must not automatically become one enormous Classic conversation.

## Central Goal-Continuity Rule

Suppose the user asks:

> Check how the focus ledger is built and tell me what you find.

Socrates may create:

```text
Goal: Review the focus ledger
Task 1: Inspect how it is built
```

When Socrates gives a correct, substantive answer, Task 1 may complete. If that answer fully handled the current requested outcome, the goal may also be marked completed.

Completion does not delete, archive, deselect, or replace the goal with General Conversation. The UI may remain focused on:

```text
Review the focus ledger
Completed
```

If the user then says:

> Now update the focus ledger by adding this information.

the router should reopen and expand the same coherent goal:

```text
Goal: Review and improve the focus ledger
State: active

Task 1: Inspect how it is built       completed
Task 2: Add the requested information active
```

It must not create a disconnected goal merely because the preceding task produced a final answer.

## Goal Status Is Not View Selection

These are separate facts:

```text
goal.status
  active | completed | blocked | discarded

view.selectedGoal
  the goal currently displayed to the user
```

Completing a goal must not automatically select General Conversation. General Conversation becomes selected only when a later routing decision genuinely chooses it or the user explicitly navigates there.

Historical turns retain their original goal association permanently. When the user views an earlier query, the UI shows the focus associated with that query even if the project's currently selected goal is different.

## Routing Responsibilities

### Classic

The user has already selected a conversation. The Classic routing policy identifies which canonical goal owns the new task inside that conversation. It should preserve meaningful follow-ups, reopen a completed goal when the user continues the same workstream, and create a new goal only for a genuinely separate outcome.

### Flow

The user supplies a task without managing a conversation. The Flow routing policy chooses or creates the canonical goal that owns it. Flow may use bounded automatic candidates and a narrowly scoped goal-search capability when necessary.

Both policies resolve to the same canonical goal and task state. They do not maintain Classic and Flow versions that later need semantic reconciliation.

## Flow Context Contract

Flow must not send only the isolated latest message. The normal main-agent request includes:

1. The shared stable Socrates context and runtime capabilities.
2. The selected goal and its current capsule/state.
3. The current task and latest user request.
4. Relevant visible Q&A belonging to the selected goal.
5. A bounded transition bridge from the immediately preceding exchanges, even when the new task begins a related new goal.
6. Explicit dependency anchors to related goals or source turns when the current request relies on them.
7. The same tools, evidence access, permissions, workspace, Terminal, waits, and continuation state available through Classic.

For example, after finishing memory-ledger work, the user may say:

> Great, now let's move to trace retrieve.

That can create a new `Review trace retrieval` goal, but the request must also carry enough transition context to explain what “now” and “move to” mean. Socrates should use retrieval for exact older evidence, not merely to understand an ordinary adjacent follow-up.

Operational standard:

> If an ordinary follow-up or view transition requires Socrates to search simply to determine what the user means, context assembly has failed.

Goal membership defines the eligible history corpus; it never authorizes injecting every task belonging to a large goal. The runtime always attaches the current task, its continuation chain, the goal capsule, active blockers/open decisions, and a small recent tail. Older task outcomes are selected through bounded shared retrieval and exact Q&A is inspected only when needed. Prompt projections enforce item and token/character caps even when a goal contains hundreds of tasks.

## Flow Navigation Hierarchy

Flow navigation is a three-level drill-in, not a flat project-wide query list and not a giant nested tree:

```text
Projects
  -> Goals in the selected project
     -> Queries/tasks in the selected goal
```

The shared sidebar opens on the current goal's Queries level. One back action opens Goals for the current project; another opens Projects. Each level has one fixed heading/control region and one independently scrolling list.

When a new goal begins, the previous goal remains available with its actual state and the new goal becomes selected. The Queries level then shows only tasks belonging to the selected goal. The user did not create or open a conversation; Socrates created a useful workstream boundary automatically.

The UI keeps these facts distinct:

```text
selectedGoal
  the goal currently viewed and used as a strong composer scope

runningTask
  the task currently executing or waiting
```

Clicking a completed goal displays its task history without silently reopening it. Sending a meaningful continuation while viewing it gives the router a strong explicit candidate; the router reopens that goal only when the new request actually continues the workstream.

## Flow Execution Choreography

Visual thesis: one calm cream workspace with the living Socrates orb as the sole active visual anchor.

Content plan: exact user query, prominent active orb, one live activity sentence, fixed composer, then the validated answer and one collapsed execution disclosure.

Interaction thesis: the orb gains presence while work is live; one fixed-height activity sentence crossfades in place as the current phase changes; the validated answer enters the foreground while the orb recedes behind it.

### Active turn

After send, the current user query remains above the orb. The orb floats and revolves with restrained stateful motion. Immediately beneath it is exactly one ephemeral activity line:

```text
Finding the right focus…
```

That same line is replaced in place as work advances:

```text
Searching the tool registry…
Reading traceRetrieveTool.ts…
Comparing four related files…
Preparing the answer…
```

These examples describe successive values of one slot. They must never accumulate vertically into a list of thoughts, tool tags, or status rows. Parallel work is summarized into the same sentence. The slot has a stable height so the orb, canvas, notes, and composer do not jump.

The transition between statuses is a restrained crossfade or slight vertical replacement. Raw internal control text, malformed tool envelopes, opaque ids, `undefined`, and unbounded provider reasoning must never become the activity label. The runtime owns a bounded human-facing label derived from typed phase/tool state; the frontend renders it and does not invent agent semantics.

Approvals, credentials, Terminal input, and other states requiring user action remain full interactive components. They are not compressed into the ephemeral activity sentence.

### Completed turn

The final answer must not enter the reading layer until its structured result passes schema and integrity validation and is durably saved. Once valid:

1. The answer enters above the orb as the primary reading layer.
2. The orb scales/fades into the existing subtle background presence rather than remaining above the answer.
3. The ephemeral activity sentence disappears.
4. Execution history becomes one collapsed disclosure such as `Thinking · 11 tool calls`, expandable for the persisted detailed trace.
5. The composer remains fixed and the answer owns the readable foreground.

The collapsed disclosure is not the live status slot. It appears only after completion or when the user explicitly opens trace detail. Historical exchanges never replay live activity.

Motion must respect reduced-motion preferences. State changes must remain understandable without animation.

## Cross-View Navigation

### Classic to Flow

When the user enters Flow from a Classic conversation, preserve the same conversation association, selected goal, current task, and canonical execution state. Flow changes the projection to the selected goal/task; it does not import or copy the work.

If a Classic-origin task is already running, navigation does not migrate or restart it. The task completes with the Classic context projection fixed at its start while Flow subscribes to the same canonical live events and result. If Flow remains selected, the next user-authored task uses the Flow goal projection. Flow-to-Classic is symmetrical. View navigation never rebinds a running task.

Returning to Classic opens the same originating conversation.

### Flow to Classic

If Flow-origin work already has a Classic home, open it. If it has no Classic home, create a Classic conversation lazily only when the user explicitly opens the work in Classic, then present the same canonical turns through that conversation.

Do not copy all project goals into the new conversation. Several goals may share one Classic conversation when they genuinely originated there, while unrelated Flow-origin goals may acquire separate Classic homes only when needed.

## Finalization Contract

Goal finalization belongs to the main Socrates turn that owns the answer, not to a detached post-turn model judging a provisional draft.

The target lifecycle is:

```text
prepareTurnContext
  -> Goal Router binds the exact goal/task
  -> read-only pre-turn Memory Router retrieves for that resolved scope
  -> main Socrates tool loop
  -> same-Socrates progress checkpoints when a long task reaches a durable milestone
  -> mandatory same-Socrates pre-final reconciliation checkpoint
  -> strict structured final result
  -> validate answer integrity
  -> persist the answer and its goal state atomically
  -> publish the completed answer to the UI
```

There is no post-evidence/post-turn Memory Router. Reconciliation judgment, writes, re-reads, and verification belong to the same main Socrates that performed the work. The remaining Memory Router is pre-turn and read-only.

The structured result contains the visible final answer, goal state, and a short goal note. The final call does not choose or re-guess a goal; runtime applies state/note only to the goal already bound to the current task. No valid persisted assistant answer means no task completion or goal-state mutation. A malformed tool envelope, internal control text, empty answer, or unsupported completion claim fails the integrity gate and must not complete the goal.

The canonical focus ledger stores compact goal/task/transition state, not transcripts, tools, files, patches, Terminal streams, or evidence dumps. Persistence may grow, but model and UI projections are always bounded and paginated. Main Socrates receives the resolved goal/task directly and has no mutable focus-ledger completion/update authority; exact older work comes through shared trace retrieval.

## Agent And Tool Homogeneity

Classic and Flow invoke the same main Socrates behavior after scope selection. A view must not fork the core tool loop, tool schemas, provider behavior, approvals, Terminal handling, memory surfaces, context compression, recovery, or final-answer contract.

View-specific routers are real agents under the repository's shared-agent rule: prompt module, shared runner, scoped tool registry and executors, strict contracts, bounded repair/failure policy, worker settings where independently configurable, and typed telemetry/persistence.

The target has one public `AgentRuntime` entrypoint beneath every main agent, router, compressor, memory worker, and specialized writer. It accepts a typed configuration for prompt/messages, scoped tools and executors, model settings, limits, multimodal message parts, hooks, and one explicit completion mode:

```text
text
structured
streaming tools plus structured final
```

It returns one event stream plus one final typed result. The full Socrates loop and bounded structured workers must not retain competing provider/tool loops with different normalization, recovery, telemetry, or final-output behavior. Thin agent modules supply different prompts, tools, schemas, budgets, and persistence adapters; the shared runtime owns execution mechanics.

The public API may delegate internally to context preparation, provider, tool, approval, recovery, validation, and telemetry components. One entrypoint is not permission to create one monolithic class or a positional boolean-heavy helper.

## Success Criteria

The product is moving toward this North Star only when all of the following are true:

- “What?” and similar short follow-ups remain attached to the preceding task and goal.
- Completing a goal does not visually eject the user to General Conversation.
- A direct continuation reopens the same goal instead of creating a duplicate.
- Entering Flow preserves the current conversation, goal, task, tools, and live execution state.
- Flow-origin work creates a Classic conversation only when the user asks to open it there.
- Switching views does not copy canonical Q&A, tool history, or execution state.
- Typical adjacent follow-ups start useful work without a context-reconstruction retrieval loop.
- Goals with hundreds of tasks still receive a bounded prompt projection and exact older history remains retrievable.
- The final visible answer is validated before its goal completion is committed.
- No post-turn Memory Router or mutable main-agent focus ledger can finalize/update the bound goal.
- Classic and Flow use one semantic trace contract and executor across presented-context, current-goal, and project scope.
- Flow navigation drills from Projects to Goals to the selected goal's Queries without mixing levels in one scroll surface.
- A live turn shows exactly one changing activity sentence beneath the orb; it never accumulates into a status list.
- After completion, the answer takes the foreground, the orb recedes, and detailed execution collapses behind one disclosure.
- Every model-driven capability enters through the same public Agent Runtime execution boundary.

## Migration Principle

The existing namespaced V2 persistence and bidirectional Classic bridge are released implementation reality and must be handled safely. They are not the target product model where they duplicate semantic work state.

Convergence work must preserve user data, existing Classic compatibility, recoverability, and explicit rollback. It must not perform a destructive migration or silently reinterpret existing records. New work should stop expanding duplicate-state assumptions and should move deliberately toward canonical identities with view projections.
