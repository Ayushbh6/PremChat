# Unified Socrates Lifecycle

This document is the detailed architecture authority for the convergence of Classic and Flow. Read it together with `REPO_RULES.md` and `FLOW_NORTH_STAR.md` before planning, implementing, or reviewing any Socrates turn lifecycle, goal routing, memory routing, history assembly, trace retrieval, finalization, ledger, or cross-view work.

If a phase report, current implementation document, test, prompt, or released compatibility path conflicts with this target, that conflict is technical debt to remove. Historical phase files remain evidence of what was implemented; they do not override this contract.

## One Product Model

Classic and Flow are two projections of one Socrates:

```text
one canonical work state
one main Socrates runtime and tool policy
one goal and task identity model
one retrieval foundation
one finalization contract
two bounded history projections
```

Changing views never creates a second semantic copy of a goal, task, turn, message, tool run, evidence item, approval, Terminal, wait, usage record, error, artifact, or final result.

## Canonical Turn Lifecycle

Every new user request in Classic and Flow follows the same lifecycle:

```text
1. prepareTurnContext
   1a. Goal Router binds one exact canonical goal and current task
   1b. Pre-turn Memory Router retrieves memory for that resolved scope

2. Main Socrates receives the resolved goal, current task, bounded history,
   retrieved memory, and the shared tool/runtime surface

3. Main Socrates performs the work and tools

4. The same Socrates turn receives conditional progress reconciliation
   checkpoints during genuinely long or milestone-heavy work

5. The same Socrates turn receives one mandatory hard pre-final checkpoint,
   decides whether `.socrates` reconciliation is required, performs the
   required reads/writes, re-reads every changed section, and does not answer

6. The same Socrates returns one no-tool structured result:
   finalAnswer
   goalFinalization.state
   goalFinalization.note

7. Runtime validates the structured result and answer integrity

8. One transaction saves the assistant answer, completes the current task,
   applies state/note only to the goal already bound to the task, and refreshes
   the goal capsule

9. Only after that commit is the answer published
```

There is no post-evidence or post-turn Memory Router in the target lifecycle. The pre-turn Memory Router is read-only. It cannot select, create, reopen, update, block, complete, discard, or finalize a goal. It cannot plan post-turn writes. Reconciliation judgment and execution belong to the same main Socrates that performed the work.

There is no model re-routing during finalization. The final model call does not receive candidate goals and does not choose a goal id. The runtime applies its state and note only to the goal already bound at the beginning of the task.

## One Prepared Turn Context

The orchestration boundary is one provider-neutral `prepareTurnContext()` operation. Internally, goal routing completes before memory routing because memory selection depends on the resolved goal. The two decisions should remain separate initially for correctness, scoped tools, failure isolation, and measurement; the rest of Socrates receives one immutable result.

The runtime-owned shape is conceptually:

```text
project
  internal id, name, workspace

goal
  internal id, human title, objective, state, latest progress note

task
  internal id, human ordinal, exact current request, active state

transition
  optional prior-goal title, relationship, short verified outcome

history
  bounded view projection plus bounded goal continuity

memory
  bounded pre-turn retrieved sections
```

Opaque project, flow, conversation, goal, task, message, tool, Terminal, process, provider, vector, chunk, and database ids remain runtime/storage coordinates. They must not be used as the normal model-facing statement of what Socrates is doing.

The model receives a concise human form such as:

```text
CURRENT GOAL
Improve trace retrieval

GOAL OBJECTIVE
Make one trace contract behave identically in Classic and Flow.

GOAL PROGRESS
Canonical indexing is verified; Flow mode parity remains open.

CURRENT TASK - 4
Unify the Classic and Flow trace scopes.

LATEST USER REQUEST
<exact request>
```

The active goal and task remain stable for the full task lifecycle, including approvals, Terminal waits, automatic resumptions, context compression, progress checkpoints, and finalization.

## Goal And Task Finalization

A validated final answer completes the current task. It does not automatically complete the overarching goal.

`goalFinalization.state` is restricted to the already-bound goal:

```text
active     useful work remains in the coherent goal
completed  the coherent requested outcome is genuinely achieved
blocked    a real external dependency prevents progress
discarded  the user abandoned or replaced the goal
```

`goalFinalization.note` is one or two human-facing lines. The atomic commit stores the validated note as both the completed task outcome and the goal's latest progress note/capsule input. That makes older task outcomes available without a later detached summarizer.

No valid persisted assistant answer means no task completion and no goal-state mutation. Completion does not archive, deselect, or replace the displayed goal with General Conversation.

## Bounded Goal History

Goal membership defines the eligible history corpus; it never means every task is inserted into the prompt.

