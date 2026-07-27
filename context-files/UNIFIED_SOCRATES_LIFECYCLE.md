# Unified Socrates Lifecycle

Status: detailed technical target for the global goal-centric Socrates lifecycle.

FLOW_NORTH_STAR.md defines the product experience. AGENT_REFACTOR_MANIFESTO.md defines the replacement agent architecture. AGENT_CAPABILITY_WORKFLOW.md defines the mandatory change procedure. Current Classic, project, V2, router, and compaction implementations are migration evidence when they conflict with this target.

Implementation checkpoint (2026-07-27): Phase 3 converges the released Classic and Flow pre-turn path through concurrent typed goal/memory retrieval, same-main-Socrates no-tool four-way resolution, deterministic exact-memory selection, and one view-neutral exact prepared context. The former Goal Router, Memory Router, their model tools/settings/prompts, sliced goal-history helper, and view-specific context policy are deleted. The global no-project UI and the consent-gated replacement for released automatic lossy compaction remain later migration work.

## One Product Model

The target product has one global Socrates, one canonical goal/task history, one shared agent runtime, and one finalization path.

    one global Socrates
      -> one current-goal pointer
      -> many durable goals
      -> many tasks inside each goal
      -> exact exchanges and evidence linked to those tasks

A released project or conversation id may remain as a migration, access, audit, or presentation coordinate. It is not a separate Socrates mind, memory universe, or required user-facing entry boundary.

## Exact Content And Consent

Exact user messages, visible assistant answers, explicit constraints, approvals, blockers, attachments, and selected relevant history are immutable canonical sources. The runtime must never clip, token-slice, rewrite, summarize, compact, or silently omit selected relevant text.

Use precise language:

- exact scoped selection means complete canonical items selected for one goal or task;
- exact pagination means complete recoverable pages with continuation metadata;
- lossless derived index means chunks, embeddings, lexical indexes, entities, or metadata pointing back to exact sources;
- lossy user-approved compaction means one specifically described transformation approved before provider dispatch.

The phrase bounded context is forbidden as a standalone description because it hides whether information was lost.

If the relevant exact working set cannot fit a provider request, the runtime pauses before dispatch. It identifies the affected content, provider limit, and proposed lossy operation, then asks for explicit permission for that exact scope. Refusal prevents the lossy request. Any approved derivative retains provenance and never overwrites canonical content.

A goal capsule is not automatic conversation compaction. It is structured live state derived from validated goal outcomes and source anchors. It may guide selection but cannot replace relevant exact wording or evidence.

## Canonical Records

The target persistence model has one canonical identity for each user message, assistant answer, task, goal, capsule version, tool call/result, approval, credential request, Terminal, wait, artifact, attachment, usage event, error, and final result.

No view, sidebar, path, or compatibility adapter creates replacement copies to present the same semantic work.

## Global Turn Sequence

Every user-authored message follows this order:

    1. persist exact user message immediately
    2. retrieve goal candidates and memory candidates in parallel
    3. same-Socrates semantic goal resolution
    4. bind the canonical goal and create the task
    5. deterministically select exact memory for that goal
    6. run the shared Socrates agent loop
    7. perform required same-Socrates reconciliation
    8. produce and validate the structured final result
    9. atomically save answer, task outcome, goal capsule, and current-goal state
    10. publish the answer
    11. run asynchronous memory enrichment

Immediate message persistence and later goal binding operate on the same canonical message row. The system may hold a typed pending-association state, but it must not create a routing copy and later mirror it.

## Parallel Candidate Retrieval

Before semantic resolution, the backend starts two mechanical retrievals concurrently.

### Goal candidates

The goal candidate path searches capsule/index metadata using the exact latest query plus lexical, semantic, entity, alias, recency, lifecycle, and prior-use signals. The current goal is included independently of its retrieval score. Older results are deduplicated and returned as a small numbered list of human-readable capsules.

### Memory candidates

The memory candidate path searches authorized exact sources and lossless derived indexes across goal history, global user memory, identity, workspace doctrine, paths, connected resources, and canonical trace evidence. Each candidate carries scope, provenance, and an exact retrieval handle.

Retrieval ranks possibilities. It does not choose a goal, create a goal, interpret user intent, rewrite memory, or decide that a low score means new work.

Memory candidates may be gathered broadly while the goal decision is pending. After binding, deterministic policy filters and reranks them using the resolved goal, active resource scope, source permissions, current task, and duplication rules.

## Same-Socrates Goal Resolution

Goal resolution is one minimal semantic setup step executed through the same provider-neutral runtime and Socrates prompt core as the main assistant. It is not a separate Goal Router agent, persona, provider loop, model setting, tool loop, or independent prompt harness.

The resolver receives only:

1. the exact latest user message;
2. the current goal capsule when one exists;
3. the latest exact exchange in the current goal;
4. a small numbered list of retrieved older goal capsules; and
5. any explicit user correction or selected-goal instruction.

The decision has only four semantic outcomes:

    current
    retrieved older goal N
    new
    clarify

There is no semantic resume-versus-continue distinction. When an older goal is selected, deterministic backend code changes the current pointer and records the lifecycle transition.

