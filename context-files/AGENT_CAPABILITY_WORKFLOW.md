# Socrates Agent, Capability, Tool, And Utility Workflow

Status: normative maintenance workflow for the shared agent architecture.

Read this file completely before adding, changing, reviewing, or removing an agent, capability, model-facing tool, shared utility, prompt, retrieval path, context stage, provider projection, tool guide, or role manifest. This workflow operationalizes `AGENT_REFACTOR_MANIFESTO.md`. The manifesto defines the destination; this document defines the required change path.

## 1. The Homogeneity Rule

Every agent-related change must flow through the same dependency chain:

```text
canonical contracts and shared utilities
  -> CapabilityCatalog
  -> RoleManifest
  -> AgentDefinition
  -> shared ContextPipeline
  -> shared AgentRuntime
  -> provider projection generated from canonical schemas
  -> shared execution, policy, evidence, telemetry, and persistence hooks
  -> validated final result
```

No route, store, UI handler, Classic adapter, Flow adapter, worker, MCP integration, or provider may skip this chain.

For the unified foreground resource surface, `read` and `search` own both workspace paths and authorized `socrates://` resources. `edit` owns ordinary workspace files plus explicitly writable `.socrates` resources through the same authority registry. Identity, user profile, generated tool guidance, and installed skill files are read-only to main Socrates. Identity/profile proposals go through `memory_note`; skill and MCP mutations go through the always-visible approval-gated `capability_manager`.

One shared implementation does not require a process-global mutable singleton. Services may be instantiated or injected for isolation, testing, and concurrency, but every instance must use the same canonical implementation and contracts. Turn state, tool-call state, context handles, approvals, Terminal sessions, and model events remain request-scoped.

## 2. Canonical Ownership Map

The refactor must converge on these ownership boundaries:

| Concern | Canonical owner | Forbidden duplicate |
| --- | --- | --- |
| Cross-package schemas and persisted contracts | `packages/contracts` | Local lookalike schemas or provider copies |
| Provider-neutral model loop | `packages/core` shared `AgentRuntime` | Direct provider calls or private runners |
| Agent role configuration | `packages/core` declarative `AgentDefinition` records | Role-specific orchestration classes that fork the runtime |
| Capability and tool definitions | One `packages/core` `CapabilityCatalog` | Ad hoc registries or tool arrays |
| Workspace file, search, patch, and Terminal mechanics | `packages/workspace` | Agent/store-specific filesystem or process implementations |
| Parsing and Markdown-aware chunking | One shared retrieval utility module | Separate trace, memory, and goal chunkers |
| Embeddings | Existing provider abstraction plus one shared embedding service | Direct embedding calls from routers or stores |
| Vector storage and similarity retrieval | One server retrieval service and disposable index adapter | Per-agent vector databases or search pipelines |
| Context preparation | One shared `ContextPipeline` with typed stages | Classic-, Flow-, or worker-owned hidden context assembly |
| Goal/task lifecycle | Canonical backend work store and typed transactions | Main-agent `focus_ledger` tool or `.socrates/FOCUS_LEDGER.md` |
| Tool usage documentation | Generated from canonical capability definitions | Hand-maintained tool contract copies |
| Provider tool schemas | Generated from canonical input schemas | Tool-name special cases or handwritten provider schemas |

Exact paths may be finalized during the architecture phase, but each concern must have exactly one code owner before production cutover.

### Implemented Agent-Core Owners

Phase 1 of the agent-core rebuild establishes these concrete owners:

- `packages/core/src/agent/AgentDefinition.ts` owns the declarative agent, role-manifest, context-profile, limits, and inventory contracts.
- `packages/core/src/agent/AgentInstance.ts` binds a definition to the shared runtime and enforces prompt, tool, context, repair, and timeout boundaries.
- `packages/core/src/agent/AgentRuntime.ts` is the sole provider-neutral model execution implementation.
- `packages/core/src/agent/ContextPipeline.ts` is the one injectable context-preparation boundary.
- `packages/core/src/agent/agentDefinitions.ts` owns the production definition records.
- `architecture/agent-definitions.generated.json` is generated evidence, not a hand-edited authority. Run `pnpm generate:agent-architecture` after intentional definition changes and `pnpm check:agent-architecture` in verification.

Phase 3 removed the former Goal Router and Memory Router definitions with their owning lifecycle cutovers. The architecture check now rejects their names, tools, prompts, worker settings, and direct callers; never reintroduce them as definitions or compatibility aliases.

