# Unified Socrates Lifecycle

Status: detailed technical target for the global goal-centric Socrates lifecycle.

GLOBAL_SOCRATES_NORTH_STAR.md defines the product experience. AGENT_REFACTOR_MANIFESTO.md defines the replacement agent architecture. AGENT_CAPABILITY_WORKFLOW.md defines the mandatory change procedure. Current Classic, project, V2, router, and compaction implementations are migration evidence when they conflict with this target.

Implementation checkpoint (2026-07-30): the canonical global foreground path uses concurrent typed goal/memory/capability retrieval, current-capsule-aware exact memory selection, same-main-Socrates no-tool four-way resolution, one view-neutral prepared context, and one foreground working loop whose last continuation returns the validated answer plus goal state/note. Reconciliation is conditional work inside that loop; there is no detached draft, reconciliation, title, or final-formatting call and no per-batch model-visible action/memory steering. Qualifying large results carry result-local `R<n>` notices; automatic 170k oldest-head compaction preserves an approximately 70k exact whole-turn suffix; and Frontier receives exact current context only after approval. The production cutover archives the released installation intact and initializes a fresh compact database; old work is not imported into the new goal ledger.

## One Product Model

The target product has one global Socrates, one canonical goal/task history, one shared agent runtime, and one finalization path.

    one global Socrates
      -> one current-goal pointer
      -> many durable goals
      -> many tasks inside each goal
      -> exact exchanges and evidence linked to those tasks

A released project or conversation id may remain as a migration, access, audit, or presentation coordinate. It is not a separate Socrates mind, memory universe, or required user-facing entry boundary.

## Global Bootstrap And Fresh-State Cutover

`/chat` loads without asking the user to create or select a project, Flow, or conversation. The backend restores one durable global Socrates state through a typed contract. That state owns only the canonical foreground goal, active root task, revision, and recovery/event sequence; it is not a transcript or resource scope.

On upgrade, one cutover service acquires a maintenance lock, refuses to proceed while a foreground task or Terminal is active, checkpoints SQLite WAL, verifies database integrity, and copies the complete released state into a timestamped permission-restricted archive with a checksum manifest. It then creates and validates a fresh compact database at a temporary path, imports only global identity, profile, accepted global rules, cross-project memory, provider/worker settings, access roots/mode, and global skills/MCP configuration, regenerates catalog-owned tool guidance, and atomically swaps databases. Old goals, messages, tools, traces, approvals, usage, Terminal history, project memory, and project-scoped capabilities remain only in the archive. Failure before the swap leaves the old installation active; failure during the swap restores it from the verified archive. Repeating cutover is idempotent.

New work never requires or creates a Flow, project, conversation, or repo-local `.socrates` directory. The immutable per-task access snapshot owns authorization only. Confirmed resource bindings own task/goal resource provenance. Goals and capsules have no project/Flow owner. Root tasks own exact messages and all work/evidence continuations. WebSocket identifiers are transport and recovery facts only and own no semantic state. Active runtime paths never read the archive or released schema; there is no dual-write period, compatibility container, or second pointer/store.

## Exact Content And Efficient Model Context

Exact user messages, visible assistant answers, explicit constraints, approvals, blockers, attachments, and selected relevant history are immutable canonical sources. Canonical storage and exact retrieval never clip, token-slice, rewrite, summarize, compact, or silently omit those sources. Only the provider-facing projection may release qualifying current-turn tool copies or compact the oldest completed-turn head under the fixed policy below.

Use precise language:

- exact scoped selection means complete canonical items selected for one goal or task;
- exact pagination means complete recoverable pages with continuation metadata;
- lossless derived index means chunks, embeddings, lexical indexes, entities, or metadata pointing back to exact sources;
- turn-local released projection means an unneeded large tool-result copy removed only from the active model context while exact evidence remains available;
- automatic provenance-linked compaction means the oldest completed-turn head, or an oversized active turn's oldest completed tool-exchange prefix, is summarized for model context while canonical sources remain exact and recoverable.

The phrase bounded context is forbidden as a standalone description because it hides whether information was lost.

