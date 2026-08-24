# Socrates Agent Harness

## Objective

Build a production coding-agent harness with:

- a small, stable model-facing tool surface;
- a long-running tool loop that can finish real tasks;
- model- and provider-independent core behavior;
- strong prompt caching;
- goal-scoped context and safe compaction;
- Skills and MCP tools loaded only when relevant;
- straightforward code with one implementation for each concern.

The target combines the focused core of OpenCode and Codex, DeepSeek's evidence that broad tools can support a capable loop, and Oh My Pi's separation between permanent and discoverable capabilities.

## The permanent tool surface

Socrates begins with exactly ten model-facing tools.

### Filesystem

#### 1. `read`

Read a file or a bounded section of a file.

```json
{
  "path": "string",
  "offset": "number | optional",
  "limit": "number | optional"
}
```

Directory discovery does not belong in `read`; use `glob`.

#### 2. `glob`

Find paths by filename or path pattern.

```json
{
  "pattern": "string",
  "path": "string | optional"
}
```

#### 3. `grep`

Search file contents.

```json
{
  "pattern": "string",
  "path": "string | optional",
  "glob": "string | optional"
}
```

`glob` and `grep` remain separate because path discovery and content search are simple, different operations used consistently across the reference harnesses.

### Editing

#### 4. `edit`

Perform a precise replacement in one existing file.

```json
{
  "path": "string",
  "old_text": "string",
  "new_text": "string",
  "replace_all": "boolean | optional"
}
```

The operation fails safely if `old_text` is absent or ambiguous unless `replace_all` is explicitly true.

#### 5. `apply_patch`

Apply a standard patch that can change, create, rename, or delete one or more files.

```text
*** Begin Patch
*** Update File: path/to/file
...
*** End Patch
```

There is no separate `write` tool initially. `edit` handles surgical changes and `apply_patch` handles file creation and larger edits. A dedicated `write` tool should be added only if evaluations show a real reliability problem with large new files.

### Execution

#### 6. `terminal`

Run a command in the selected project workspace.

```json
{
  "command": "string",
  "cwd": "string | optional",
  "timeout_ms": "number | optional"
}
```

The result is either a completed command result or a persistent `session_id` when the process is still running.

#### 7. `terminal_control`

Control a persistent terminal process.

```json
{
  "session_id": "string",
  "action": "poll | write | terminate",
  "input": "string | optional",
  "wait_ms": "number | optional"
}
```

- `poll` waits for more output or completion.
- `write` sends input to the process.
- `terminate` stops it.

Keeping execution and process control separate gives long-running commands a clear lifecycle without turning `terminal` into an oversized tool.

### Historical context

#### 8. `context_retrieve`

Search exact historical Q&A pairs or inspect the bounded execution evidence for one selected turn. The exact event store remains authoritative; this tool only creates a safe model-facing view of it.

Search input:

```json
{
  "action": "search",
  "query": "string",
  "match": "hybrid | exact | optional",
  "scope": "current_goal | project | optional",
  "top_n": "number | optional"
}
```

Search defaults and validation:

- `match` defaults to `hybrid`.
- `scope` defaults to `current_goal`.
- `top_n` defaults to `5` and cannot exceed `10`.
- `hybrid` combines semantic similarity, BM25 or equivalent keyword matching, and a small recency signal.
- `exact` performs literal text matching and never silently falls back to hybrid retrieval.
- Search covers exact user messages and visible Socrates responses. It returns Q&A pairs, not tool calls or tool results.

Search output:

```json
{
  "action": "search",
  "query": "my problems with German cases",
  "match": "hybrid",
  "scope": "current_goal",
  "results": [
    {
      "ref": "r1",
      "project_turn": 184,
      "date": "2026-08-12",
      "goal": "Ongoing German learning",
      "user_message": "I keep confusing accusative and dative after two-way prepositions.",
      "socrates_response": "The main problem is that you are deciding from the verb...",
      "complete": true,
      "omitted": null
    }
  ],
  "returned": 1,
  "more_matches": false
}
```

