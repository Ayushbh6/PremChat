# Socrates Agent Refactor Manifesto

Status: normative architecture authority for the agent-core refactor.

Implementation checkpoint: the shared `AgentDefinition`/`AgentInstance`/`AgentRuntime`/`ContextPipeline` foundation, shared `CapabilityCatalog`, Classic/Flow goal-memory-capability lifecycle, governed model-facing resource surface, and single foreground working/final loop are implemented. The catalog remains the sole owner of static tools, role attachment, provider projections, runtime MCP child registration, declared retrieval/workers/context/authorities, typed commands, generated inventories/guides, and CI drift enforcement. Read/search/trace projections share explicit output caps and offsets; detached draft/reconciliation/final calls and shadow per-batch steering are deleted and guarded against return. The global seamless UI remains a later phase; catalogued migration entries are not permission to create parallel paths.

This manifesto governs every change to Socrates agent orchestration, model-facing capabilities, tools, routing, retrieval, context management, provider execution, and worker-agent construction. Read it and `AGENT_CAPABILITY_WORKFLOW.md` completely before planning, reviewing, or implementing work in those areas. The workflow is the mandatory operational checklist for this manifesto. If an implementation or historical document conflicts with either authority, stop and resolve the conflict in the authority documents before continuing.

## Why This Refactor Exists

Socrates accumulated overlapping registries, provider-specific schema projections, role-specific runners, automatic retrieval paths, dynamic MCP injection, legacy context machinery, and generated runtime copies. Fixing one path at a time has repeatedly allowed another path to remain active or drift.

The refactor therefore replaces the agent core as one controlled architecture change. It is not a sequence of isolated patches to whichever tool call failed most recently.

The rest of the product is not being discarded. Canonical project, goal, task, conversation, evidence, retrieval, provider, UI, and persistence behavior should be preserved unless an authority document explicitly changes it. The replacement boundary is the agent/runtime/capability layer and any obsolete authority paths attached to it.

## Non-Negotiable Outcome

There must be one understandable path from an agent definition to a provider request, capability execution, persisted evidence, and validated result.

At the completed cutover:

- Every model-driven role is an instance of the same agent architecture.
- Every callable or automatically invoked capability is declared in one capability catalog.
- Every model-facing tool has one canonical schema used for provider projection, validation, policy, execution, and tests.
- One global seamless Socrates invokes the same main agent definition and capability manifest for every foreground task; released Classic, project, and Flow surfaces are migration inputs rather than target semantic authorities.
- No previous runner, registry, schema projection, retrieval authority, context worker, generated runtime copy, or compatibility execution path can still handle production work.
- The old core is deleted before the refactor is merged. A permanent dual architecture is forbidden.

## Exact Content And Efficient Model Context

Socrates must never silently trade user meaning for context efficiency.

`Socrates remembers everything` is the product's primary differentiator. Everything the user chooses to entrust to Socrates remains exact, attributable, searchable, retrievable across time and authorized scopes, and deletable by the user. Recall may use lossless derived indexes, exact scoped selection, turn-local released projections, and automatic provenance-linked model-context compaction, but a provider projection is never canonical memory and a provider limit is never permission to delete evidence.

