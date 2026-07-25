# Flow Convergence Phase 0 Baseline

Phase 0 freezes the current execution and persistence topology before the convergence refactor begins. It does not change production routing, finalization, persistence, or UI behavior. Its purpose is to turn the July 25 failure into reproducible evidence and to make the later migration measurable.

The product destination remains `FLOW_NORTH_STAR.md`. This file describes the starting line, not an alternate design.

## Exit Criteria

Phase 0 is complete only when:

1. The current model-driven runtime paths and every Classic/Flow pre-turn and post-turn routing pass are inventoried.
2. The observed malformed-tool and malformed-final-answer sequence is represented in a versioned regression fixture.
3. Every North Star behavior implicated by that sequence has a named target gate with an owning implementation phase.
4. The shared structured runner has isolated tests for malformed native tool input recovery and bounded structured-output repair.
5. A repository command validates the fixture, the target-gate coverage, and the current source anchors without calling a model or touching application data.
6. Focused tests, typecheck, and the Phase 0 gate pass on the convergence branch.

## Current Turn Topology

### Classic

```text
user-selected conversation
  -> Memory Router pre-turn
       -> memory readTargets
       -> Classic goalRoute
  -> main SocratesAgent tool loop
  -> Memory Router post-turn
       -> .socrates reconciliation plans
       -> goalFinalization
  -> main SocratesAgent final model step
  -> persist/publish answer
```

Classic therefore has two logical router executions: Memory Router pre-turn and Memory Router post-turn. Goal selection is a structured field of the pre-turn Memory Router result rather than a separate Classic Goal Router process.

### Flow

```text
unscoped user request
  -> Flow Goal Router pre-turn
  -> Memory Router pre-turn
       -> memory readTargets
       -> no second Flow goal decision
  -> main SocratesAgent tool loop with focus_ledger
  -> Memory Router post-turn
       -> .socrates reconciliation plans
       -> goalFinalization
  -> main SocratesAgent final model step
  -> persist/publish answer
```

Flow therefore has three logical router executions: Flow Goal Router pre-turn, Memory Router pre-turn, and Memory Router post-turn.

The Flow Goal Router currently receives the latest user message, at most three truncated recent exchanges, one current candidate, and at most five total goal candidates. The runtime may add semantically retrieved goal ids to that bounded candidate set, but the Goal Router's own registry is empty: it cannot invoke goal search during its run.

## Current Model-Driven Execution Inventory

| Capability | Prompt ownership | Current execution path | Tools |
|---|---|---|---|
| Classic and Flow main Socrates | `prompts/socratesPrompt.ts` | `SocratesAgent` | Default registry; Flow adds `focus_ledger` |
| Flow Goal Router | `prompts/goalRouterPrompt.ts` | `StructuredToolAgentRunner` | Empty registry |
| Memory Router pre/post | `prompts/memoryRoutingPrompt.ts` | `StructuredToolAgentRunner` | Pre: `memory_search`; post: `memory_search`, `turn_evidence` |
| Title Generator | `prompts/titleGeneratorPrompt.ts` | `StructuredToolAgentRunner` | Empty registry |
| Context Compressor | compressor prompt modules | `StructuredToolAgentRunner` | Empty registry |
| Global Memory Agent | `prompts/memoryPrompt.ts` | `StructuredToolAgentRunner` | Scoped memory-agent registry |
| Skill Writer | `prompts/skillWriterPrompt.ts` | `SocratesAgent` | Scoped skill-writer registry |
| Soul confirmation classifier | inline prompt in `memoryStore.ts` | direct provider stream | None |

This is not yet homogeneous. `SocratesAgent` and `StructuredToolAgentRunner` each own a provider/tool loop, while soul confirmation bypasses both. Phase 1 must converge these paths under the one public `AgentRuntime` contract without weakening their distinct permissions or output modes.

## Current Completion Authorities

Flow currently has two ways to mutate goal completion:

1. The main model can call `focus_ledger operation=complete_current`. The store stages this completion and commits it when the turn is completed.
2. The post-turn Memory Router can return `goalFinalization`; `SocratesAgent` applies it before the final reconciliation instruction and before the final visible answer is generated.

Classic uses the second path through its canonical goal link. This means the detached post-turn model is presently an answer-state authority, and the same Flow turn can expose overlapping completion judgments.

The store also currently couples status and selection: finalizing the selected work goal to a non-foreground state promotes General Conversation and changes the Flow foreground id. This is the direct cause of a completed historical exchange displaying General Conversation rather than its own focus.

## July 25 Failure Characterization

The reproduced Flow turn made 37 tool calls. Three native tool calls were schema-invalid:

- `trace_retrieve` was called with `{}`.
- Two `search` calls included unsupported `contextLines` input.

The native tool pipeline correctly persisted these calls as failed with `invalid_tool_input`, returned recovery feedback to the model, and continued the turn. The runtime did not terminate because the confirmed-error cutoff is ten.

The terminal failure was different. During a no-tools final step, the provider emitted a textual DSML-like tool envelope as ordinary answer text. Because the current main loop has no final-answer integrity schema or envelope rejection gate, that text was accepted and persisted as the assistant answer. The next short message, `what????`, was then routed with a compact recent-exchange representation containing that malformed text. The model inferred an "internal runtime dump" explanation from the visible DSML-like content and subsequent turns inherited that invented interpretation.

So the system both saw prior context and failed to preserve its meaning: it received a lossy/truncated exchange whose assistant side was already corrupt, then treated that corrupt output as conversational truth.

## Versioned Phase 0 Assets

- `evals/flow-convergence/phase-0-baseline.json` records current runtime anchors and the exact target scenarios.
- `evals/flow-convergence/phase-0-baseline.schema.json` defines the fixture contract.
- `evals/flow-convergence/phase-0-report.md` records the completed verification evidence.
- `scripts/check-flow-convergence-phase0.mjs` validates fixture completeness and confirms that the documented current-state anchors still exist.
- `packages/core/src/test/StructuredToolAgentRunner.test.ts` characterizes the shared structured worker's bounded recovery behavior independently of any one router prompt.

Run the deterministic Phase 0 gate with:

```bash
pnpm eval:flow-convergence:phase0
```

## Target-Gate Promotion Rule

Phase 0 target gates are intentionally marked `pending`; this branch does not pretend the North Star behavior already works. Each later phase must promote the gates it owns into executable production-path tests before changing the fixture status to `passing`.

No target gate may be removed because an implementation approach changes. Rename or split it only when the same user-visible invariant remains explicitly covered.