At 170k estimated model-visible input tokens, the runtime automatically compacts the oldest completed-turn head. If the active turn alone is oversized, the same stage may compact only its oldest completed tool-exchange prefix, where one batch is an assistant tool-call group plus all of its completed results. The original user request, all pending operations including approval/Terminal/wait/incomplete work, and the newest tool-exchange suffix stay raw. It preserves approximately 70k of newest safe raw context when possible, targets a rebuilt request around 100k, accepts no result above 120k, and does not dispatch the main model above the trigger if safe compaction fails. One normal compactor request may contain both the completed historical head and active-turn prefix; it must not split them into detached model calls. The derivative uses stable canonical turn/task ordinals plus exact internal source references and never overwrites canonical content.

Each successful individual tool result above 3,000 estimated tokens receives the next turn-local `R<n>` handle and one compact reminder appended to that existing tool result. It is not a separate hidden message. Socrates may release unneeded handles alongside its next normal tool call. There is no keep, distill, or unresolved state; omission never blocks normal tools; no separate model inference is added; and exact results remain retrievable.

Every tool result also passes through one final shared model-projection guard. Existing narrower read/search/trace limits remain unchanged. A dynamic MCP result is persisted exactly first, then projected at approximately 4,000 estimated tokens by default and never above 6,000; truncation returns an `R<n>` reference plus exact continuation metadata usable through existing read/trace capabilities. Binary/base64 bodies are stored as evidence or artifacts rather than dumped into model context.

A goal capsule is not automatic conversation compaction. It is structured live state derived from validated goal outcomes and source anchors. It may guide selection but cannot replace relevant exact wording or evidence.

## Canonical Records

The target persistence model has one canonical identity for each user message, assistant answer, task, goal, capsule version, tool call/result, approval, credential request, Terminal, wait, artifact, attachment, usage event, error, and final result.

No view, sidebar, path, or compatibility adapter creates replacement copies to present the same semantic work.

## Global Turn Sequence

Every user-authored message follows this order:

    1. persist exact user message immediately
    2. retrieve goal, memory, and capability candidates in parallel
    3. same-Socrates semantic goal resolution
    4. bind the canonical goal and create the task
    5. deterministically select exact memory for that goal
    6. run one shared Socrates working loop
    7. inside that loop, use normal tools and reconcile important working/durable state when needed
    8. return and validate answer + goal state + goal note in the loop's last continuation
    9. atomically save answer, task outcome, goal capsule, and current-goal state
    10. publish the answer
    11. run asynchronous memory enrichment

Immediate message persistence and later goal binding operate on the same canonical message row. The system may hold a typed pending-association state, but it must not create a routing copy and later mirror it.

## Parallel Candidate Retrieval

Before semantic resolution, the backend starts three mechanical retrievals concurrently.

### Goal candidates

The goal candidate path searches capsule/index metadata using the exact latest query plus lexical, semantic, entity, alias, recency, lifecycle, and prior-use signals. The current goal is included independently of its retrieval score. Older results are deduplicated and limited to the top three numbered human-readable capsules.

### Memory candidates

The memory candidate path searches authorized exact sources and lossless derived indexes across goal history, global user memory, identity, workspace doctrine, paths, connected resources, and canonical trace evidence. Each candidate carries scope, provenance, and an exact retrieval handle.

Retrieval ranks possibilities. It does not choose a goal, create a goal, interpret user intent, rewrite memory, or decide that a low score means new work.

Memory candidates are gathered broadly while the goal decision is pending, using a disposable search projection derived from the canonical task plus the current capsule when available. Canonical source text remains unchanged and independently attached where required. After binding, a changed goal or an empty eligible first pass permits one targeted query through the same retrieval service. Deterministic policy then merges, filters, and reranks exact candidates using the resolved goal, active resource scope, source permissions, current task, and duplication rules. This is not a model call, retry loop, or second retrieval authority.

### Capability candidates

The capability path uses the same parsing, embeddings, lexical/vector indexes, hybrid ranking, and typed corpus-adapter pattern to retrieve a compact set of relevant installed skills and MCP tools. It does not grep the user prompt, decide intent, mutate capability state, or inject the full registry. Exact explicit capability ids/names may resolve deterministically. When retrieval misses, Socrates uses `read` or `search` over `socrates://capabilities`; it must perform that fallback before claiming no suitable installed capability exists.