### Implemented Capability-Catalog Owners

Phase 2 establishes these concrete owners and removes the replaced paths:

- `packages/core/src/capabilities/CapabilityDefinition.ts` owns the immutable capability contract and inventory projection.
- `packages/core/src/capabilities/CapabilityCatalog.ts` is the sole static capability inventory, role resolver, dynamic MCP registration boundary, typed-command inventory, and documentation metadata owner.
- `packages/core/src/capabilities/providerProjection.ts` derives provider-facing JSON Schema once from each canonical runtime schema; adapters consume the supplied projection unchanged.
- `packages/core/src/agent/agentDefinitions.ts` owns exact role capability ids; `AgentInstance` validates each definition's context stages and capability scope before dispatch.
- `architecture/capabilities.generated.json`, `architecture/role-capability-matrix.generated.json`, `architecture/provider-tool-schemas.generated.json`, `architecture/capability-executor-tests.generated.json`, and `architecture/runtime-mcp-capabilities.generated.json` are reproducible evidence, not hand-edited authority.
- `apps/server/src/memory/defaults/primary/tool_usage/` is generated from catalog descriptions and catalog-owned behavioral guidance. The generated Markdown is not a schema copy.
- `pnpm generate:agent-architecture` writes these artifacts. `pnpm check:agent-architecture` verifies exact regeneration, ownership paths, role resolution, provider-schema shape, removed authority names, and the absence of ad hoc runtime tool attachment; CI runs the check.

The former `packages/core/src/tools/registry.ts`, provider schema-copy module, provider tool-name schema branches, model-only input schemas, malformed-call normalizer, and direct dynamic-tool injection path are deleted. They must not be recreated under aliases.

## 3. Complete Capability Classification

Before changing behavior, classify it as exactly one catalogued capability kind:

- `model_tool`: explicitly callable by a model.
- `dynamic_tool`: discovered at runtime, such as an MCP child, but still catalogued and audited.
- `automatic_retrieval`: deterministic or query-driven retrieval performed before a model call.
- `structured_worker`: a model-driven role that may have no tools.
- `context_stage`: context selection, disposition, packing, compression, or recovery.
- `deterministic_authority`: canonical backend state such as the goal ledger.
- `typed_user_command`: an explicit UI/backend lifecycle operation.

If behavior cannot be classified and traced through the catalog, do not implement it.

## 4. Adding Or Changing A Model-Facing Tool

Perform every step in order:

1. Confirm that an existing coherent tool cannot support the operation without weakening its grammar.
2. Define or update the strict canonical input and result schemas in the owning contract module.
3. Define or update one `CapabilityDefinition` with its id, description, kind, allowed roles, scopes, executor binding, approval policy, sandbox policy, concurrency, timeout, retry, idempotency, evidence, telemetry, and documentation metadata.
4. Implement the underlying domain operation once in the owning package. Workspace mechanics belong in `packages/workspace`; orchestration does not.
5. Bind the executor to the canonical capability. Do not construct a second input decoder.
6. Add the capability id only to the intended `RoleManifest` records.
7. Generate provider schemas from the canonical schema. Do not edit provider projections.
8. Generate the tool usage Markdown and role/tool inventory. Do not hand-edit generated tool contract text.
9. Update an agent prompt only when the model needs behavioral sequencing or judgment that cannot be expressed by the schema, description, role manifest, or runtime policy. Never paste the schema into the prompt.
10. Add schema, executor, policy, provider-parity, documentation-generation, role-manifest, malformed-call, and integration tests.
11. Run the architecture drift check and all affected Classic/Flow tests.

The target generator must derive the existing tool-guide output under `apps/server/src/memory/defaults/primary/tool_usage/` or its accepted replacement from the catalog. Generated files must identify their source and reject manual drift.

### Tool Review Questions

- Does one canonical schema describe exactly what the model sees and what runtime validates?
- Can invalid operation/field combinations be made unrepresentable?
- Is the tool one coherent concept rather than a narrow convenience or ambiguous mega-tool?
- Is its executor shared by every role that receives it?
- Are approval, sandbox, retry, and evidence behaviors declared rather than hidden in a caller?
- Are provider schemas byte-for-byte generated from the same source?
- Are the tool guide and role attachment generated and current?
- Is there an absence test for any tool or schema path replaced by this change?

