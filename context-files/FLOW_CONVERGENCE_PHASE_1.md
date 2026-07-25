# Flow Convergence Phase 1

Phase 1 establishes one model-execution boundary and one answer-owned finalization contract for Classic and Flow. It does not implement Phase 2 goal routing/context changes, Phase 3 canonical cross-view persistence, or Phase 4 Flow UI work.

## Implemented Boundary

Every production model call in `packages/core` and the server-owned Global Memory Agent path now enters through `packages/core/src/agent/AgentRuntime.ts`. The removed `StructuredToolAgentRunner` is not retained as a wrapper or fallback. The shared runtime supports three explicit invocation shapes:

- model-step streaming for the interactive Socrates lifecycle;
- bounded text completion;
- bounded strict structured completion with scoped tools and one validation repair.

The Goal Router, both Memory Router phases, Title Generator, Compressor, Global Memory Agent, soul confirmation, Skill Writer, and main Classic/Flow Socrates paths all use this boundary. Soul confirmation is now a named no-tool `SoulConfirmationAgent` with its prompt in `packages/core/src/prompts/` and its strict shared contract in `packages/contracts`.

`SocratesAgent` remains the interactive policy owner, not a second provider runner. Its internal responsibilities are split into focused modules for turn lifecycle/tool execution, memory support, ledgers, tool-result normalization, and async event buffering. `SocratesAgent.ts` is below 1,000 lines and no extracted Phase 1 module exceeds 600 lines.

## Final Answer And Goal State

After all tool work and required `.socrates` reconciliation, the main Socrates model receives a hard final checkpoint and must return the strict shared `SocratesFinalAnswer` contract:

```text
finalAnswer
goalFinalization.state
goalFinalization.note
```

The integrity schema rejects empty answers and plaintext internal/tool envelopes such as DSML tool-call markup. One bounded repair is allowed. Provisional answer deltas are withheld in structured-final mode, so rejected drafts never stream to the UI.

The post-evidence Memory Router remains the bounded reconciliation planner but always returns `goalFinalization: null`. It is no longer an answer-state authority. Classic and Flow capture the validated `agent.final_result`, persist its visible answer, and apply its goal finalization in the same SQLite transaction. If answer validation or goal finalization fails, the answer/goal commit does not partially succeed.

The existing Phase 2 behavior that changes selection to General Conversation after completing the foreground goal is intentionally unchanged here. Phase 2 owns separation of goal status from selected focus, continuation/reopen routing, and transition context.

## Promoted Gates

The Phase 0 fixture now marks these Phase 1 scenarios passing:

- `native-invalid-tool-input-recovers`
- `plaintext-tool-envelope-is-not-an-answer`

Executable coverage is owned by:

- `packages/core/src/test/AgentRuntime.test.ts`
- `packages/core/src/test/SocratesFinalAnswer.test.ts`
- `apps/server/src/test/classicTurnFinalization.test.ts`
- `apps/server/src/test/v2FlowRuntime.test.ts`
- `apps/server/src/test/v2FlowFinalization.test.ts`

The remaining fixture scenarios stay pending for their assigned later phases.

## Verification

The completed phase passes the repository-wide gates:

- `pnpm typecheck`
- `pnpm test` — 574 tests passed and one provider test remained intentionally skipped
- `pnpm build`
- `pnpm eval:flow-convergence:phase0` — nine anchors validated, with the two Phase 1 scenarios passing and the six later-phase scenarios still pending
- `git diff --check`

The production source audit also confirms that direct `provider.stream(...)` and `provider.generateStructured(...)` execution is owned by `AgentRuntime`; there is no retained compatibility runner or parallel provider workflow.