`capability_manager` remains visible on every normal Socrates tool-capable turn. It is the one approval-gated model mutation surface for both skills and MCPs. Skill creation/update/import/removal delegates to the Skill Writer or the verified package-import path as applicable; MCP configuration/removal delegates to the shared MCP lifecycle. Capability discovery never depends on manager visibility.

## Same-Socrates Goal Resolution

Goal resolution is one minimal semantic setup step executed through the same provider-neutral runtime and Socrates prompt core as the main assistant. It is not a separate Goal Router agent, persona, provider loop, model setting, tool loop, or independent prompt harness.

The resolver receives only:

1. the exact latest user message;
2. the current goal capsule when one exists;
3. the latest exact exchange in the current goal;
4. at most three numbered retrieved older goal capsules; and
5. any explicit user correction or selected-goal instruction.

The decision has only four semantic outcomes:

    current
    retrieved older goal N
    new
    clarify

The provider-facing structured form is one flat object with the decision and nullable candidate/title/question detail fields. Backend validation normalizes that form into the strict four-way union above. Do not project the union as provider `anyOf` branches: models may bias toward the first branch instead of making the semantic choice.

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

After goal binding and any single permitted bound-goal refinement, deterministic memory selection applies one shared policy over the retrieved candidates:

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
    compact matched skill and MCP capability candidates
    active Terminal, approval, wait, and continuation state

Older exact goal exchanges are attached when selected as relevant or inspected through shared retrieval. Page sizes limit one response, not the canonical source. No message selected for context may be character- or token-sliced.

The model receives no view-specific persona, project-first prompt, mutable focus-ledger tool, Memory Router output grammar, or duplicate Classic/Flow history policy.

Main Socrates reads central identity, profile, global/resource knowledge, generated tool guidance, installed skills, and bound resource files through the shared `read`/`search` resource protocol. Identity/profile/knowledge writes use typed, versioned Memory Agent or direct-user APIs; generic `edit` never mutates them or skill files. Task scratch files live under Socrates home `work/<task-id>` rather than inside user repositories. Skill mutations use `capability_manager` and the Skill Writer. Installed tool guidance exactly mirrors the catalog-generated bundle, including removal of stale non-catalog guides.

The working-space meanings are fixed:

- `~/.Socrates/work/<task-id>` is temporary task working space and never a durable memory authority.
- Central versioned knowledge stores global identity/profile/rules and resource memory/rules/repository facts.
- `memory_note` sends one or more typed curation leads to the asynchronous Global Memory Agent.
- Existing repository-local `.socrates` directories are ignored and left untouched.

Socrates uses these naturally while working. It does not open or update them ceremonially or require fixed plan/task filenames.

## Global Presentation And Exact Exchange History

The global shell renders one normalized read model derived from canonical snapshots, exact goal-exchange pages, and live typed events. The frontend must not maintain a second goal/task state machine or decide which unfinished turn is authoritative from message order alone. The backend snapshot identifies the active task and latest task; durable continuation lineage groups a root user turn and its Terminal/wait continuation turns into one logical exchange without copying their messages or tools.

Goal history is retrieved as exact whole exchanges grouped by canonical root task and ordered by stable task/turn ordinal. A page contains the exact user message, saved visible assistant answer when present, immutable goal binding, legacy source provenance when applicable, root/current turn lineage, status, timestamps, and canonical tool references needed for the collapsed disclosure. Pagination selects whole exchanges and exposes an exact earlier-page cursor; it never token-slices a selected message, creates a second transcript, or substitutes a capsule for visible history.

The presentation state has these exclusive modes:

- `idle`: no current exchange exists;
- `live`: the authoritative active task/turn is routing, working, waiting, or needs user action;
- `final`: the latest exact current exchange has a durably saved answer;
- `history`: one explicitly selected older exact exchange is being inspected passively;
- `recovery`: canonical unfinished state exists but the runtime must reconnect or resume it; and
- `error`: authoritative evidence proves an unrecoverable load/runtime failure.