## 5. Adding Or Changing An Agent Role

1. Confirm that the capability is genuinely model-driven. Prefer deterministic code for deterministic work.
2. Define strict input and output contracts. If real-provider evidence proves a branch-heavy output unreliable, a single flat model-facing wire contract may sit beside the domain result in `packages/contracts`; normalize it immediately in the owning agent and test that the semantic result is unchanged.
3. Add one declarative `AgentDefinition` specifying prompt id, completion contract, model-setting role, `RoleManifest`, limits, timeout, repair/fallback policy, context profile, and persistence scope.
4. Reuse the shared `AgentRuntime`; never subclass or wrap it into a private provider loop.
5. Reuse the shared `ContextPipeline`, selecting only declared stages.
6. Attach capabilities exclusively through the role manifest.
7. Place the production prompt in the canonical prompt folder and keep tool grammar out of prompt prose.
8. Add tests for definition validity, exact role capabilities, context stages, structured validation, bounded repair/failure, telemetry, persistence, and forbidden tools.
9. Add or update worker model settings only when the role is independently configurable.
10. Regenerate the agent/capability inventory and run the architecture drift check.

Main Socrates is one global `AgentDefinition`. Released Classic, project, and Flow callers may supply typed compatibility metadata during migration, but they may not supply different main prompts, tool schemas, role manifests, provider loops, goal policies, memory-selection policies, or execution behavior.

## 6. Adding Or Changing Shared Utilities

Shared utilities include parsing, chunking, hashing, token estimation, embedding orchestration, vector indexing, similarity search, lexical search, hybrid ranking, parent grouping, pagination, result bounding, exact inspection, and retrieval diagnostics.

For every utility change:

1. Search all existing implementations and callers.
2. Select the domain owner and define one typed public interface.
3. Move or replace duplicate implementations instead of adding another helper.
4. Keep pure transformations stateless. Inject stateful services such as embedding providers, databases, vector indexes, clocks, and filesystem adapters.
5. Make trace, memory, and goal-card retrieval reuse the same primitives; differences belong in typed corpus adapters and filters.
6. Preserve authoritative state boundaries: SQLite/application storage is canonical; vector indexes are rebuildable projections.
7. Add unit tests for the utility and contract tests for every corpus or agent consumer.
8. Delete replaced helpers and add import/absence checks preventing them from returning.

Do not put utility behavior in prompts, tools, routers, or provider adapters merely because one caller currently needs it.

## 7. Retrieval And RAG Changes

All retrieval changes must trace this path:

```text
canonical source rows
  -> shared parser/chunker
  -> shared embedding service
  -> shared lexical/vector index
  -> shared ranking and parent grouping
  -> typed corpus adapter
  -> catalogued automatic retrieval or model tool
  -> exact human-readable result pages with provenance
```

The current logical corpora are conversation/task traces, curated memory sections, goal cards, and capability cards for installed skills/MCP tools. They share infrastructure but retain typed authority and visibility filters. Do not expose vectors, chunks, scores, fingerprints, index jobs, or database ids as separate model tools.

Parallel goal-candidate retrieval, current-capsule-aware parallel memory-candidate retrieval, capability retrieval, single conditional bound-goal refinement, deterministic post-binding memory selection, main-agent retrieval, exact inspection, and background enrichment must all be catalogued even when they share lower-level utilities. The current goal must be supplied independently of retrieval score; normal resolution receives at most three older goals. Bound-goal refinement may occur only through the same memory retrieval service after a goal change or empty eligible first pass. Capability retrieval may deterministically resolve an exact canonical name/id but must not use keyword-only prompt matching; `socrates://capabilities` is the mandatory fallback before an unavailable-capability claim. Do not recreate `goal_search`, a retry loop, a second retrieval engine, or a Memory Router tool loop as a shadow path.

## 8. Prompt Changes

Prompts define role, judgment, sequencing, and user-facing behavior. Schemas and generated capability descriptions define callable grammar.

When changing a prompt:

1. Identify the owning `AgentDefinition`.
2. Confirm whether the change belongs instead in a schema, capability description, runtime policy, context stage, or generated tool guide.
3. Update the one canonical prompt only.
4. Do not create Classic/Flow prompt copies.
5. Do not duplicate tool field lists or dynamic capability inventories in prose.
6. Update focused prompt contract tests and behavioral integration tests.
7. Regenerate prompt/capability snapshots where used and run drift validation.

