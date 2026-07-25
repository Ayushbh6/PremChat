# Flow Convergence Gates

This directory turns `context-files/FLOW_NORTH_STAR.md` into staged, versioned regression cases.

Phase 0 records both observed behavior and target invariants. `pending` means the invariant is known to be unmet and is assigned to a later phase; it is not a skipped claim that the product already works. Later phases must add the production-path test named by `futureTestSurface` before marking a case `passing`.

The deterministic baseline check does not call a model, start the app, or touch Socrates runtime data:

```bash
pnpm eval:flow-convergence:phase0
```