`complete: false` means that an unusually large Q&A pair was represented by an explicitly bounded preview. `omitted` then states how much content was withheld, while `ref` still resolves to the exact stored turn.

Inspection accepts exactly one human-facing selector:

```json
{
  "action": "inspect",
  "ref": "r1"
}
```

or:

```json
{
  "action": "inspect",
  "turn_number": 184
}
```

There is deliberately no inspection query in the initial v2 contract. Inspection is deterministic: it opens the selected search result, project turn, or evidence reference. The agent must use `search` to locate relevant Q&A before inspecting it.

Inspection output:

```json
{
  "action": "inspect",
  "turn": {
    "ref": "r1",
    "project_turn": 184,
    "date": "2026-08-12",
    "goal": "Memory system review"
  },
  "user_message": {
    "content": "Could the compaction fix lose tool results?",
    "complete": true,
    "omitted": null,
    "ref": null
  },
  "tool_activity": [
    {
      "ref": "e1",
      "tool": "terminal",
      "status": "completed",
      "input": "Run the focused memory tests",
      "output": "Relevant failures and final test summary...",
      "complete": false,
      "omitted": "485,300 estimated tokens omitted"
    }
  ],
  "final_response": {
    "content": "The affected compaction path can still lose...",
    "complete": true,
    "omitted": null,
    "ref": null
  },
  "bounded": true
}
```

Inspection exposes the exact user message, tool calls, tool results, and visible final response when they fit. It never exposes private model chain-of-thought. When any component is oversized, it returns a bounded execution view rather than dumping the full turn into the model context.

The backend enforces one aggregate output bound for both search and inspection. The returned model-facing content stops at whichever limit is reached first:

- `2,000` lines;
- `50 KiB` of UTF-8 text;
- `5%` of the selected model's context window; or
- the remaining safe tool-output allowance for the current model request.

The agent cannot request raw output, set its own token allowance, use offsets to reconstruct an unbounded dump, or disable truncation. For an oversized inspection, the backend prioritizes turn identity, the user message, the visible final response, a compact tool-call inventory, and bounded beginning-and-end excerpts. Every omission is explicit and receives a short evidence reference such as `e1`. Inspecting that reference is bounded again by the same policy, so repeated calls never unlock a single unrestricted dump.

The backend owns canonical goal, task, message, turn, and event identifiers. Model-facing search results use short run-scoped handles such as `r1`; nested evidence uses handles such as `e1`; and `project_turn` is a permanent chronological number that is never renumbered. Exactness comes from backend resolution, not from asking the model to copy opaque identifiers.

### Conditional capabilities

#### 9. `capability_search`

Search the lightweight catalog of installed Skills and MCP tools.

```json
{
  "query": "string",
  "kind": "any | skill | mcp | optional"
}
```

The catalog contains only names, types, short descriptions, tags, and connection availability. Full Skill instructions and complete MCP schemas are not placed in the base prompt.

The tool returns at most three ranked matches:

```json
{
  "matches": [
    {
      "name": "github.get_issue",
      "kind": "mcp",
      "description": "Read a GitHub issue"
    },
    {
      "name": "github_issue_workflow",
      "kind": "skill",
      "description": "Investigate an issue and compare it with a repository"
    }
  ]
}
```

Searching does not activate anything.

#### 10. `activate_capability`

Activate one exact result returned by `capability_search`.

```json
{
  "name": "string"
}
```

For a Skill, the harness loads its complete instructions into the current goal context. For an MCP tool, the harness connects to its server if necessary and appends that tool's real schema to the next model request.

Activated capabilities are scoped to the current goal. They are cleared when the user moves to another goal. The system may later prune an inactive capability from a very long goal, but it must never expose the entire installed catalog to the model.

## Corrective tool errors

Helpful, actionable tool errors are a high-priority harness-wide requirement. Every permanent tool and every dynamically activated MCP tool passes through the same normalized error boundary. Each individual tool defines its domain-specific error codes, while the harness guarantees one consistent model-facing shape:

