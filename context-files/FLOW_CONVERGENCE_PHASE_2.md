# Flow Convergence Phase 2

Phase 2 establishes goal continuity and correct pre-turn context in Classic and Flow. It does not perform the Phase 3 canonical message/turn persistence migration or the Phase 4 Projects to Goals to Queries navigation and live-orb UI work.

## Authoritative Pre-Turn Order

Both views now use this dependency order:

```text
visible latest request and bounded Q&A history
  -> deterministic candidate prefetch
  -> shared Goal Router
  -> bind the task to the selected, reopened, or new goal
  -> goal-scoped Memory Router
  -> memory reads
  -> shared SocratesAgent
```

The Memory Router no longer returns or applies `goalRoute`. It receives the already resolved Active Goal and owns only memory recall. This removes the former Classic-only combined goal/memory decision and prevents memory from racing goal selection.

## Goal Router Context And Search

The fast request supplies:

- the full latest user request;
- the selected goal even when it is completed;
- the immediately preceding goal, protected from semantic displacement;
- three immediately preceding validated visible Q&A pairs;
- up to five Q&A pairs from the selected goal;
- at most five initial candidate cards, including capsule note and latest task where available.

The router also has one read-only `goal_search` tool for older goals. It supports lexical, semantic, and combined search, returns at most three cards per call, and the shared AgentRuntime hard-caps the router at three calls. Candidate numbers are allocated by the runtime; opaque goal ids are not authored by the model. The five prefetched candidates remain the normal zero-tool path.

## Lifecycle, Selection, And Continuity

Goal lifecycle and Flow selection are now independent. A validated answer may set a goal to completed, blocked, or discarded without selecting General Conversation. The selected goal and its capsule stay visible. If the next request meaningfully continues a completed goal, the Goal Router selects it and persistence records a reopen/resume rather than creating a disconnected goal.

An explicit switch or new-goal route changes selection. Explicit archive may select General Conversation because the archived goal is no longer a usable view target; ordinary answer completion does not.

Each routed turn retains immutable goal ownership. A new adjacent goal receives a deterministic bounded transition bridge containing the immediately preceding completed goal title, user request, validated visible answer, and verified outcome. Exact older evidence remains available through retrieval.

## Shared-Agent Homogeneity

The Goal Router remains a real structured agent using `AgentRuntime`, the prompt in `packages/core/src/prompts/goalRouterPrompt.ts`, strict contracts in `packages/contracts`, a scoped tool registry, bounded validation repair/fallback, worker settings, and persisted telemetry. Classic and Flow use the same router implementation and `goal_router` worker model. The Memory Router remains the same shared agent in both views and runs only after goal binding.

Flow routing orchestration was extracted from `apps/server/src/v2/runtime.ts` into `goalRoutingCoordinator.ts`, keeping the runtime below 1,000 lines. New goal-search, Classic routing, and latency-eval modules are focused files. The pre-existing `V2FlowStore` remains migration debt; Phase 2 adds focused methods without creating a parallel store or duplicate state authority.

## Latency Measurement

`pnpm eval:router-latency` reads the configured worker selections and runs the two routers sequentially without writing app state. The recorded three-round direct-provider fast-path result for `deepseek-v4-flash` was:

- Goal Router median: 1.971 seconds.
- Memory Router median: 6.832 seconds.
- Sequential median: 8.602 seconds.
- Sequential range: 8.401 to 9.171 seconds.
- `goal_search` calls: zero in all three fast-path samples.
- Ordering: Memory Router started only after Goal Router completion in every sample.

The measurement excludes prefetch, memory-document reads, the main Socrates turn, and UI/network transport. The exact sanitized result is stored in `evals/flow-convergence/phase-2-router-latency.json`.

## Promoted Gates

The Phase 0 convergence fixture now marks these Phase 2 scenarios passing:

- `short-followup-preserves-meaning`
- `completion-does-not-deselect-goal`
- `meaningful-followup-reopens-same-goal`
- `related-new-goal-has-transition-context`

Focused coverage lives in the Goal Router, Memory Router, SocratesAgent, Flow store, Flow runtime, Classic server, contracts, and frontend reducer suites.