Historical inspection changes only client presentation state. It never mutates the goal ledger, starts a provider call, replays live activity, reopens a goal, or becomes the parent of a new task. A send while history is displayed first returns the client to `live`, persists a new canonical user message at the live tail, and then follows the ordinary same-Socrates goal decision. The historical goal may still be one retrieved candidate, but the UI cannot bind it by pretending that the old exchange is current.

`/chat` is one fixed viewport shell. The minimal header (`Paths | Access | Settings`) and composer remain outside the only middle scroll region. The center shows exactly one exchange. Long user text may be presentation-collapsed behind **Show more**, but canonical text remains byte-exact. The collapsible sidebar is a two-stage navigator: it opens on a flat goals page, selecting a goal replaces that page with the goal's flat exact-exchange list, and a fixed back control returns to goals. Exchanges never nest under goal rows, and there is no project or conversation navigation level.

One persistent orb projects typed execution state. During `live`, one fixed-height safe activity sentence is replaced in place and one detailed work/tool disclosure may expand; activity labels never accumulate and never expose unrestricted hidden reasoning. Approvals, credentials, clarification, Terminal input, and other user actions remain full typed controls. Only the validated atomic final commit moves the read model to `final`; the answer then becomes foreground content, the orb recedes, and the live sentence clears. Completed/history hydration shows the saved answer and collapsed trace only.

`Live Work` and `Live Goal` are movable presentation notes. `Live Work` summarizes safe typed activity without raw secrets or unbounded output. `Live Goal` always projects the canonical foreground goal/task even while history is inspected. Drag coordinates, z-order, fold/open state, and reset behavior use one global client presentation key, remain keyboard accessible and viewport-clamped, and never persist into goal/task/evidence records. Narrow layouts fold the notes into accessible tabs or panels.

## Main Socrates Loop

One AgentDefinition, one AgentRuntime, one capability manifest, and one provider/tool lifecycle execute every foreground task. Paths, connections, current access mode, and the bound goal are typed runtime inputs rather than different agents.

The same loop owns investigation, planning, tool calls, recovery, approvals, credentials, Terminal/wait continuation, reconciliation when important state changed, and the substantive structured final answer. Reconciliation is Socrates' judgment inside this loop, not another agent, model phase, provider call, or hidden checkpoint. The process is plan, track, reconcile at meaningful moments, and verify—not document reads before and after every operation.

The runtime may not inject an action ledger after tool batches or add synthetic user/developer messages for repeated calls, tool counts, context growth, memory-note bookkeeping, Terminal capabilities, progress reconciliation, or final reconciliation. Backend counters and guards remain mechanical and silent. Real failures stay inside their matching tool result. The stable prompt owns enduring behavior, and a small approved notice may appear only as metadata attached to an existing tool result. Any new model-visible injected-content category requires explicit user approval and an authority/CI allowlist update.

The goal resolver cannot perform task tools. The main loop cannot rebind the task to another goal after work begins.

## Finalization And Atomic Commit

The last continuation of the normal working loop returns one strict result containing the visible answer plus the already-bound goal state and goal note required by the backend. It does not choose a goal again. The same streamed provider request carries the native terminal schema, including when tools are available; the schema is counted as model input and is not enforced through a repair call. There is no earlier draft answer, detached reconciliation call, or separate final-formatting call. A no-tool foreground request therefore has one goal-decision call and one main final call; tool-using requests add only continuations required to consume real tool results.

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

- Structured read/search is automatic globally in every mode; selected/recent roots are discovery priority, not a read boundary.
- Read only approval-gates every structured mutation and Terminal `run/start`.
- Selected makes structured writes within selected roots automatic and approval-gates writes elsewhere plus every Terminal `run/start`.
- Full makes ordinary structured mutations, Terminal launches, capabilities, and external side effects automatic and remains visibly active and revocable.
- Terminal `inspect/list/stop` is automatic in every mode. Frontier always requires approval; rejection removes it for the current task.
- Catastrophic operations are hard denied in every mode. A native platform adapter contains Terminal children; command preflight is defense in depth only. If enforceable containment is unavailable, automatic Full Terminal fails closed.
- Connected mail, calendar, browser, cloud, or communication accounts remain separately permissioned resources.
- A turn receives an immutable authorization snapshot; changing access during a running task affects the next safe operation or next turn according to policy and never rewrites evidence.