```json
{
  "error": {
    "code": "turn_not_found",
    "message": "Project turn 184 does not exist.",
    "correction": "Use context_retrieve search, or inspect an existing project turn between 1 and 126.",
    "retryable": true
  }
}
```

Rules:

- Expected mistakes such as invalid parameters, missing files, ambiguous edits, unknown references, absent turns, expired terminal sessions, unavailable capabilities, and permission denials return a normal failed tool result in this shape. They do not crash the agent loop.
- `code` is stable and machine-readable; `message` explains the specific failure in plain language; `correction` gives the smallest safe next action; and `retryable` tells the agent whether another call can reasonably succeed.
- Corrections use human-facing paths, names, turn numbers, ranges, or short handles. They never require the model to reconstruct opaque backend identifiers.
- Errors must be truthful and bounded. A tool may show a few valid alternatives or a valid range, but it must not dump a large catalog, transcript, stack trace, or sensitive backend detail.
- Invalid calls have no side effects. A tool never reports partial work as success.
- Unexpected infrastructure failures remain distinguishable from correctable usage errors. They return a safe operational error and are logged with full internal diagnostics, but the model receives no secret values or raw stack trace.
- Provider-native MCP failures are normalized into this contract when possible without discarding the original provider error from the internal execution record.

This contract is implemented once in the shared tool runner and covered by contract tests for every tool. Tool-specific handlers supply facts and recovery hints; they do not invent separate error-envelope formats.

## Why there is no user-question tool yet

When the agent lacks information that only the user can provide, it asks a concise question as its normal assistant response and ends the current run. The next user message re-enters through the Goal Router and continues the same goal.

A structured question tool can be added later if the interface needs forms or multiple-choice interactions. It is not necessary for the initial coding loop.

## One agent loop

There is one foreground working agent. It continues until it produces a final response, needs user input, is cancelled, or reaches a configured safety limit.

```text
Send model the working context and available tool schemas
    ↓
Model returns either tool calls or a final response
    ↓
Validate every tool call
    ↓
Execute permitted calls
    ↓
Persist calls and results
    ↓
Append bounded results to the model context
    ↓
Repeat
```

The loop supports multiple tool calls in one model response when the provider supports them and the calls are independent. Mutating calls are serialized unless the harness can prove they do not conflict.

There is no separate planner agent, answer-writing agent, state-writing agent, or tool-selection agent in the initial architecture. The same Main Coding Agent returns its visible answer and a short hidden continuation note in one final result.

## Exact per-task lifecycle

1. Receive the user message.
2. Persist it exactly.
3. Run the Goal Router described in `Goal-router.md`.
4. Bind the task to the selected goal.
5. Assemble the working context for that goal.
6. Start the model/tool loop with the ten permanent tools.
7. Search and activate Skills or MCP tools only if the task needs them.
8. Continue until the model returns a final response or asks the user a question.
9. Require the final result to contain a visible answer and a short continuation note.
10. Persist both fields and all exact tool evidence.
11. Mechanically trim the next prompt only if its token budget is crossed; do not run a second model call.

## Working-agent context

The current user request must be the final block and must appear exactly once.

```text
<CURRENT_GOAL>
title: Memory system review
note: Reviewed compaction. The remaining concern is preserving large tool results.
</CURRENT_GOAL>

<EXACT_HISTORY_FOR_CURRENT_GOAL>
USER:
Can you review the memory system?

SOCRATES:
The current implementation compacts large tool results...
</EXACT_HISTORY_FOR_CURRENT_GOAL>

<RETRIEVED_SUPPORTING_CONTEXT>
Only exact repository or older-goal evidence required for this task.
</RETRIEVED_SUPPORTING_CONTEXT>

<ACTIVE_CAPABILITIES>
Only Skills and MCP tools activated for this goal.
</ACTIVE_CAPABILITIES>

<CURRENT_USER_MESSAGE>
Can you fix the information-loss problem?
</CURRENT_USER_MESSAGE>
```

