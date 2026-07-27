# Socrates Agent Refactor Manifesto

Status: normative architecture authority for the agent-core refactor.

Implementation checkpoint: the shared `AgentDefinition`/`AgentInstance`/`AgentRuntime`/`ContextPipeline` foundation and the shared `CapabilityCatalog` cutover are implemented. The catalog now owns all current static model tools, role attachment, provider projections, runtime MCP child registration, declared retrieval/workers/context/authorities, typed Classic/Flow commands, generated inventories, generated tool guides, and CI drift enforcement. Goal/memory lifecycle convergence and the global seamless UI remain later phases; catalogued legacy entries identify those removal owners and are not permission to create parallel paths.

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

## Exact Content And Consent

Socrates must never silently trade user meaning for context efficiency.

`Socrates remembers everything` is the product's primary differentiator. The concrete contract is that everything the user chooses to entrust to Socrates remains exact, attributable, searchable, retrievable across time and authorized scopes, and deletable by the user. Recall may use lossless derived indexes and exact scoped selection, but a model-facing projection is never the canonical memory and a provider context limit is never permission to forget.

- Persist every user-authored message and visible assistant answer exactly as submitted or published.
- Never clip, shorten, rewrite, summarize, compact, or partially include an individual selected message, answer, explicit constraint, approval, blocker, or instruction.
- Preserve exact canonical source text even when parsing, chunking, embedding, indexing, ranking, or pagination creates derivative representations.
- Treat "bounded" as a finite, paginated, explicitly scoped projection. It never authorizes truncating the content of a selected item or deleting its source.
- Do not use `bounded context` as a standalone description. Every design, log, UI notice, and handoff must name the actual operation and its loss status: exact scoped selection, exact pagination, lossless derived indexing, or lossy user-approved compaction.
- Goal scoping may exclude clearly unrelated goals, but the runtime must not silently omit history that it believes may be relevant to the current request.
- When relevant exact history, evidence, or tool output cannot fit the provider request, stop before dispatch and ask the user whether a specific proposed efficiency operation is allowed.
- The request for consent must explain what content is affected, why the provider limit requires action, and whether the proposal would summarize, compact, omit, or replace anything.
- Apply a lossy transformation only after explicit user approval for that exact operation and scope. Silence, prior unrelated approval, or a generic performance preference is not consent.
- An approved summary or compaction is a derived representation with provenance. It never overwrites or replaces exact canonical content and exact retrieval remains available.
- If the user declines, do not proceed with the lossy provider request. Continue through exact pagination/retrieval where possible or report the hard provider limit.

Automatic retrieval may rank and paginate candidates without consent because it does not alter canonical content. Once an exact message or source is selected for model context, its text remains complete. If ranking would exclude potentially relevant history rather than merely defer it to another exact page, the runtime asks instead of guessing.

## Global Socrates And Goal-Centric Memory

The target entry experience is one global Socrates. The user opens the landing page, chooses Open, and enters the seamless goal view without first creating a project or conversation. The header exposes Paths, a visible Selected/Full filesystem-access control, and Settings. The collapsible sidebar groups exact Q&A exchanges by goal and has no required project hierarchy.

Paths, connected accounts, apps, and credentials are authorized resource scopes. Goals are coherent user outcomes. Tasks are individual user-request lifecycles inside goals. Released projects may remain migration metadata or internal scope coordinates, but they are not the target user mental model.

Every turn follows one shared sequence:

```text
persist exact user message immediately
  -> retrieve goal and memory candidates in parallel
  -> same-Socrates semantic goal resolution
  -> deterministic exact memory selection
  -> one shared Socrates agent loop
  -> validated atomic answer/task/goal/capsule commit
  -> asynchronous memory enrichment
```

Goal resolution is not a separate agent role. The same Socrates runtime and prompt core receives the exact latest message, current goal capsule, latest exact exchange, and a small numbered set of retrieved older capsules. It chooses only current, retrieved older goal, new, or clarify. There is no model-facing continue/resume distinction, no goal-search tool loop, and no independently configurable Goal Router.

There is no model-driven Memory Router in the critical path. Hybrid retrieval discovers candidates mechanically; deterministic selection filters exact memory after goal binding. Main Socrates may inspect deeper exact sources through the shared retrieval capability. Model-driven durable memory curation runs asynchronously through the same shared architecture when genuine judgment is required.

Every user message creates a task. A new goal is created only for a genuinely independent outcome. Acting on something found in the current goal, implementing after inspection, replying after reading, testing after building, or changing the named entity while following the same outcome remains inside the current goal.

Each goal owns exact canonical exchanges and evidence plus a versioned structured capsule containing its live objective, verified progress, current task, important decisions, blockers, open items, and exact source anchors. The capsule is not conversation compaction and never replaces exact history. The compact backend goal ledger stores the current-goal pointer and latest capsule references, not transcripts or evidence bodies.

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

Main Socrates, asynchronous Global Memory Agent work, Skill Writer, user-approved context compactors, confirmation workers, and final structured validation must be declared as agent definitions or explicitly catalogued deterministic authorities. Goal candidate retrieval, memory candidate retrieval, deterministic memory selection, goal-ledger transactions, and access-scope enforcement are catalogued deterministic services. The same-Socrates goal-resolution step is a declared phase of the main Socrates definition, not another independently configurable agent.

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
5. Retrieval tests for parallel goal/memory candidates, current-goal inclusion, exact inspection, audit, filtering, and index lifecycle.
6. Context tests for exact scoped selection, consent-gated lossy compaction, evidence preservation, and continuation recovery.
7. Terminal tests for foreground execution, persistent start, input, output, stop, wait, cancellation, and restart cleanup.
8. Goal/task lifecycle tests proving current, retrieved older goal, new, and clarify decisions without goal fragmentation.
9. Global UI and compatibility-adapter tests proving one main runtime, goal-centric sidebar, Paths/access enforcement, and no required project entry.
10. Packaged-runtime tests proving the supported launcher executes the just-built source revision.
11. Real-provider acceptance runs only after deterministic gates pass.

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

The agent-core refactor is complete only when a maintainer can begin with one global Socrates definition, follow the exact message through parallel candidate retrieval, same-Socrates goal resolution, deterministic memory selection, one catalogued tool/runtime path, atomic goal-capsule finalization, and asynchronous enrichment without encountering a second schema, runner, registry, router agent, retrieval authority, context authority, generated runtime, or fallback workflow.