History selection is deterministic before it becomes retrieval-based:

1. Include the current task and its wait/resume continuation chain exactly.
2. Include the goal title, objective, latest capsule, active blockers, open decisions, and dependencies.
3. Include a small fixed number of the most recent tasks, with exact Q&A only while within budget.
4. Include an explicit preceding-goal transition only when routing stored that relationship.
5. Search older tasks within the already-bound goal when the latest request needs them.
6. Use `trace_retrieve` to inspect exact older Q&A or audit evidence.

The prompt projection must enforce both item and token/character budgets. A suitable target is no more than 8-10 history items, 3-5 recent exact Q&A pairs, and 4-6 retrieved older outcomes. Exact constants belong in one shared context policy and require tests; no caller may silently raise them to dump an entire goal.

For a goal with hundreds of tasks, older tasks are indexed using compact searchable fields: human task request/title, validated outcome, state, timestamps, important component/path labels, and blocker/decision labels. Full answers, tools, patches, files, Terminal output, and immutable evidence remain in canonical message/trace/audit storage.

Large-goal recall should use the shared hybrid lexical and embedding retrieval foundation, merge and deduplicate a bounded candidate set, and return only a few supporting outcomes. An optional local reranker may later rerank only the bounded candidate set after measured quality evidence. It is never a correctness dependency, never searches the full ledger directly, degrades cleanly when unavailable, and must never download/install a model without explicit user approval and clear size/runtime disclosure.

## Classic And Flow Context Projections

The shared lifecycle and tools are identical. Only the history aperture differs.

Classic normally projects:

- the selected conversation's recent exact Q&A;
- its older bounded conversation compaction;
- the resolved goal/current task and bounded goal continuity;
- retrieved memory.

Flow normally projects:

- the selected goal's current task and exact recent goal Q&A;
- the goal capsule and older bounded task outcomes;
- an explicit bounded transition bridge when needed;
- retrieved memory.

Flow does not require a Classic conversation. A technical transport/session/cache key is not semantic conversation state.

### Switching Views During A Running Task

View navigation never migrates or restarts a running task. The context projection is fixed when the task starts.

If a Classic-origin task is running when the user opens Flow:

1. The task continues with the Classic-prepared context and original bound goal.
2. Flow immediately subscribes to and projects the same canonical live task, tools, approvals, Terminal, waits, and answer.
3. Completion persists one canonical result visible from both views.
4. If Flow remains selected, the next user-authored task uses the Flow goal projection.

Flow-to-Classic is symmetrical. Opening another goal while work is running may change what the UI displays, but it cannot rebind the running task.

## Shared Trace Retrieval

Main Socrates uses one high-level trace tool and one backend executor in both views. The main model does not supply view-specific ids. The runtime already knows the project, bound goal, current task, and presented context.

The model-facing scopes are semantic:

```text
presented_context  canonical tasks/messages in the current prompt projection
current_goal       every canonical task bound to the active goal
project            all visible canonical Classic and Flow work in the project
```

Project is the default. Search supports the same lexical, semantic, combined, and audit modes in both views; bounded date/time, role/evidence-type, and result-limit filters; numbered results; and exact follow-up inspection by result number. Search results use human labels and timestamps. Opaque ids remain backend coordinates except where a tightly scoped inspect/audit compatibility contract temporarily requires one during migration.

Flow is focused, not blind. Its directly attached history is goal-scoped, while trace retrieval may deliberately search the current goal or entire project. Classic may similarly narrow to its presented context or current goal without giving the model a raw conversation id.

The retrieval index is a disposable projection over canonical SQLite sources. It must index both Classic and Flow turns and must not fork search behavior by view. In particular, a Flow adapter must never silently convert semantic or combined retrieval into lexical retrieval.

## Scalable Focus Ledger

The canonical work ledger stores compact structure, not transcripts or evidence dumps.

Goal records contain identity, title, objective, state, latest progress note, current-task pointer, pin state, and activity timestamps. Task records contain goal binding, ordinal, human request/title, state, validated outcome, source/runtime coordinates, and timestamps. Transition records contain source/destination goal, relationship, and a short verified reason/outcome.

The ledger must not store full conversations, raw tool calls, full files, patches, Terminal streams, every evidence item, or repeated append-only summaries. Those belong to canonical messages and trace/audit storage.

Persistence may contain many goals and tasks, but every consumer is bounded:

- UI lists are paginated or virtualized, normally 25 items per page.
- Goal Router receives selected/previous goals plus a small recent, pinned, and retrieved candidate set.
- Goal Router search may use at most three calls and accumulate at most 25 model-facing candidates.
- Main Socrates receives only the resolved goal/task context, not a bulk ledger list.
- Capsules are bounded replacement projections; only the latest is normal context.
- Historical capsule versions are audit/compaction material and are never bulk injected.