For new, Socrates supplies only the short human goal title required to create the goal. For clarify, Socrates supplies one natural user-facing question. The model selects numbered candidates and never authors opaque goal ids.

The resolver uses no tools. Candidate retrieval happens before the call. A malformed decision receives shared typed validation treatment; fallback code may preserve an explicitly selected current goal or ask for clarification, but may not use keywords, guessed ids, or retrieval score thresholds as semantic substitutes.

## Goal Continuity Rule

Every user message creates a task. Only a genuinely independent outcome creates a goal.

Continue using the current goal when the new task:

- directly follows the latest exchange;
- acts on something discovered during the current goal;
- implements, tests, verifies, sends, purchases, or otherwise follows through on the current outcome;
- changes the verb or named entity while remaining causally dependent on the same work; or
- completes another phase of the same deliverable.

Use a retrieved older goal when the request returns to that earlier outcome. Create a new goal only when neither the current outcome nor a retrieved earlier outcome coherently owns the work. Clarify only when choosing between plausible goals would materially change the result.

Example:

    User: Hey Soc, what is up? Check what is happening with my mail today.
      -> new goal: Handle today's email
      -> task 1: Review today's inbox

    User: Okay, let us reply to Gary then.
      -> current goal: Handle today's email
      -> task 2: Reply to Gary

The greeting prefix does not route concrete work to General Conversation. General Conversation is reserved for user messages with no concrete outcome.

## Goal Capsule Contract

Each goal has one latest capsule plus append-only historical capsule versions. The capsule is compact structured working state, not a transcript.

It contains:

    human goal title
    goal objective
    verified progress
    current task and latest validated outcome
    important decisions and constraints
    active blockers and open items
    next useful state when known
    exact source anchors

Capsules update only from authoritative lifecycle facts and validated results. They never claim unverified work, contain raw evidence dumps, or erase the exact history they reference.

The current capsule and latest exact exchange are always supplied to goal resolution and normal context preparation. This guarantee does not depend on semantic retrieval ranking.

## Goal Ledger Contract

The goal ledger is a backend deterministic authority containing goal identity, title, lifecycle state, latest capsule reference, current-goal pointer, and task counts/timestamps needed for navigation.

It does not contain transcripts, tool output, files, patches, Terminal streams, or evidence bodies. Those remain in canonical message and trace storage.

The main model does not receive or mutate the ledger. User lifecycle actions such as select, rename, archive, restore, split, or move an exchange use typed backend commands. Model-facing goal selection uses numbered current/retrieved capsules and backend id resolution.

When focus changes:

    save current capsule version
      -> move current-goal pointer
      -> load selected capsule
      -> attach selected goal's latest exact exchange
      -> select exact relevant memory/evidence

## Deterministic Memory Selection

There is no model-driven Memory Router in the critical path.

After goal binding, deterministic memory selection applies one shared policy over the already retrieved candidates:

- authorization and path/account scope;
- current goal and task ownership;
- exact current/latest exchange anchors;
- lexical, semantic, entity, recency, and source-diversity signals;
- always-apply user rules and identity sections;
- duplication and provenance checks; and
- exact-page availability.

The main Socrates receives selected exact sources and human-readable provenance. It may use the shared retrieval capability to search or inspect deeper exact history while working. It never sees vectors, embedding ids, raw similarity scores, database ids, or a whole goal ledger.

## Prepared Main Context

Normal main-agent preparation includes:

    stable Socrates identity and operating rules
    authorized capability and resource-scope facts
    exact latest user message
    resolved current goal capsule
    latest exact exchange in that goal
    selected exact memory and evidence
    active Terminal, approval, wait, and continuation state

Older exact goal exchanges are attached when selected as relevant or inspected through shared retrieval. Page sizes limit one response, not the canonical source. No message selected for context may be character- or token-sliced.

The model receives no view-specific persona, project-first prompt, mutable focus-ledger tool, Memory Router output grammar, or duplicate Classic/Flow history policy.

## Main Socrates Loop

One AgentDefinition, one AgentRuntime, one capability manifest, and one provider/tool lifecycle execute every foreground task. Paths, connections, current access mode, and the bound goal are typed runtime inputs rather than different agents.

The same loop owns investigation, planning, tool calls, recovery, approvals, credentials, Terminal/wait continuation, long-task progress reconciliation, mandatory pre-final reconciliation when applicable, and the substantive final answer.

The goal resolver cannot perform task tools. The main loop cannot rebind the task to another goal after work begins.

## Finalization And Atomic Commit

The normal final call returns one strict result containing the visible answer plus the already-bound task/goal outcome required by the backend. It does not choose a goal again.

One transaction:

1. saves the validated assistant answer;
2. completes or records the task outcome;
3. applies verified goal progress/state;
4. writes the next capsule version;
5. moves or retains the current-goal pointer as already resolved; and
6. writes usage, errors, evidence links, and retrieval receipts required for audit.

Only after commit does the UI publish the completed answer. No valid persisted answer means no task completion or goal/capsule mutation.

