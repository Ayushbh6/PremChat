# Phase 4 Real Provider And Browser Evidence

Date: 2026-07-26

This run used a disposable `SOCRATES_HOME`, SQLite database, workspace, backend on `127.0.0.1:4318`, and web app on `127.0.0.1:3318`. It did not read or mutate the normal Socrates database. The main model was OpenRouter `deepseek/deepseek-v4-pro` with thinking disabled. Existing task-relevant credentials were used through the normal environment and were not copied into the fixture or logs.

## Product Path

The browser exercised the actual `/seamless/projects/:projectId` product path at desktop and 390 by 844 mobile sizes:

1. Opened Projects, advanced into the current project's Goals, and opened General Conversation's Queries.
2. Sent an initial repository question. During a four-tool DeepSeek turn, the DOM contained exactly one live stage and one `[data-flow-live-activity]` node. Sampled labels included `Finding the right focus…`, `Reviewing the available context…`, and `Thinking through the result…`; each replaced the prior label.
3. Verified that no provisional assistant answer appeared during work. After durable completion, the live nodes were gone, the answer was visible, and execution appeared as one collapsed `Ran 4 tools` disclosure.
4. Sent `What did you find?` on mobile. The three-tool answer continued the actual prior work and did not expose an internal model dump.
5. Selected current and historical query rows and verified that each displayed its own saved request, answer, task, and focus.
6. Sent an explicit new-goal request, producing a separate work goal and a five-tool DeepSeek answer.
7. Completed that planning goal in a one-tool turn. The Current Focus card retained the completed goal rather than reverting to General Conversation.
8. Selected General Conversation and then the completed goal. Both were view-only operations: persisted states remained `parked` and `completed`, respectively, and neither selection reopened work.
9. Opened the completed goal in Classic. Its preferred Classic home was lazily created and showed the same two canonical Q&A pairs and tool disclosures. Continue in Flow returned to the same goal.
10. Verified no horizontal overflow at 1440px or 390px and exercised `prefers-reduced-motion: reduce`.

The final browser console contained zero errors and zero warnings.

## Persisted Evidence

The disposable database contained:

```text
goals:              2
turns:              5
activity events:   29
Classic homes:      1
model cost: $0.099340
```

The final goal ledger contained General Conversation as parked with three queries and the work goal as completed with two queries. Selecting either goal did not alter those lifecycle states.

## Reliability Finding And Fix

The first explicit goal-creation attempt exposed repeated eight-second Goal Router timeouts on the configured bounded worker model. The persisted deterministic fallback then continued General Conversation even though the user had issued an explicit create-goal command. Phase 4 added a narrow explicit-control fallback and a provider-failure test. After rebuilding and restarting the isolated stack, the same product flow created the new goal correctly.

This is bounded real-provider evidence for the Phase 4 interaction contract. It is not a release qualification, a full accessibility audit, a cross-platform runtime archive test, or an extended soak.