- Persist every user-authored message and visible assistant answer exactly as submitted or published.
- Never clip, shorten, rewrite, or partially include an individual selected message, answer, explicit constraint, approval, blocker, or instruction in canonical storage or exact retrieval.
- Preserve exact canonical source text even when parsing, chunking, embedding, indexing, ranking, or pagination creates derivative representations.
- Treat "bounded" as a finite, paginated, explicitly scoped projection. It never authorizes truncating the content of a selected item or deleting its source.
- Do not use `bounded context` as a standalone description. Every design, log, UI notice, and handoff must name the actual operation: exact scoped selection, exact pagination, lossless derived indexing, turn-local released tool-result projection, or automatic provenance-linked model-context compaction.
- Goal scoping may exclude clearly unrelated goals, but the runtime must not silently omit history that it believes may be relevant to the current request.
- When model-visible input reaches 170k estimated tokens, automatically compact the oldest completed-turn head. If one active turn is itself oversized, the same stage may also compact only its oldest completed tool-exchange prefix. A compactable batch is one assistant tool-call group plus every completed result belonging to it; never split a call from its result or compact pending approval, Terminal, wait, incomplete, or streamed state.
- Always preserve the active turn's original user request, pending operations, and newest completed tool-exchange suffix raw. Preserve approximately 70k of newest safe raw context when possible, target a rebuilt request around 100k, and reject a rebuilt request above 120k.
- If safe automatic compaction fails, do not dispatch the main model above the 170k trigger. Report the runtime limit without changing canonical history.
- Treat a compaction as a derived representation with source provenance. Snapshot boundaries use stable canonical turn/task ordinals and exact persisted message/tool-batch references, never ordinals regenerated from the remaining projection. It never overwrites or replaces exact canonical content, and exact retrieval remains available.
- For successful individual tool results over 3,000 estimated tokens, give the model a turn-local `R<n>` handle and append one compact release reminder to that existing tool result. Do not inject a separate hidden message. A piggybacked release changes only the current model-visible copy, never requires a separate model round trip, never blocks omitted functional calls, and never deletes the exact result.
- Every model-facing tool result passes through one shared final output guard. Existing narrower tool limits remain authoritative; dynamic MCP output is persisted exactly before projection, defaults to at most approximately 4,000 estimated tokens, never exceeds 6,000 estimated tokens, and returns exact pagination/retrieval metadata through existing read and trace surfaces rather than a new tool.

Automatic retrieval may rank and paginate candidates because it does not alter canonical content. Exact inspection returns complete source items. Automatic compaction and turn-local release are model-projection controls with exact recovery; neither creates a second durable memory authority.

## Global Socrates And Goal-Centric Memory

The target entry experience is one global Socrates. The user opens the landing page, chooses Open, and enters the seamless goal view without first creating a project or conversation. The header exposes Paths, a visible Selected/Full filesystem-access control, and Settings. The collapsible sidebar groups exact Q&A exchanges by goal and has no required project hierarchy.

Paths, connected accounts, apps, and credentials are authorized resource scopes. Goals are coherent user outcomes. Tasks are individual user-request lifecycles inside goals. Released projects may remain migration metadata or internal scope coordinates, but they are not the target user mental model.

The following is the non-negotiable foreground flow. It is the crux of Socrates:

```text
User message arrives
        ↓
Save the exact message immediately
        ↓
Run goal retrieval, memory retrieval, and capability retrieval together
        ↓
One Socrates goal decision:
current goal / retrieved older goal / new goal / clarify
        ↓
Bind the selected goal and exact relevant memory
        ↓
Socrates starts working normally
        ↓
Tool calls ↔ tool results, as many as genuinely needed
        ↓
Socrates checks whether important knowledge or progress needs saving
        ↓
Final structured response:
answer + goal state + goal note
        ↓
Save the answer, task, goal, capsule, usage, and evidence together
        ↓
Run asynchronous memory enrichment
```

Goal resolution is the one model decision before foreground work. After the goal is bound, Socrates enters one ordinary working loop. The loop investigates, plans, calls tools, receives results, updates useful working or durable state when needed, and returns the final structured result. A provider continuation needed to consume a real tool result is part of that same loop. A separate draft call, reconciliation call, or final-formatting call is forbidden.

The shared provider request enforces the terminal result schema natively on that same streamed loop, including tool-capable continuations. Prompt text alone is not sufficient. Native enforcement must not become a repair prompt, hidden message, or detached structured-output call, and its stable schema must be included in model-input token accounting.

Reconciliation before the answer remains mandatory as Socrates' judgment, but it happens inside the normal working loop. If nothing important changed, Socrates answers without ceremonial reads or writes. If an important decision, verified milestone, blocker, repository fact, or restart state changed, Socrates uses its normal tools to update and verify the correct durable surface, then continues the same loop and gives the final structured response. Reconciliation is never a separate agent, model phase, provider call, or hidden checkpoint message.

Goal resolution is not a separate agent role. The same Socrates runtime and prompt core receives the exact latest message, current goal capsule, latest exact exchange, and a small numbered set of retrieved older capsules. It chooses only current, retrieved older goal, new, or clarify. There is no model-facing continue/resume distinction, no goal-search tool loop, and no independently configurable Goal Router.

Normal goal resolution projects no more than three older goal capsules. Capability retrieval concurrently selects a compact set of relevant installed skills and MCP tools through the shared hybrid foundation; it never uses keyword-only prompt matching or dumps the registry. `read`/`search` over `socrates://capabilities` is the exact fallback, and Socrates must use it before declaring that an installed capability is unavailable.