Task completion does not imply goal fragmentation. The next causally dependent user request becomes another task in the same goal.

## Asynchronous Memory Enrichment

After publication, asynchronous enrichment may:

- update lossless lexical, semantic, entity, alias, and goal indexes;
- create retrieval links between exact sources;
- queue durable user-profile or identity curation;
- refresh derived goal navigation metadata from the validated result; and
- propose learned skills through the existing approval workflow.

Enrichment uses the same shared utilities, capability catalog, provider abstraction, and agent runtime when model judgment is genuinely required. It is not on the foreground latency path and cannot alter the already published answer or become a second finalization authority.

Explicit user memory opt-outs apply before indexing or enrichment. Deletion removes or tombstones canonical data and reconciles its derivatives through one owned lifecycle.

## Global Access And Resource Scope

The target UI begins in the seamless goal view. Paths, access mode, and Settings control resource availability globally.

- Selected-path mode limits filesystem tools and indexes to explicitly added roots.
- Full-access mode expands filesystem scope only after explicit user choice and remains visibly active and revocable.
- Full access does not waive approval or external-side-effect policy.
- Connected mail, calendar, browser, cloud, or communication accounts remain separately permissioned resources.
- A turn receives an immutable authorization snapshot; changing access during a running task affects the next safe operation or next turn according to policy and never rewrites evidence.

Released projects may map to resource scopes during migration, but new agent logic must not require a user-visible project before conversation begins.

## Shared Trace And Exact Inspection

One retrieval foundation serves goal candidates, memory candidates, main-agent recall, global memory curation, and exact audit inspection. Typed corpus adapters preserve source ownership and permission filters without creating separate retrieval engines.

Search results are numbered human evidence cards. Exact inspection resolves result numbers or human filters through the backend. Opaque message, turn, goal, project, chunk, or vector ids are not normal model inputs.

## Shared Runtime And Code Shape

The target public boundary is one provider-neutral AgentRuntime. Agent roles are thin declarative definitions. Deterministic services do not become fake agents merely to satisfy a uniform class hierarchy.

The same runtime may execute foreground Socrates and genuinely model-driven asynchronous curators, skill writers, or user-approved compactors. The goal-resolution phase is configuration of the same Socrates definition and prompt core, not an independently configurable agent role.

The capability catalog includes model tools, dynamic tools, automatic retrieval, deterministic goal/memory selection, typed user commands, finalization, and background enrichment. One canonical schema drives provider projection, validation, execution, telemetry, tests, and generated documentation.

## Required Cleanup Before Merge

The replacement is incomplete while any production path still depends on:

- a separately configurable Goal Router agent or its tool loop;
- a model-driven pre-turn or post-turn Memory Router;
- separate Classic and Flow main-agent prompts, registries, provider loops, or context policies;
- required project or conversation creation before entering Socrates;
- Projects to Goals to Queries as the target sidebar authority;
- automatic lossy conversation compaction without specific prior consent;
- character/token slicing of selected user or assistant messages;
- a mutable model-facing focus ledger;
- duplicate semantic Q&A mirrors or hidden conversation shims;
- a second goal/title/finalization authority; or
- uncatalogued retrieval, provider, or lifecycle entrypoints.

Historical files may describe those systems but must remain visibly historical and unreachable from production authority.

## Verification Gates

Tests use isolated SOCRATES_HOME, databases, workspaces, paths, credentials, ports, Terminal state, mail/calendar fixtures, and browser state. They never mutate normal user state.

Required scenarios include:

1. A first concrete request after a greeting creates a work goal rather than General Conversation.
2. Email review followed by replying to a discovered sender stays one goal with two tasks.
3. Inspect, implement, and test phases stay one coherent engineering goal.
4. A genuinely unrelated request creates a new goal.
5. A return to older work selects the retrieved older capsule.
6. Genuine ambiguity asks one clarification question.
7. The current capsule and latest exact exchange are present regardless of retrieval score.
8. Goal and memory candidate retrieval run concurrently and the critical path contains no Memory Router model call.
9. Selected messages remain byte-exact; refusal at the consent gate prevents lossy dispatch.
10. Capsule updates never overwrite exact history and exact source inspection succeeds.
11. Answer, task outcome, capsule, and current-goal state commit atomically before publication.
12. The global UI opens without project selection and path/full-access enforcement is real.
13. The goal sidebar shows exact Q&A grouped by goal with no required project hierarchy.
14. Capability-manifest and absence tests prove old routers and shadow paths are unreachable.

## Documentation Authority And Change Discipline

Any material change to goal resolution, capsule shape, ledger ownership, candidate retrieval, exact-history policy, memory selection, access scope, main-agent context, finalization, or global UI navigation must update this file, FLOW_NORTH_STAR.md, AGENT_REFACTOR_MANIFESTO.md, AGENT_CAPABILITY_WORKFLOW.md, REPO_RULES.md, root AGENTS.md, root MEMORY.md, contracts, inventories, and tests together.

Do not recreate this lifecycle in a skill, generated summary, historical phase report, or second architecture document. Durable memory points future agents to these authorities; it does not duplicate them.