Tool usage Markdown is supporting documentation, not a second schema authority. It must be generated from the capability catalog plus concise behavioral guidance owned by that capability.

## 9. Context, Goal Ledger, And Finalization Changes

The ordered lifecycle is:

```text
persist exact user message immediately
  -> retrieve goal and memory candidates in parallel
  -> same-Socrates goal resolution: current, retrieved older goal, new, or clarify
  -> bind goal/task and deterministically select exact memory
  -> ContextPipeline assembles typed exact context
  -> main Socrates works through the shared runtime
  -> same-Socrates milestone/final `.socrates` reconciliation
  -> strict final answer plus bound-goal outcome
  -> atomic answer/task/goal/capsule persistence
  -> publication to the global seamless UI
  -> asynchronous memory enrichment
```

The goal ledger is a catalogued `deterministic_authority`. It owns the current-goal pointer, lifecycle metadata, and latest capsule references; it does not contain transcript or evidence bodies. Do not expose mutable goal completion through a model tool and do not create a workspace focus-ledger file.

Goal resolution is a minimal phase of the same main Socrates definition and prompt core, not an independent agent role. It receives the exact latest message, current capsule, latest exact exchange, and a small numbered list of older capsules from hybrid retrieval. It decides only current, retrieved older goal, new, or clarify, uses no tools, and never authors opaque ids. Backend code applies the selected pointer and creates the task.

Goal and memory candidates are retrieved concurrently, and the first memory query includes the current capsule when available. Retrieval ranks candidates but never makes semantic decisions. After goal binding, the same retrieval service may perform one targeted query when the goal changed or the first pass has no eligible memory; deterministic selection then filters and reranks exact memory by authorization, resource scope, goal/task ownership, provenance, relevance, and duplication. There is no model-driven Memory Router in the critical path.

Main Socrates then receives the bound capsule, latest exact exchange, exact selected memory/evidence, authorized resource state, and active Terminal/approval/wait state. It does not receive a bulk goal ledger. Goal capsules are structured live state with exact source anchors; they do not replace canonical goal history.

Exact goal-history selection, stable standing context, Terminal continuation state, turn-local large-result release, automatic 170k compaction, finalization, and asynchronous enrichment are separate declared stages. Changing one requires tests proving the others retain their ordering and protected information.

Every context-stage change must satisfy the exact-source and model-projection rule:

1. Canonical user messages and visible assistant answers remain exact.
2. A selected relevant message is included whole, never character- or token-sliced.
3. `bounded` means scoped or paginated, with explicit continuation, not truncated.
4. Never document a stage merely as `bounded context`; name whether it is exact scoped selection, exact pagination, lossless indexing, turn-local released projection, or automatic provenance-linked model-context compaction.
5. Parsing, chunking, embeddings, and ranking create disposable derivatives and never replace source text.
6. At 170k estimated model-visible tokens, one shared stage automatically compacts only the oldest completed-turn head, preserves approximately 70k of newest complete Q/A plus the active turn, targets around 100k, accepts no result above 120k, and never dispatches the main model above the trigger after failed safe compaction.
7. Successful individual tool results over 3,000 estimated tokens receive monotonic turn-local `R<n>` handles; release is the only disposition, piggybacks with the next normal tool request, never adds model inference, and never blocks functional tools when omitted.
8. Compaction and release remain provenance-linked model projections; canonical exact sources are never overwritten and exact retrieval stays available.
9. Tests must prove whole selected messages remain exact, protected suffix turns remain complete, handles reset each user turn, release receipts can recover exact evidence, and pagination can recover exact deferred content.

## 10. Dynamic MCP Changes

MCP discovery does not authorize registry bypass.

1. The parent MCP capability owns discovery, configuration, credentials, and lifecycle.
2. Each exposed MCP child receives a stable runtime catalog entry containing server identity, child name, schema, allowed role, scope, session binding, executor, and telemetry identity.
3. The shared runtime obtains MCP children from the catalog, not an arbitrary extra-tools array.
4. Provider projection, validation, execution, errors, and evidence use the same capability path as static tools.
5. Removing or disabling a server removes its children atomically from the eligible manifest.

## 11. Removing Or Replacing A Capability

