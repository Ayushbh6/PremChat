# Phase 6 Structural And Real Acceptance

Date: 2026-07-26
Branch: `codex/flow-convergence`

## Isolation

The browser/product run used `/tmp/socrates-phase6-browser-home-bU4Nkk` as `SOCRATES_HOME`, its own SQLite database, and `/tmp/socrates-phase6-browser-workspace-TjDHFn` as the attached workspace. The provider-only run used a separate `mktemp` Socrates home. Neither run opened or mutated the normal application database, the repository's `.socrates/`, or the user's `~/.Socrates/` state. Existing OpenRouter credentials were resolved through the normal credential path and were not copied into fixtures or logs.

## Live OpenRouter DeepSeek Gate

`pnpm eval:flow-convergence:phase6-provider` ran the production shared `AgentRuntime` and `SocratesAgent` with OpenRouter `deepseek/deepseek-v4-flash`.

```json
{
  "malformedToolRecovery": {
    "toolCalls": 2,
    "firstErrorCode": "invalid_tool_input",
    "observedTimeZone": "Europe/Vienna"
  },
  "finalAnswerIntegrity": {
    "modelCalls": 3,
    "answerDeltaCount": 0,
    "markerPresent": true,
    "finalState": "completed"
  }
}
```

The first model tool call deliberately supplied an unsupported property, received the real production validation error, and retried the same tool with valid empty input. The strict main-Socrates final preserved its integrity marker and emitted no provisional answer delta.

## Real Browser Matrix

The actual Classic and Seamless routes ran against the disposable backend on `127.0.0.1:4326` and Next frontend on `127.0.0.1:3326`. Classic used OpenRouter DeepSeek V4 Flash for its first task; later Classic/Flow turns used the product's OpenRouter DeepSeek V4 Pro selection.

1. Classic completed a real DeepSeek turn, then continued with the literal follow-up `What?` in the same goal.
2. **Continue in Flow View** projected the idle Classic conversation and its exact current exchange.
3. A Classic follow-up switched into Flow while still running; Flow displayed the same canonical active task.
4. A Flow message recovered `PHASE6-CLASSIC-ALPHA` from projected Classic history.
5. A Flow-origin README inspection switched into Classic while the Flow turn was active.
6. Selecting that Flow-origin work later created its Classic home lazily and rendered the source messages/tools without replacement Q&A.
7. Completing `Inspect README.md` left it selected with `Current focus · completed`.
8. SQLite contained exactly one physical user message whose content was exactly `What?`, and exactly one canonical message identity for it.
9. The integration fixture created 500 goals and 500 canonical tasks while snapshots, router candidates, and pages stayed bounded to 25.
10. The live provider gate traversed malformed tool input and recovery.
11. Both the provider gate and browser turns withheld provisional assistant text until strict finalization.
12. Shared current-goal trace retrieval returned four identical README results from Classic and Flow presentation scopes, with no model-facing `turnId`; completed canonical tasks retained reconciliation watermarks.

## Defect Found And Closed

The first running Classic-to-Flow attempt exposed `UNIQUE constraint failed: v2_goals.flow_id`. Presentation selection could point at a parked goal while another row remained lifecycle-foreground; `updateFocus` trusted the selection pointer and attempted to promote the parked row without first demoting the actual foreground row. The fix now resolves the real `status = 'foreground'` row inside the transaction. A store regression reproduces the selected-parked state before applying a Classic route.

The same run also showed that a projected Classic task could complete durably while Flow remained visually busy because the completion event was published on the Classic socket. While an external canonical turn is active, the Flow hook now performs a bounded 1.5-second canonical projection refresh. The browser rerun showed `PHASE6-POLL-OK` and cleared the live state without reload.

## Persistence And UI Evidence

```text
Classic physical messages:     9
Flow physical messages:        6
Canonical message references: 15
Legacy message links:           0
bridge_import turns:            0
Canonical tasks:                8
Classic task projections:       8
Classic homes:                  2
Persisted model cost:   $0.156608
```

A fresh final browser session had zero console errors and zero warnings. Local ignored screenshot: `output/playwright/phase6-completed-selected.png`.
