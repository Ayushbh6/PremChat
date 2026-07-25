# Flow Convergence Phase 3

Phase 3 replaces Classic/Flow Q&A mirroring with canonical work identity and reference-based view projections. It preserves the Phase 1 shared execution/finalization path and the Phase 2 goal-routing order. It does not implement the Phase 4 Projects to Goals to Queries navigation or live-orb choreography.

## Canonical Ownership Model

Each task has exactly one physical runtime owner:

```text
work_tasks
  -> source_runtime: classic | v2_flow
  -> source_turn_id: the one physical turn

work_messages
  -> source_runtime
  -> source_message_id: the one physical message

conversation_task_projections
  -> Classic presentation reference to a canonical task
```

The source runtime remains authoritative for message bytes, attachments, lifecycle timestamps, tool results, and detailed execution records. The canonical tables contain identity and projection references, not replacement Q&A content. Flow reads every task attached to its goals; Classic reads the tasks projected into the selected conversation. Both APIs return the physical source message and tool-call ids.

## Navigation Semantics

- Flow-origin work creates no Classic conversation during ordinary execution.
- **Open in Classic** lazily creates or reuses a Classic home and projects the selected goal's canonical tasks into it.
- Classic-origin work keeps its existing conversation. **Continue in Flow** binds its physical turns to canonical goals and projects them into Flow without creating `bridge_import` turns or V2 message copies.
- Selecting either view does not transfer task ownership. One canonical active-task guard prevents a competing send through the other view.
- Active task and partial-answer state are projected for read/display purposes while the physical runtime continues to own execution.

## Legacy Reconciliation

Migration `0031_shocking_alex_power.sql` adds the canonical identity tables without deleting or rewriting released bridge data. Startup reconciliation is idempotent:

1. Inspect legacy message links to determine which side was the original source.
2. Bind one canonical task and its physical source messages.
3. Create Classic presentation references for existing homes.
4. Exclude legacy shadow copies from Classic, Flow, model-context, and canonical retrieval reads.

Legacy bridge/link/copy rows remain in SQLite as rollback evidence. New execution never inserts replacement Q&A or `bridge_import` turns.

## Shared State And Retrieval

Cross-view reads expose the same physical message ids, attachment references, active-task state, and tool-call ids/results. Goal-scoped model context is assembled from canonical task sources, so a continuation sees the same validated Q&A regardless of origin view. Canonical retrieval indexes each original source turn once and filters legacy shadows; a tombstoned Classic source that is still owned by a Flow goal remains indexable.

The existing runtime-specific detailed tables remain physical storage adapters during this migration. They are not competing semantic authorities: canonical work identity determines which row is authoritative and which view may project it.

## Deletion Rules

- Deleting a Flow task or goal deletes its one physical source and canonical references once.
- Deleting a projection-only Classic home removes that presentation metadata without touching Flow-owned source work.
- Deleting a Classic-origin conversation from Classic only detaches it from Classic and tombstones the conversation metadata while retaining its source rows for referenced Flow work.
- Deleting that shared work **everywhere** removes the physical source rows, canonical identities, projections, and derived retrieval state.

This avoids both orphaned Flow references and hidden duplicate runtime copies.

## Feature-Flag Boundary

`SocratesStore` constructs the canonical projection layer only when V2 Flow is enabled. With Flow disabled, Classic uses its original native message/model-context/turn behavior and does not interpret canonical projections.

## Promoted Gate And Verification

The Phase 0 `classic-flow-roundtrip-does-not-copy-qna` gate is now passing. Production-path tests cover:

- Flow to Classic message/model-context/tool projection with identical physical ids;
- Classic to Flow multi-goal projection without imported V2 turns;
- active-task visibility and second-writer rejection across views;
- non-destructive reconciliation of released copied bridge rows;
- Classic-only tombstone/detach versus explicit everywhere deletion;
- Flow-disabled Classic isolation;
- attachment projection, deletion, retrieval filtering, pagination, and restart idempotence.

Phase 4 may now build the new navigation and activity UI on these canonical read contracts rather than reconstructing state in the browser.

The bounded real-provider/browser evidence is recorded in `evals/flow-convergence/phase-3-real-e2e.md`. That run also promoted the shared structured runner's existing repair budget to cover known provider-level non-JSON/no-object failures, while preserving fail-closed answer integrity when the retry is exhausted.