There is no separate `latest exchange` field because it would duplicate the newest entry in exact history.

The exact-history allowance is token-based and configurable. Its initial value is the smaller of `20,000` tokens or `15%` of the selected model's context window. Complete recent Q&A pairs are preferred over arbitrary message slices.

## Compound tasks

A `compound` route creates one stored user task with multiple ordered work units.

The same Main Coding Agent runs them in order:

1. Assemble the selected goal context for part 1 and run its tool loop.
2. Save part 1's exact evidence and updated continuation note.
3. Assemble part 2's goal context, including only the evidence explicitly passed from part 1.
4. Run part 2's tool loop.
5. Return one visible answer covering both outcomes and save one continuation note for each affected goal.

The original user message is stored once and linked to every affected goal. Socrates does not duplicate the message or merge unrelated goal histories.

## Context and compaction

The persistent event log is the source of truth. The model prompt is a temporary working view.

The harness stores:

- exact user and assistant messages;
- tool calls and complete tool results;
- terminal session events;
- file mutations;
- goal bindings;
- the latest continuation note produced by the Main Coding Agent.

Large tool outputs may be replaced in the active prompt by a short result plus a retrievable reference, but the complete result remains stored.

When the working context approaches its configured threshold, the harness removes the oldest exact Q&A pairs from the next model prompt and relies on the already-written continuation note for continuity. It never rewrites or deletes the underlying event log. The newest complete exchanges and current user message remain verbatim.

The Main Coding Agent's final result is:

```text
VISIBLE ANSWER
The response shown to the user.

CONTINUATION NOTE
A short statement of the goal's verified progress, unresolved work, and important constraints.
```

The continuation note is not a second visible answer and is not produced by another agent.

## Provider independence

The harness owns one normalized internal contract:

- system and user messages;
- assistant text and reasoning metadata where available;
- JSON-Schema-compatible tool definitions;
- tool calls and tool results;
- streaming text and tool-call deltas;
- token usage;
- cancellation and provider errors.

Each provider adapter translates between this contract and its API. Goal routing, compaction, permissions, tool execution, and persistence never import provider-specific SDK types.

Provider-specific features are optional optimizations. The harness must still work when a model supports only ordinary messages and function calling.

## Prompt caching

The cacheable prefix remains stable:

1. core system prompt;
2. fixed behavioral rules;
3. the ten permanent tool schemas in a fixed order.

Goal notes, exact history, current user messages, and dynamically activated capabilities come afterward.

Further rules:

- Do not put timestamps, request identifiers, paths that change each turn, or capability catalogs in the stable prefix.
- Do not reorder permanent tools between calls.
- Append dynamic MCP tool schemas after the permanent tools.
- Keep full Skill instructions out of the prompt until activated.
- Preserve provider prompt-cache handles when the API supports them, without making the core depend on them.

## Safety and long-running work

- Filesystem tools resolve paths against the selected workspace and enforce the chosen access policy.
- Terminal commands use the same workspace and approval policy.
- Every mutating tool records its effect before the next model step.
- Terminal sessions persist independently of one HTTP request and can be polled after long waits.
- Cancellation propagates to model requests and tool execution.
- Step, time, and token limits are configurable safeguards, not a tiny fixed loop count.
- If a limit is reached, the harness saves the exact state and reports what remains instead of pretending the task completed.

## Initial exclusions

The first harness deliberately excludes:

- a dedicated `write` tool;
- a user-question tool;
- a planning or todo tool;
- subagents;
- a browser tool;
- a built-in web-search tool;
- always-visible GitHub or database tools;
- automatic skill creation;
- separate worker, planner, router-finalizer, or state-writer agents.

These can be introduced only after evaluations demonstrate a concrete need. Browser, web, GitHub, databases, and similar integrations should normally arrive through conditional capabilities rather than expanding the permanent surface.