The main tool surface exposes one always-visible `capability_manager` for approval-gated skill and MCP mutation. Main Socrates reads identity, user profile, generated tool guidance, installed skills, project resources, and `.socrates` documents through one governed resource protocol. Identity and user profile remain Memory-Agent-owned and can receive proposed changes only through `memory_note`; generic edit never writes them or skill files.

There is no model-driven Memory Router in the critical path. Hybrid retrieval discovers candidates mechanically; its parallel memory query includes the current capsule when available. After goal binding, a changed goal or empty eligible first pass may trigger one targeted query through the same service before deterministic selection filters exact memory. Main Socrates may inspect deeper exact sources through the shared retrieval capability. Model-driven durable memory curation runs asynchronously through the same shared architecture when genuine judgment is required.

Every user message creates a task. A new goal is created only for a genuinely independent outcome. Acting on something found in the current goal, implementing after inspection, replying after reading, testing after building, or changing the named entity while following the same outcome remains inside the current goal.

Each goal owns exact canonical exchanges and evidence plus a versioned structured capsule containing its live objective, verified progress, current task, important decisions, blockers, open items, and exact source anchors. The capsule is not conversation compaction and never replaces exact history. The compact backend goal ledger stores the current-goal pointer and latest capsule references, not transcripts or evidence bodies.

## How Socrates Uses Its Working Space

Socrates uses its working space naturally, like a capable human assistant keeping useful notes while doing the work:

- `.socrates/notes`: free-working space for plans, tasks, experiments, temporary scripts, and progress notes.
- `.socrates/memory`: important project knowledge and decisions that future work needs.
- `.socrates/repo_docs`: verified facts about how the repository works.
- `memory_note`: something Socrates wants the asynchronous Global Memory Agent to consider for identity, user profile, cross-project memory, or a future skill.

These surfaces support the work; they are not ceremonies. Socrates does not read or update every surface before or after every tool call. It records what a human assistant would need to continue correctly, uses the smallest correct surface, and leaves it alone when nothing worth preserving changed. Plans and task records may be free-form; fixed filenames are forbidden as a requirement.

## No Hidden Or Shadow Model Messages

The runtime must not inject behavioral steering after every tool batch or create synthetic user/developer messages that silently change how Socrates behaves. In particular, the following are forbidden:

- an action-ledger message listing recent calls after each tool batch;
- repeated-call, tool-count, context-growth, memory-note, Terminal-capability, progress-checkpoint, or final-checkpoint messages injected as user or developer turns;
- a hidden draft-to-reconciliation-to-final sequence;
- any uncatalogued prompt fragment, reminder, summary, or control message.

Backend counters, deduplication, budgets, stale-edit checks, truncated-call rejection, approvals, and other mechanical guards stay in backend code. A relevant failure is returned inside the matching tool result. The stable prompt owns enduring behavior. Exact retrieved context owns current facts. Tool results own their own output.

The only automatic result-local notices allowed by this manifesto are concise, declared metadata attached to an existing tool result, such as the `R<n>` release reminder and at most one approved `.socrates` reminder during substantial work. They never become separate messages, never impersonate the user, never force a read or write, and never create another model call. Any new category of model-visible injected content requires explicit user approval plus an authority-document and CI-allowlist update before implementation.

The stable cache prefix remains byte-stable: canonical base prompt, standing identity/profile/project rules, generated stable surface guidance, and the unchanged exact history prefix. Current goal context, selected memory/capabilities, the latest user message, tool exchanges, and approved result-local notices append afterward. Volatile ids, timestamps, counters, and runtime steering never enter the stable prefix.

## Refactor Strategy

Perform the work on a dedicated refactor branch created from the latest accepted documentation and lifecycle checkpoint. Build and prove the replacement core on that branch, cut production callers over once, then delete the replaced implementation.

Temporary side-by-side code is allowed only inside the unmerged refactor branch when required to construct and compare the replacement. It must not create a runtime flag, fallback, compatibility route, or independently selectable production workflow. No temporary parallel authority may survive the final cutover commit.

Do not restart from a blank repository. Preserve the verified product and persistence foundations and replace the faulty boundary deliberately.

## Required Construction Order

### 1. Freeze The Complete Capability Space

Before redesigning individual tools, produce a machine-verifiable inventory covering all of the following:

- Static model-facing function tools.
- Dynamically discovered MCP tools.
- Automatic retrieval and prefetch.
- Parallel goal/memory candidate retrieval, same-Socrates goal resolution, and deterministic memory selection.
- Structured model workers with no tools.
- Context disposition, context assembly, and context compression.
- Goal, task, capsule, and lifecycle mutations.
- Approval, Terminal, wait, and continuation behavior.
- Typed UI commands that mutate agent-owned work state.
- Provider calls, fallbacks, repair attempts, and handovers.

Counting model-tool names alone is not a capability audit. Hidden deterministic work and model calls are part of the boundary even when the foreground model cannot invoke them directly.

### 2. Establish The Agent Architecture

Define a small set of explicit primitives before instantiating any agent:

- `AgentDefinition`: prompt, completion contract, model role, limits, and capability manifest.
- `AgentRuntime`: the sole provider-neutral model execution loop.
- `CapabilityDefinition`: canonical schema, result contract, policy, executor, and telemetry identity.
- `RoleManifest`: the exact capabilities available to one agent role.
- `ContextPipeline`: ordered preparation of goal scope, memory, visible history, retrieval, runtime state, and compression.

A structured semantic phase may declare one flat model-facing wire schema beside its strict domain result when provider-native branch schemas are measurably unreliable. Both live in shared contracts; the shared runtime validates the wire form and the owning agent normalizes it immediately into the sole semantic result. This is a transport projection, never another router, provider-specific schema, or decision authority.

These names describe responsibilities, not a requirement to create god classes. Routing, context preparation, execution, persistence, and projection remain focused modules behind one public architecture.

No feature runtime may call a provider directly. No agent role may create its own private runner or tool-dispatch convention.

### 3. Build One Capability And Tool Standard

A capability definition is the single source of truth. It must declare:

- Stable capability id and human-readable description.
- Capability kind, such as model tool, dynamic tool, automatic retrieval, structured worker, deterministic authority, or typed user command.
- Allowed agent roles and runtime scopes.
- One strict input schema and one strict result schema where input/output exists.
- One executor binding.
- Approval, sandbox, concurrency, retry, timeout, and idempotency policy.
- Evidence, usage, error, and audit persistence behavior.
- Provider projection generated from the canonical schema.

Forbidden patterns include:

- Separate runtime and model-input schemas for the same tool.
- Handwritten provider-specific copies of tool schemas.
- Provider adapters that silently broaden, flatten, normalize, or weaken a contract.
- Tool-name special cases in provider code.
- Ad hoc tool arrays constructed inside feature runtimes.
- Dynamic tools injected outside the capability catalog.
- Executors available under names that are absent from the owning role manifest.
- Retry normalization that guesses what malformed arguments meant.

Prefer a small number of capable, coherent tools. Do not create a narrow tool for every operation, but do not hide mutually incompatible grammars inside an ambiguous mega-tool. A tool should represent one concept with an input grammar that makes invalid states unrepresentable.

### 4. Instantiate Roles From The Shared Architecture

Main Socrates, asynchronous Global Memory Agent work, Skill Writer, automatic provenance-linked context compactors, and confirmation workers must be declared as agent definitions or explicitly catalogued deterministic authorities. Final structured validation is deterministic validation of the last response from the same foreground loop; it is not another model worker or provider call. Goal candidate retrieval, memory candidate retrieval, deterministic memory selection, goal-ledger transactions, and access-scope enforcement are catalogued deterministic services. The same-Socrates goal-resolution step is a declared phase of the main Socrates definition, not another independently configurable agent.

Roles may differ only through declared configuration:

- Prompt and stable context.
- Structured output or completion mode.
- Model selection and thinking settings.
- Capability manifest.
- Tool-call, token, time, retry, and concurrency limits.
- Persistence scope.

Role-specific requirements must not be implemented by forking the runtime.

### 5. Connect One Global Socrates Once

The target global seamless view uses one prepared-context contract, one main agent definition, one capability manifest, one Terminal/approval/wait lifecycle, one exact-history policy, and one validated finalization contract. Released Classic, project, and Flow transports may retain migration adapters temporarily, but all must enter the same goal-centric lifecycle and none may remain a second semantic authority.

Do not reintroduce `focus_ledger` as a main-agent tool. Goal selection belongs to the same-Socrates turn-resolution phase over the current capsule and retrieved older capsules. Goal progress belongs to the validated final result applied to the already-bound canonical goal. Explicit user lifecycle actions remain typed backend commands.

