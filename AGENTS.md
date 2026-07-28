# Socrates Repository Agent Instructions

This file is the mandatory entrypoint for every coding agent working anywhere in this repository. More specific nested `AGENTS.md` files may add local rules but never override these architecture authorities.

## Mandatory Orientation

Before planning, reviewing, or changing agent architecture, tools, capabilities, prompts, routing, retrieval, embeddings, chunking, vector search, context management, providers, worker agents, tool documentation, Classic/Flow execution, or goal/task lifecycle behavior, read these files completely in this order:

1. `MEMORY.md`
2. `context-files/REPO_RULES.md`
3. `context-files/FLOW_NORTH_STAR.md`
4. `context-files/UNIFIED_SOCRATES_LIFECYCLE.md`
5. `context-files/AGENT_REFACTOR_MANIFESTO.md`
6. `context-files/AGENT_CAPABILITY_WORKFLOW.md`

Do not treat historical phase reports, generated build output, ignored runtime copies, or old implementations as current authority.

## Non-Negotiable Architecture

- One provider-neutral agent runtime implementation serves every model-driven role.
- Agent roles are declarative instances of that runtime, never private runners.
- One capability catalog owns every model tool, dynamic tool, automatic retrieval path, structured worker, deterministic authority, and typed lifecycle command.
- One canonical tool contract drives provider projection, runtime validation, execution, policy, telemetry, tests, and generated tool documentation.
- One shared retrieval foundation owns parsing, Markdown-aware chunking, embeddings, vector storage, lexical/semantic/combined ranking, parent grouping, exact inspection, diagnostics, and index lifecycle.
- One global seamless Socrates uses the same main-agent definition and capability manifest for every foreground task; Classic, project, and Flow paths are migration adapters, not separate semantic authorities.
- Every turn persists the exact user message, retrieves goal and memory candidates in parallel, performs one same-Socrates goal decision (`current`, retrieved older goal, `new`, or `clarify`), then deterministically selects exact memory. The first memory query includes the current capsule when available; after binding, the same retrieval service may run one targeted query only for a changed goal or an empty eligible first pass. The shared Socrates loop then runs, commits answer/task/goal/capsule state atomically, and enriches memory asynchronously.
- The current goal capsule and latest exact exchange are always supplied independently of retrieval score. Every user message creates a task; only a genuinely independent outcome creates a goal.
- Do not create or retain a separate Goal Router agent, goal-search tool loop, or model-driven Memory Router in the critical path.
- The canonical goal ledger is backend authority, not a mutable main-agent tool or `.socrates` file.
- Exact user messages, visible assistant answers, explicit constraints, and canonical tool evidence remain immutable and exactly retrievable. Goal scoping and pagination operate on whole source items. The shared runtime may automatically replace only the oldest model-visible history with a provenance-linked compaction at the fixed 170k trigger; it preserves an approximately 70k newest suffix by complete turn boundary and never overwrites canonical sources.
- Never use the phrase `bounded context` by itself in architecture, product copy, logs, or handoffs. State the exact mechanism instead: `exact scoped selection`, `exact pagination`, `lossless derived index`, `turn-local released tool-result projection`, or `automatic provenance-linked model-context compaction`.
- `.socrates/` is a flexible working space for plans, task tracking, probes, scripts, and temporary artifacts. Require the planning, tracking, milestone reconciliation, and verification process when work needs it; never require fixed `PLAN.md` or `TASKS.md` filenames or a document read before and after every tool call.
- No shadow schema, runner, registry, utility, retrieval pipeline, provider call, runtime copy, or compatibility workflow may survive the refactor cutover.

"One shared instance" means one canonical implementation and injected service boundary. It does not mean unsafe global mutable turn state. Each concurrent run must have isolated request state.

## Required Change Procedure

Follow `context-files/AGENT_CAPABILITY_WORKFLOW.md` for every affected change. Search for the existing owner before creating anything. Update the canonical definition first, then every generated projection and required test through the documented workflow. Never patch a generated artifact or provider-specific representation as the source of truth.

Use isolated `SOCRATES_HOME`, database, workspace, port, credential, and Terminal state for every mutating test. Never use or reset the user's normal Socrates state.

If the requested change cannot fit the shared architecture, stop and update the authority documents with the user before implementing an exception.
