# Socrates Repository Agent Instructions

This file is the mandatory entrypoint for every coding agent working anywhere in this repository. More specific nested `AGENTS.md` files may add local rules but never override these architecture authorities.

## Mandatory Orientation

Before planning, reviewing, or changing agent architecture, tools, capabilities, prompts, routing, retrieval, embeddings, chunking, vector search, context management, providers, worker agents, tool documentation, Classic/Flow execution, or goal/task lifecycle behavior, read these files completely in this order:

1. `MEMORY.md`
2. `context-files/REPO_RULES.md`
3. `context-files/GLOBAL_SOCRATES_NORTH_STAR.md`
4. `context-files/UNIFIED_SOCRATES_LIFECYCLE.md`
5. `context-files/AGENT_REFACTOR_MANIFESTO.md`
6. `context-files/AGENT_CAPABILITY_WORKFLOW.md`

Do not treat historical phase reports, generated build output, ignored runtime copies, or old implementations as current authority.

## Non-Negotiable Architecture

- One provider-neutral agent runtime implementation serves every model-driven role.
- Agent roles are declarative instances of that runtime, never private runners.
- One capability catalog owns every model tool, dynamic tool, automatic retrieval path, structured worker, deterministic authority, and typed lifecycle command.
- One canonical tool contract drives provider projection, runtime validation, execution, policy, telemetry, tests, and generated tool documentation.
- A structured semantic phase may use one flat provider-facing wire schema only when it is declared in shared contracts and immediately normalized into its strict domain result. It must not create a second semantic authority or a provider-specific shadow schema.
- One shared retrieval foundation owns parsing, Markdown-aware chunking, embeddings, vector storage, lexical/semantic/combined ranking, parent grouping, exact inspection, diagnostics, and index lifecycle.
- One global seamless Socrates uses the same main-agent definition and capability manifest for every foreground task. Released Classic, project, conversation, and Flow data are preserved only in a verified whole-state archive; the fresh target runtime imports no old work and has no Flow, project, or conversation prerequisite.
- The global product entry is `/welcome` with one **Open Socrates** action to `/chat`. `/chat` is one goal-centric viewport shell: fixed `Paths | Access | Settings`, a fixed composer, a middle-only scroll region, exactly one displayed exchange, and a two-stage collapsible sidebar. The sidebar opens to a flat goal list; selecting a goal replaces that page with its flat exact-exchange list and a back control. It never nests exchanges under goal rows and has no project or conversation level. Historical selection is passive; sending always returns to the canonical live tail before the same-Socrates goal decision.
- The central orb is persistent presentation state, not another runtime. During work it owns one replace-in-place human activity sentence plus one collapsed detailed work disclosure; after the validated atomic final commit it recedes behind the exact answer. The movable `Live Work` and backend-authoritative `Live Goal` notes are presentation projections only and never own task, goal, evidence, or memory state.
- One durable global Socrates state owns the single `foregroundGoalId`, active root task, revision, and recovery sequence. Goals and capsule versions are globally owned; every user request creates one root task whose exact messages, tools, Terminal continuations, interactions, usage, and evidence remain task-owned. Immutable access snapshots own authorization only; explicit goal/task resource bindings own resource provenance. No active runtime, API, transport, retrieval, or UI path may read the released archive. Do not create a hidden compatibility Flow, replacement transcript, second pointer/store, or permanent legacy adapter.
- Filesystem autonomy comes only from the immutable per-task snapshot of durable global `Read only`/`Selected`/`Full` state. Structured read/search is global in every mode. Read only approval-gates all mutations and Terminal launches; Selected makes structured writes inside selected roots automatic and approval-gates other writes and every Terminal launch; Full makes ordinary actions automatic. Frontier always requires approval. Catastrophic operations are hard denied, and a native platform adapter contains Terminal children; preflight is defense in depth only and Full Terminal fails closed without containment.
- Every turn persists the exact user message, retrieves goal, memory, and capability candidates in parallel, performs one same-Socrates goal decision (`current`, one of at most three retrieved older goals, `new`, or `clarify`), then deterministically selects exact memory. The first memory query includes the current capsule when available; after binding, the same retrieval service may run one targeted query only for a changed goal or an empty eligible first pass. The shared Socrates loop then runs, commits answer/task/goal/capsule state atomically, and enriches memory asynchronously.
- After goal binding, Socrates performs the work, normal tool continuations, useful central `memory_note` updates, reconciliation, and the final structured answer inside one foreground loop. A separate draft, title, reconciliation, or final-formatting call is forbidden.
- Runtime mechanics must not inject shadow steering, synthetic user turns, per-tool-batch action ledgers, or hidden progress/final checkpoints. Enduring behavior belongs in the stable cached prompt; declared current context and tool results carry changing facts. Any new model-visible injected-content category requires explicit user approval and an authority/CI allowlist update.
- The current goal capsule and latest exact exchange are always supplied independently of retrieval score. Every user message creates a task; only a genuinely independent outcome creates a goal.
- Do not create or retain a separate Goal Router agent, goal-search tool loop, or model-driven Memory Router in the critical path.
- The canonical goal ledger is backend authority, not a mutable main-agent tool or `.socrates` file.
- Exact user messages, visible assistant answers, explicit constraints, and canonical tool evidence remain immutable and exactly retrievable. Goal scoping and pagination operate on whole source items. At the fixed 170k trigger, the shared runtime may replace the oldest completed-turn head and, when one active turn is itself oversized, only that turn's oldest completed tool-exchange prefix with one provenance-linked compaction. It always keeps the active turn's original user request, pending operations, and newest tool-exchange suffix raw; preserves approximately 70k of newest safe raw context when possible; uses stable canonical turn/task ordinals mapped internally to exact source ids; and never overwrites canonical sources.
- Never use the phrase `bounded context` by itself in architecture, product copy, logs, or handoffs. State the exact mechanism instead: `exact scoped selection`, `exact pagination`, `lossless derived index`, `turn-local released tool-result projection`, or `automatic provenance-linked model-context compaction`.
- `~/.Socrates/work/<task-id>` is temporary task working space. Durable identity/profile/global rules and resource memory/rules/repository facts are typed versioned SQLite knowledge. Existing repo-local `.socrates` directories are left untouched and ignored. `memory_note` proposes evidence-backed curation or skill leads to the Global Memory Agent.
- Main Socrates reads central knowledge, generated tool guidance, eligible global/resource skills and MCPs, and bound resource files through the shared `read`/`search` protocol. Central knowledge remains generic-edit denied and changes only through Memory Agent or direct-user typed version APIs. Memory Agent has no MCP or skill execution; Skill Writer has no MCP or installed-skill execution. Skill files are never written through generic `edit`; `capability_manager` owns the typed lifecycle. Installed tool guidance must exactly mirror the catalog-generated bundle by content and inventory, with non-catalog Markdown pruned.
- No shadow schema, runner, registry, utility, retrieval pipeline, provider call, runtime copy, or compatibility workflow may survive the refactor cutover.

"One shared instance" means one canonical implementation and injected service boundary. It does not mean unsafe global mutable turn state. Each concurrent run must have isolated request state.

## Required Change Procedure

Follow `context-files/AGENT_CAPABILITY_WORKFLOW.md` for every affected change. Search for the existing owner before creating anything. Update the canonical definition first, then every generated projection and required test through the documented workflow. Never patch a generated artifact or provider-specific representation as the source of truth.

Use isolated `SOCRATES_HOME`, database, workspace, port, credential, and Terminal state for every mutating test. Never use or reset the user's normal Socrates state.

If the requested change cannot fit the shared architecture, stop and update the authority documents with the user before implementing an exception.