The target main-agent surface has no mutable `focus_ledger` completion/update authority. Goal binding is pre-turn runtime authority; final goal state/note comes from the validated main result. UI navigation and explicit user lifecycle controls operate through typed backend commands. If older goal work is needed, main Socrates uses shared trace retrieval instead of listing the project ledger.

## Reconciliation During Long Tasks

Reconciliation must not happen after every large read/write, and it must not be deferred exclusively to the end of a multi-hour task.

The same main Socrates receives a conditional progress checkpoint after semantic milestones such as:

- a substantial verified mutation batch;
- a meaningful subtask/milestone completion;
- suspension for approval, Terminal input, or an external dependency;
- an impending context-compaction boundary;
- a bounded long-task activity threshold;
- verified evidence contradicting current `.socrates` notes or repo docs.

Tool output size or lines changed may contribute a signal but cannot decide that durable knowledge changed. Large reads often require only context disposition; small changes may require important documentation reconciliation.

At a progress checkpoint, Socrates reviews only verified work since the previous reconciliation watermark. When durable project state, architectural decisions, blockers, workflows, or documented behavior changed, it reads the relevant project notes/memory/repo docs, applies the smallest canonical replacement, and re-reads the changed sections. Otherwise it continues without writing and does not answer.

Every task still receives one mandatory final checkpoint covering everything since the last watermark. The runtime decides when to inject checkpoints; Socrates alone decides and performs the bounded reconciliation. No separate router, summarizer, or writer judges the main work.

## Shared Runtime And Code Shape

Classic and Flow call one main Socrates turn API with one prepared-context contract, one tool registry, one executor contract, one context-compression policy, one provider loop, one approval/Terminal/wait lifecycle, and one structured-final contract.

View adapters may assemble their bounded history projection and transport typed events. They may not fork main-agent policy, tools, trace semantics, reconciliation, or finalization.

The implementation must remain modular. `AgentRuntime` is the one provider-neutral execution boundary, not a god class. Context preparation, routing adapters, history selection, tool execution, reconciliation checkpoints, final validation, persistence, and UI projection must live in focused modules. Files materially touched during convergence should be split before or while they remain above approximately 1,000 lines where responsibilities can be separated.

## Required Cleanup Before Merge

The convergence branch is not merge-ready until it:

1. Removes post-evidence/post-turn Memory Router prompts, contracts, tools, calls, telemetry phases, settings language, and tests.
2. Removes Memory Router goal-finalization fields completely; the remaining pre-turn result is read-only recall selection.
3. Removes mutable `focus_ledger` completion/update/blocker authority and `pendingFocusCompletion` fallback.
4. Makes the structured final result mandatory for normal Classic and Flow turns.
5. Injects exact human-readable goal, objective, progress, task ordinal/request, and bounded history into main Socrates and the final checkpoint.
6. Removes normal model-facing opaque work ids.
7. Uses one main tool registry/executor contract and one trace-retrieval implementation in both views.
8. Fixes Flow lexical/semantic/combined/audit/inspect parity without requiring a Classic conversation.
9. Bounds and paginates goal/task/capsule access; removes bulk ledger output such as 100-goal model contracts.
10. Splits oversized orchestration/store modules by ownership without creating shadow workflows.
11. Updates every active architecture, provider, frontend/backend, and repository-structure document that describes the retired workflow.
12. Adds architectural absence tests and persisted multi-turn Classic-to-Flow-to-Classic verification against isolated test state.

Absence gates must fail if production reintroduces a post-turn Memory Router, mutable main-agent goal ledger, pending completion fallback, optional normal finalization, view-specific main tools, Flow retrieval mode downgrades, normal model-facing opaque work ids, unbounded goal/task injection, duplicate provider runners, copied cross-view Q&A authority, or non-atomic answer/goal persistence.

## Documentation Authority And Change Discipline

Use this authority order:

1. `REPO_RULES.md` for non-negotiable repository invariants.
2. `FLOW_NORTH_STAR.md` for user/product behavior.
3. `UNIFIED_SOCRATES_LIFECYCLE.md` for the detailed target lifecycle and cleanup boundary.
4. `V2_FLOW_ARCHITECTURE.md` and active contracts for honest current implementation/migration mechanics.
5. `FLOW_CONVERGENCE_PHASE_*.md` for historical phase evidence only.

Do not copy the complete lifecycle into new planning files, skills, or memory. Link to this document and record only the specific delta under discussion. Any implementation that changes this contract must update this file, the North Star, repo rules when an invariant changes, tests, and the current-implementation docs in the same change.
