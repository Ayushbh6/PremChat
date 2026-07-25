# Phase 3 Real Model And Browser Verification

Date: 2026-07-25
Branch: `codex/flow-convergence`

## Isolation

The run used a disposable Socrates home, SQLite database, and workspace under `/tmp`, with backend `127.0.0.1:4317` and production Next frontend `127.0.0.1:3317`. It did not read or mutate the normal application database, repo-local `.socrates/`, or global `~/.Socrates/` memory surfaces. The configured provider credentials were consumed through the normal environment-backed credential resolver; no secret value was printed or copied.

## Real DeepSeek Sequence

1. A Flow-origin request stored `CANONICAL-BLUE-7319`. OpenRouter DeepSeek V4 Pro completed ordinary generation but returned an unparsable strict final result. The integrity gate correctly failed the turn and persisted no malformed assistant answer.
2. A direct DeepSeek V4 Pro continuation stored `CANONICAL-GREEN-8420` and correctly answered with both BLUE and GREEN tokens, proving that the routed goal context retained the immediately preceding source request.
3. **Open in Classic** lazily created one Classic home. The browser displayed the same Flow-origin source messages, including the failed task state and the validated DeepSeek answer.
4. A direct DeepSeek Classic follow-up initially exposed the shared provider-level structured-output repair gap. `AgentRuntime` was updated so its existing bounded repair budget also covers known provider parse failures; an isolated runner test exercises that exact failure/retry path.
5. After rebuilding and restarting the disposable server, a direct DeepSeek Classic retry answered `CANONICAL-GREEN-8420` from projected Flow history.
6. **Continue in Flow View** returned to the same goal. Classic and Flow HTTP reads produced byte-for-byte equal projected message arrays and identical physical ids.

## Persistence Evidence

At the final round-trip boundary:

```text
projected messages in Classic: 6
projected messages in Flow:    6
arrays exactly equal:          yes
physical Classic messages:     3
physical Flow messages:        3
bridge_import Flow messages:   0
new legacy message links:      0
canonical tasks:               4
canonical message identities:  6
Classic task projections:      4
```

The physical counts sum to the six projected messages. No replacement message exists on the opposite runtime.

## Browser And Cost Evidence

- Production server and Next builds served the actual Classic and Flow pages.
- The Flow to Classic to Flow controls navigated successfully.
- The final browser console contained zero errors and zero warnings.
- Screenshot: `output/playwright/phase3-canonical-flow-roundtrip.png` (local ignored verification artifact).
- Total persisted model cost for the disposable run, including intentional failed-provider characterization: `$0.029918`.

This run verifies the Phase 3 persistence and projection boundary with real DeepSeek behavior. It also confirms that malformed provider finals remain fail-closed while the shared runner gets one bounded recovery attempt.