1. Identify every role, caller, prompt, guide, test, telemetry label, event, persistence effect, API, migration constraint, and generated/runtime copy.
2. Cut all production callers to the replacement.
3. Remove the old catalog entry, executor, schemas, provider projection, prompt text, guide, and adapters.
4. Remove obsolete contracts and telemetry roles when migration compatibility does not require them.
5. Keep historical documentation only when clearly labelled historical.
6. Add tests and static checks proving old names and imports cannot return.
7. Verify supported packaged runtime artifacts use the new source revision.

An alias, compatibility decoder, fallback runner, or dormant exported function remains an authority path. It must have an explicit migration owner and deletion in the same refactor or it must not be added.

## 12. Required Generated Artifacts

The refactor must produce these generated views from code-owned authority:

- Complete capability inventory, including non-tool capabilities.
- Agent role and capability matrix.
- Provider-facing tool schemas.
- Tool usage Markdown.
- Capability-to-executor and capability-to-test map.
- Dynamic MCP child inventory at runtime.

The committed Phase 2 views are the five `architecture/*capabilit*.generated.json`/matrix/schema artifacts named above plus `architecture/agent-definitions.generated.json` and generated tool guides. Runtime MCP children also appear through `CapabilityCatalog.runtimeInventory`; `architecture/runtime-mcp-capabilities.generated.json` records that dynamic registration contract and forbids direct fallback execution.

Generated artifacts must contain a source marker and must be reproducible. CI fails if regeneration changes the worktree.

## 13. Required Validation Command

Before agent-core implementation begins, add one repository command:

```bash
pnpm check:agent-architecture
```

It must run generation in verification mode plus static and test checks that reject:

- Provider calls outside the shared runtime boundary.
- Model tools or executors outside the capability catalog.
- Ad hoc role tool arrays.
- Provider-specific tool schemas or tool-name special cases.
- Ungoverned automatic retrieval or context mutation.
- Dynamic MCP injection outside the catalog.
- Different global/compatibility main-agent definitions, manifests, goal policies, or memory-selection policies.
- Stale generated tool guides or inventories.
- Imports of deleted runners, registries, schemas, utilities, or capability names.
- Supported launchers resolving ignored, generated, or unsupported desktop runtime code.

This command must run in normal CI and relevant pre-release verification. Documentation is not considered synchronized when this check fails.

## 14. Testing And Evidence Matrix

Every change selects and records the applicable rows:

| Change | Minimum evidence |
| --- | --- |
| Canonical schema | Valid, invalid, boundary, and provider-parity tests |
| Executor or utility | Unit tests plus abort/error/bounds behavior |
| Role manifest | Exact allow-list and forbidden-capability tests |
| Agent definition | Prompt, context, tool, structured-output, repair/failure tests |
| Retrieval | Source, chunking, ranking, filtering, fallback, inspect, and rebuild tests |
| Context stage | Ordering, token bounds, protected anchors, recovery, and evidence retention |
| Main Socrates | Global UI plus compatibility integration using the same definition and manifest |
| Terminal/wait | Run, start, input, output, wait, stop, cancel, restart, and cleanup |
| Dynamic MCP | Discovery, schema, role, execution, credential, removal, and telemetry |
| Packaging | Runtime source revision, clean archive, and launcher smoke test |
| Real provider | Raw call diagnostics and complete user-task outcome after deterministic gates pass |

All mutating tests use isolated state. Passing unit tests does not substitute for the affected integration or packaged-runtime gate.

## 15. Review Completion Checklist

A change is complete only when all answers are yes:

- Did it use the canonical owner and shared interface?
- Did it avoid new mutable global request state?
- Is every capability and automatic action catalogued?
- Do role manifests expose exactly the intended capabilities?
- Are schemas, provider projections, tool guides, and inventories synchronized from one source?
- Did prompts change only where behavioral guidance truly changed?
- Were all affected old paths deleted rather than left dormant?
- Do the global seamless UI and every released compatibility adapter share the main definition, tools, utilities, exact-history policy, and runtime?
- Does the critical path contain only parallel candidate retrieval, same-Socrates goal resolution, deterministic memory selection, and the main Socrates loop—with no router-agent shadow path?
- Does every causally dependent follow-up become another task in the current goal instead of a new goal?
- Did every canonical selected message remain exact, and did every automatic model-projection change preserve its required whole-turn suffix, provenance, exact recovery, and dispatch ceiling?
- Does `pnpm check:agent-architecture` pass?
- Do targeted unit, integration, isolated-state, real-provider, and packaging tests required by the matrix pass?

If any answer is no, the architecture change is not complete.