### 6. Cut Over And Delete

After the replacement passes deterministic integration tests:

1. Switch the global seamless product and all released compatibility callers to the replacement entrypoint.
2. Remove the old agent runners and registries.
3. Remove duplicate and provider-specific tool schema paths.
4. Remove unused retrieval and context authority entrypoints.
5. Remove retired worker contracts, telemetry roles, prompts, and documentation.
6. Ensure unsupported desktop/Tauri or generated runtime copies cannot be selected as source or launched by supported commands.
7. Add absence tests proving the deleted paths cannot return.

Do not retain old behavior as a fallback "for safety." A fallback is another authority and must satisfy the same architecture or be removed.

## No Shadow Tools Or Authorities

The repository must generate a complete capability manifest in CI. CI must fail when it finds an uncatalogued:

- Provider model call.
- Model tool definition.
- Dynamic tool registration or invocation.
- Retrieval or automatic-prefetch entrypoint.
- Goal/task/capsule lifecycle mutation.
- Context mutation, disposition, or compression worker.
- Agent or structured-worker invocation.
- Provider-specific tool-schema override.
- Supported runtime entrypoint.

The generated manifest must show, for each capability, its owner, callers, allowed roles, schemas, executor, provider projection, persistence effects, and tests. A capability that cannot be traced through this manifest is a defect.

Historical reports may describe deleted systems, but they must be visibly marked historical and must never be imported, registered, launched, or treated as current architecture.

## Verification Gates

Testing proceeds from the foundation upward and uses isolated `SOCRATES_HOME`, databases, workspaces, credentials, ports, and Terminal state. Tests must never mutate the user's normal Socrates state.

Required gates are:

1. Capability schema and executor contract tests.
2. Generated provider-schema parity tests for every supported provider.
3. Role-manifest and forbidden-capability tests.
4. Agent-loop tests for valid calls, invalid calls, retries, budgets, cancellation, and finalization.
5. Model-input allowlist tests proving no shadow message, synthetic user turn, per-batch action ledger, or detached reconciliation/final call can reach the provider.
6. Retrieval tests for parallel goal/memory candidates, current-goal inclusion, exact inspection, audit, filtering, and index lifecycle.
7. Context tests for exact scoped selection, result-local release-only `R<n>` handling, automatic 170k oldest-head compaction, an approximately 70k exact whole-turn suffix, evidence preservation, and continuation recovery.
8. Terminal tests for foreground execution, persistent start, input, output, stop, wait, cancellation, and restart cleanup.
9. Goal/task lifecycle tests proving current, retrieved older goal, new, and clarify decisions without goal fragmentation.
10. Global UI and compatibility-adapter tests proving one main runtime, goal-centric sidebar, Paths/access enforcement, and no required project entry.
11. Packaged-runtime tests proving the supported launcher executes the just-built source revision.
12. Real-provider acceptance runs only after deterministic gates pass and must prove the normal no-tool path is one goal-decision call plus one foreground final call.

Real-provider testing must include malformed-call diagnostics with exact raw arguments, exposed schema identity, provider/model identity, retry history, selected runtime revision, and final task outcome. A successful HTTP response is not sufficient; the requested work must complete correctly.

## Change Discipline

- Do not fix isolated symptoms before locating the owning capability and authority path.
- Do not add compatibility aliases without an explicit removal point in the same refactor.
- Do not change persistence semantics merely to simplify the agent core.
- Do not weaken schemas to accommodate a model's malformed call.
- Do not call a phase complete while replaced production code remains reachable.
- Update this manifesto, `AGENT_CAPABILITY_WORKFLOW.md`, `REPO_RULES.md`, the unified lifecycle, implementation documentation, and their tests together whenever the target architecture materially changes.
- Stop when an implementation would violate this manifesto. Resolve the architecture instead of creating an exception.

## Definition Of Done

The agent-core refactor is complete only when a maintainer can begin with one global Socrates definition, follow the exact message through parallel candidate retrieval, same-Socrates goal resolution, deterministic memory selection, one normal catalogued working loop whose last continuation is the structured final response, atomic goal-capsule finalization, and asynchronous enrichment without encountering a second schema, runner, registry, router agent, retrieval authority, context authority, generated runtime, fallback workflow, hidden steering message, detached reconciliation call, or detached final-formatting call.