Selected roots never imply user intent or create resource scope. Exact existing paths supplied by the user may bind immediately; discovered path candidates require confirmation. Goal bindings carry active resource identities and task bindings retain the exact location used.

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
- any hidden or visible Flow required to bootstrap `/chat`, scope new work, own the current pointer, sequence runtime events, or subscribe a client;
- Projects to Goals to Queries, or a nested Goals tree, as the target sidebar authority;
- history selection that moves the canonical current-goal pointer, parents a new task to an old exchange, or replays live activity;
- stacked activity labels, frontend-inferred agent meaning, or movable notes that own semantic goal/task state;
- a compactor that overwrites canonical sources, slices selected messages, uses a view-specific threshold, retains less than the protected newest whole-turn suffix without necessity, or dispatches the main model above the 170k trigger after failed safe compaction;
- a context-disposition classifier, distiller, unresolved queue, mandatory release gate, or extra release-only model round trip;
- character/token slicing of selected user or assistant messages;
- a mutable model-facing focus ledger;
- duplicate semantic Q&A mirrors or hidden conversation shims;
- a per-tool-batch action ledger, synthetic user warning, or uncatalogued model-visible steering message;
- a detached draft, reconciliation, or final-formatting provider call after the main work loop;
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
9. Canonical selected messages remain byte-exact; automatic compaction preserves an approximately 70k newest whole-turn suffix, provenance, exact recovery, and no dispatch above 170k after safe-compaction failure.
10. Capsule updates never overwrite exact history and exact source inspection succeeds.
11. Answer, task outcome, capsule, and current-goal state commit atomically before publication.
12. The global UI opens without project selection and path/full-access enforcement is real.
13. The goal sidebar opens on flat goals and replaces that view with one selected goal's flat exact-Q&A page plus a back control, with no nesting or project/conversation hierarchy.
14. `/welcome` has one **Open Socrates** action to `/chat`; reload restores the same global Socrates state without creating a project, Flow, conversation, duplicate goal/task/message, or second current pointer.
15. Upgrade fixtures containing multiple released projects/Flows migrate into one canonical goal ledger with byte-exact Q&A, capsules, tools, Terminal lineage, usage, evidence, and provenance; new work is task-owned and no active runtime read/write contains a Flow scope.
16. Selecting historical Q&A is passive, remains exact after paging/restart, and a subsequent send returns to the live tail before the same-Socrates decision.
17. The fixed header/composer and middle-only scroll hold at desktop and narrow widths; only one exchange is visible, long queries collapse without data loss, and note/sidebar overlays do not move the composer.
18. Live presentation uses one replace-in-place typed activity sentence; user-action controls remain interactive; the saved final appears only after commit; completed/history hydration does not replay activity.
19. `Live Work` and canonical `Live Goal` notes clamp, reset, persist under one global presentation key, support keyboard/reduced-motion/mobile behavior, and expose no secret or raw Terminal output.
20. Capability-manifest and absence tests prove old routers and shadow paths are unreachable.
21. Large qualifying tool outputs receive monotonic turn-local `R<n>` handles, release only piggybacks with normal work, omission never blocks functional calls, and the next user turn does not reload intermediate results.
22. Provider-input inspection proves every model-visible message category is allowlisted and no per-batch action ledger, synthetic user warning, detached reconciliation call, or detached final-formatting call exists.
23. A no-tool request uses exactly one same-Socrates goal-decision call plus one foreground structured-final call.

## Documentation Authority And Change Discipline

Any material change to goal resolution, capsule shape, ledger ownership, candidate retrieval, exact-history policy, memory selection, access scope, main-agent context, finalization, or global UI navigation must update this file, GLOBAL_SOCRATES_NORTH_STAR.md, AGENT_REFACTOR_MANIFESTO.md, AGENT_CAPABILITY_WORKFLOW.md, REPO_RULES.md, root AGENTS.md, root MEMORY.md, contracts, inventories, and tests together.

Do not recreate this lifecycle in a skill, generated summary, historical phase report, or second architecture document. Durable memory points future agents to these authorities; it does not duplicate them.
