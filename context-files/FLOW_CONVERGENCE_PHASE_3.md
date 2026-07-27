# Flow Convergence Phase 3

Status: implemented on `codex/agent-core-rebuild` as the unified pre-turn lifecycle convergence phase.

`UNIFIED_SOCRATES_LIFECYCLE.md` remains the lifecycle authority. This file records the Phase 3 implementation and verification boundary. The earlier canonical Classic/Flow projection work remains foundational code and Git history, but it is not the Phase 3 definition.

## Implemented Lifecycle

Every new Classic or Flow user turn now follows the same semantic setup:

```text
persist the exact user message
  -> retrieve typed goal cards and memory candidates concurrently
  -> same configured Socrates resolves current | older | new | clarify
  -> deterministic backend applies the goal transition and binds the task
  -> deterministic policy selects authorized exact memory
  -> prepare one view-neutral exact context
  -> run the shared Socrates agent loop
  -> atomically persist the validated answer and bound-goal finalization
```

Classic and Flow retain their physical transport and persistence adapters, but neither has a separate goal or memory policy. Classic initializes the canonical Flow/goal projection even when the experimental Flow routes are not mounted, so disabling the Flow UI does not restore the retired Classic-only semantic path.

Terminal wait/resume remains one durable task. A resumed Classic physical turn copies the original goal association before model execution, so it receives the same capsule and cannot fall out of the unified lifecycle after a server restart or Terminal wake.

## Shared Retrieval And Typed Adapters

Phase 3 reuses the existing Markdown parser/chunker, embedding provider boundary, LanceDB index, lexical/vector search, hybrid ranking, parent grouping, and diagnostics.

The only new corpus contracts are:

- typed goal candidates containing a numbered result, backend goal reference, human title, exact card content, and occurrence time;
- typed memory candidates containing exact selected chunk content plus its authorized surface, file, section, heading, and global/project scope; and
- a typed retrieval receipt that records goal and memory completion or failure independently.

`apps/server/src/services/turn/turnCandidateRetrieval.ts` starts the two retrieval promises before awaiting either one and uses `Promise.allSettled`. One failure cannot be reported as successful recall and does not prevent the safe independent path from continuing. Goal retrieval never semantically decides whether work is current, older, or new.

## Same-Socrates Goal Resolution

`SocratesAgent.resolveGoal` uses the selected main provider, model, runtime settings, shared `AgentRuntime`, main Socrates definition, and main prompt core. It adds one short phase instruction, exposes zero tools, validates one strict four-way schema, and permits one shared structured-output repair.

The phase receives only the exact latest message, current capsule card, latest exact exchange in that goal, numbered older candidates, and an explicit clarification answer when present. It never receives or returns opaque goal ids.

Invalid output or provider failure uses a typed conservative fallback: retain an available current goal or ask for clarification. There is no keyword classifier, score threshold, private provider loop, separately configured router model, or goal-search tool loop. Unresolved references such as "the other one" must clarify when multiple listed goals are plausible rather than guessing the first result.

## Deterministic Memory Selection And Exact Context

`selectExactMemoryCandidates` is pure deterministic code. It rejects backend-only and already attached standing sections, deduplicates exact file/section ownership, ranks against the bound goal and current request, preserves source diversity, and returns at most eight exact candidate contents with human-readable provenance.

`prepareTurnContext` now contains only:

- the bound goal capsule fields;
- the exact current task request;
- the latest complete exact user/assistant exchange in that goal when available;
- an optional preceding-goal transition;
- selected exact memory; and
- honest retrieval warnings.

It has no Classic/Flow presentation field, project-first policy, Memory Router grammar, message character slicing, or token slicing. Older goal-history selection keeps complete model-message objects and complete retrieved items; page limits select whole items and never alter selected text.

## Removed Authorities

Phase 3 deletes the production paths for:

- `GoalRouterAgent` and `MemoryRouterAgent`;
- their independent prompts and tool loops;
- `goal_search` and `memory_search` model tools, schemas, executors, catalog entries, and generated guides;
- Goal Router and Memory Router worker settings and Settings UI rows;
- sequential-router latency tooling;
- the bounded goal-history text slicer;
- view-specific prepared-context policy; and
- old Goal Router coordinator names and imports.

Migration `0032_remove_router_settings.sql` deletes only the two retired worker-setting rows. Historical telemetry enum values remain parse-only compatibility for existing databases; no current producer can emit those router roles.

## Verification

Phase 3 evidence includes:

- contract tests for typed goal/memory candidates and exact context;
- unit tests for all four decisions, invalid-output repair/fallback, deterministic memory selection, exact history, and byte preservation;
- a concurrency test proving both candidate sources start before either completes;
- Classic and Flow integration tests through the same resolver and context services;
- goal-continuity and terminal wait/resume/restart tests proving one task remains on one goal;
- failure receipts for independent goal or memory retrieval failures;
- migration and Settings absence tests;
- architecture drift and deleted-path absence checks;
- full workspace tests, typechecks, builds, runtime packaging checks, and diff review; and
- isolated real OpenRouter acceptance using `deepseek/deepseek-v4-pro` for current, older, new, and clarify plus byte-exact task/exchange/memory assembly.

The real-provider acceptance initially exposed an ambiguous-reference guess. The canonical same-Socrates phase rule was corrected, and the rerun returned all four intended decisions with one structured usage record each. It used a disposable absolute `SOCRATES_HOME`; normal Socrates runtime state was never opened or mutated.

Final isolated verification on 2026-07-27 passed:

- `pnpm test`: CLI 9/9, contracts 43/43, web 26/26, MCP 14/14, providers 94/94 with one deliberate skip, workspace 105/105, core 126/126, and server 246/246;
- `pnpm typecheck` and `pnpm build` across the workspace;
- the generated architecture check: 8 agent definitions, 69 capabilities, 28 static tools, and 24 typed commands;
- `pnpm runtime:build`, native Whisper/Kokoro smoke, and LanceDB runtime smoke; and
- the final disposable OpenRouter DeepSeek V4 Pro acceptance, including leading/trailing task whitespace and exact multi-line exchange/memory bytes.

## Remaining Product Migration

This phase converges the released Classic and Flow pre-turn lifecycle. It does not claim that the later global no-project UI, consent-gated replacement for released automatic lossy compaction, or final removal of every project/conversation compatibility coordinate is complete. Those remain governed by `FLOW_NORTH_STAR.md` and `UNIFIED_SOCRATES_LIFECYCLE.md` and must build on this shared lifecycle rather than reintroducing routers or view-specific policies.
