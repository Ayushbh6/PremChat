# Socrates Goal Router

## Purpose

Socrates presents one continuous project conversation to the user. Internally, it groups each user request into a goal so the working agent receives only the history relevant to the work it is doing.

The user never creates, names, opens, or closes chats. They simply keep speaking to Socrates.

The Goal Router has one job:

> Decide which goal owns the current user message before the working agent starts.

It does not answer the user, use tools, search the repository, update memory, or perform the task.

## Core terms

- **Project**: the repository or workspace selected by the user.
- **Flow**: the project's never-ending visible sequence of user requests and Socrates responses.
- **Task**: one user message and the work performed in response to it.
- **Goal**: one intended outcome that may contain several related tasks.
- **Continuation note**: a short description of where a goal currently stands and what matters next.
- **Exact history**: the original user messages, assistant responses, tool calls, and tool results stored without summarization.

Every user message creates a task. It creates a new goal only when it seeks a genuinely different outcome.

### Goal versus task

This distinction is mandatory and controls the granularity of routing:

- A **goal** is a durable desired outcome that may contain many pieces of work over days, months, or years.
- A **task** is one bounded piece of work that advances a goal.

For example:

```text
Goal: Ongoing German learning

Tasks within that goal:
- Create a 30-day learning plan.
- Complete the Day 1 lesson.
- Review dative prepositions.
- Complete the Day 10 lesson.
```

The router must not create `Day 10 German lesson` as a new goal when `Ongoing German learning` is already a plausible known goal. A new lesson, review, fix, test, file, or implementation step remains inside an existing goal when it advances that goal's durable outcome.

The router creates a new goal only when the desired outcome changes, not merely because the immediate activity, verb, deliverable, or day number changes.

## Non-negotiable rules

1. Goal routing happens once, before the working-agent loop.
2. There is no second router at the end of the task.
3. The current user message appears exactly once in the router request and is the final input block.
4. History is budgeted by tokens, not by a hardcoded number of Q&A pairs.
5. The router sees complete Q&A pairs wherever possible; a user message is never separated from its answer.
6. The router only selects a goal. It never writes goal progress, facts, files, capabilities, or task state.
7. Exact history remains in storage even after it is compacted out of the model prompt.
8. Internal goal identifiers are never shown to the model or the user. The router receives temporary labels such as `current` and `older_1`.
9. The Main Coding Agent returns the continuation note together with its visible answer. No additional state-writing model call runs afterward.

## Routing outcomes

The router must choose exactly one outcome:

### `continue_current`

The message continues, changes, tests, fixes, reviews, or follows up on the current goal.

Changing from review to implementation does not automatically create a new goal. For example, “review the memory system” followed by “fix the information-loss problem” remains one goal.

### `resume_existing`

The message clearly returns to a different known goal.

The user does not need to say “go back.” Natural references to the subject are sufficient. For example, after discussing the agent prompt, “Did that memory compaction fix preserve tool results?” can select the older memory-system goal.

### `create_new`

The message seeks an independent outcome that does not belong to the current or an older goal.

### `clarify`

Two or more goals are plausible and choosing the wrong one would materially change the work. The router returns one short clarification question. Socrates asks it as a normal assistant response; no special user-question tool is required.

### `compound`

One message contains multiple dependent work units that cannot honestly be assigned to one goal. The router splits the message without rewriting its meaning, assigns each part to an existing or new goal, and preserves their execution order.

This is for requests such as posting the completed work from one goal and then starting a new security review based on that work. It is not used merely because one goal contains several implementation steps.

## Exact router input

The router uses a fixed system prompt followed by one turn-specific input. The turn-specific input has this order:

```text
<RECENT_EXACT_PROJECT_HISTORY>
[goal=current]
USER:
Can you review the memory system in Socrates?

SOCRATES:
The current compaction path can lose details from large tool results...

[goal=older_1]
USER:
The agent prompt feels too complicated. Can you review it?

SOCRATES:
Yes. The core prompt currently mixes stable behavior with provider guidance...
</RECENT_EXACT_PROJECT_HISTORY>

<KNOWN_GOALS>
CURRENT
label: current
title: Memory system review
note: Reviewed compaction. The remaining concern is preserving large tool results.

OLDER
label: older_1
title: Agent prompt improvement
note: Simplify the core prompt and keep provider-specific guidance outside it.
</KNOWN_GOALS>

<CURRENT_USER_MESSAGE>
Did that compaction fix preserve tool results?
</CURRENT_USER_MESSAGE>
```

The current message is last so it is never buried between summaries and history. It is not repeated in a separate `latest exchange` field.

### The three sections are built independently

#### 1. `RECENT_EXACT_PROJECT_HISTORY`

This section is purely chronological. Starting immediately before the current user message, the harness walks backward through the project's exact Q&A trail and takes the newest complete pairs that fit within the history budget.

There is no semantic, vector, BM25, keyword, file, or topic filtering in this section.

Every included Q&A pair is tagged with the goal to which it was already bound. The tag uses a human-readable title or a temporary label created for this router request, never an internal database identifier. A tag records existing ownership; it does not influence candidate retrieval or make a new routing decision.

#### 2. `KNOWN_GOALS`

This section is assembled separately. It contains:

1. the current goal, always, when one exists; and
2. up to three older goal candidates found by hybrid retrieval over every saved goal title, continuation note, and lightweight anchor manifest.

Hybrid retrieval initially combines:

- semantic/vector similarity;
- BM25 or equivalent keyword matching; and
- a small recency boost; and
- a small boost for open, long-running goals whose scope plausibly contains the request.

Candidate retrieval is grounded in the exact current user message and the project's lightweight identity, such as its name and stated purpose. It searches goal titles, continuation notes, and anchor names, roles, and short summaries. It never injects full anchor files into the router request.

This matters for elliptical requests. In a project named `German`, the message `Okay, let's start today's lesson` should retrieve an open goal titled `Ongoing German learning` even when the last German lesson is outside the recent exact-history window. Its continuation note and an anchor summary such as `30-day-plan.md — curriculum and lesson sequence` provide additional evidence.

Appearing in recent exact history may improve a goal's recency signal, but it is neither required nor sufficient for selection. A goal outside the recent-history window can still be retrieved.

Retrieval only creates a shortlist. The Goal Router—not the retrieval system—decides whether the message continues the current goal, resumes a candidate, creates a new goal, needs clarification, or is compound.

The labels `older_1`, `older_2`, and `older_3` are temporary ranks for this request. A goal created 23 goals ago may still be labelled `older_1`; there is no `older_23` label.

#### 3. `CURRENT_USER_MESSAGE`

This is the exact current query. It appears once, after both context sections, and is always the final block read by the router.

### Recent-history token budget

The initial router-history budget is the smaller of:

- `20,000` tokens; or
- `15%` of the selected model's context window.

For example, a 128k model receives roughly 19k tokens of recent Q&A, while a 32k model receives roughly 4.8k.

The harness builds `RECENT_EXACT_PROJECT_HISTORY` as follows:

1. Start with the completed Q&A pair immediately preceding the current message.
2. Walk backward chronologically.
3. Add only complete pairs while they fit within the budget.
4. Present the selected pairs in normal oldest-to-newest reading order.
5. Never include the current user message inside recent history.
6. If the newest single exchange exceeds the entire budget, include a clearly marked bounded excerpt and retain the complete exchange in storage.

The formula scales automatically with the selected model's context window. The architecture must not encode “last three messages” or another fixed pair count.

## Router output

The router has no tools and returns strict structured data:

```json
{
  "decision": "continue_current | resume_existing | create_new | clarify | compound",
  "goal_label": "current | older_1 | null",
  "new_goal_title": "string | null",
  "clarification_question": "string | null",
  "parts": "array | null",
  "reason": "one short sentence"
}
```

Rules:

- `continue_current`: `goal_label` must be `current`.
- `resume_existing`: `goal_label` must be one supplied older label.
- `create_new`: `new_goal_title` is populated and the other route-specific fields are null.
- `clarify`: `clarification_question` is populated and the other route-specific fields are null.
- `compound`: `parts` is populated and the other route-specific fields are null. Every part contains its exact sub-request, order, goal decision, reason, and optional dependency.
- `reason` is always written by the Goal Router. It briefly explains why the selected goal owns the message or why a new goal or clarification is required. It is stored for inspection and evaluation; it is not normally shown to the user.

Example compound result:

```json
{
  "decision": "compound",
  "goal_label": null,
  "new_goal_title": null,
  "clarification_question": null,
  "reason": "The request contains an existing GitHub action followed by a distinct dependent security review.",
  "parts": [
    {
      "order": 1,
      "request": "Post the implementation summary and test results on GitHub issue #42.",
      "decision": "resume_existing",
      "goal_label": "older_1",
      "new_goal_title": null,
      "reason": "This action completes the known GitHub issue goal.",
      "depends_on": []
    },
    {
      "order": 2,
      "request": "Audit every API endpoint touched by that fix for authentication and authorization problems.",
      "decision": "create_new",
      "goal_label": null,
      "new_goal_title": "Security review of issue #42 API changes",
      "reason": "The security audit is a new durable outcome that depends on the GitHub fix.",
      "depends_on": [1]
    }
  ]
}
```

The backend validates this result. One repair attempt is allowed for invalid structure. If that also fails:

- with no existing goals, create the first goal;
- with one clearly current goal, continue it;
- otherwise ask the user which subject they mean.

## Long-running goal routing

A long-running goal remains one goal even when it contains hundreds of tasks and many rounds of context trimming. Goal identity follows the durable outcome, not the size of its history.

Consider a `German` project where the current goal is an unrelated file task but an older open goal is `Ongoing German learning`. The user says:

```text
Okay, let's start today's lesson.
```

Candidate retrieval uses the project identity, goal title and note, open-goal status, and the summary of the goal's `30-day-plan.md` anchor. It supplies the learning goal in `KNOWN_GOALS` even if the most recent German lesson is outside `RECENT_EXACT_PROJECT_HISTORY`:

```text
<KNOWN_GOALS>
CURRENT
label: current
title: Build German flashcard exporter
note: Export script implemented. CSV escaping still needs tests.

OLDER
label: older_1
title: Ongoing German learning
note: Covers German lessons and practice toward B1. Day 9 completed dative
      prepositions. Day 10 is next.
anchors:
- 30-day-plan.md — curriculum and lesson sequence
</KNOWN_GOALS>

<CURRENT_USER_MESSAGE>
Okay, let's start today's lesson.
</CURRENT_USER_MESSAGE>
```

The Goal Router itself returns:

```json
{
  "decision": "resume_existing",
  "goal_label": "older_1",
  "new_goal_title": null,
  "clarification_question": null,
  "parts": null,
  "reason": "Today's lesson is the next task within the ongoing German-learning goal."
}
```

The `reason` is generated by the Goal Router in the same structured result. It is not written by candidate retrieval, the backend, or another agent.

## Decision rules

The router reasons about the outcome, not keyword overlap alone.

- A greeting before a real request does not create a “General conversation” goal.
- A new verb does not necessarily mean a new goal: review, fix, test, and verify may be stages of one outcome.
- Mentioning a file used by another goal does not automatically resume that goal.
- A short message such as “fix it” normally continues the current goal because its meaning depends on the current exchange.
- A clear reference to an older subject resumes that goal even if the current goal is unfinished.
- A new lesson, work session, review, fix, test, or deliverable stays in a known goal when it advances that goal's durable outcome.
- A short or elliptical message such as “let's start today's lesson” must be interpreted against the project identity, known goal scopes, continuation notes, and anchor summaries before creating a goal.
- If a known goal can reasonably contain the request, prefer that goal. Do not create a narrower goal merely by restating the immediate task.
- `create_new` requires a genuinely different desired outcome. Mere uncertainty or weak wording is not evidence of a new goal.
- If one request contains an existing-goal action followed by a genuinely new dependent outcome, return `compound`.
- If the message asks for unrelated deliverables and their order or ownership is unclear, clarify before starting.

## Context assembly after goal selection

Router context and working-agent context are separate. The Goal Router receives project-wide evidence to select the owning goal. Only after the backend binds the task to that goal does it build the Main Coding Agent's focused context.

The working-agent input has this exact order:

```text
<CURRENT_GOAL>
title: Ongoing German learning
note: Covers German lessons and practice toward B1. Day 9 completed dative
      prepositions. Day 10 is next.
</CURRENT_GOAL>

<RECENT_EXACT_GOAL_HISTORY>
Newest complete Q&A pairs belonging specifically to this goal.
</RECENT_EXACT_GOAL_HISTORY>

<RETRIEVED_OLDER_GOAL_HISTORY>
Older exact exchanges or evidence from this goal that are particularly
relevant to the current request.
</RETRIEVED_OLDER_GOAL_HISTORY>

<RELEVANT_PROJECT_CONTEXT>
Relevant sections from goal anchors and dynamically retrieved project sources.
</RELEVANT_PROJECT_CONTEXT>

<CURRENT_USER_MESSAGE>
Okay, let's start today's lesson.
</CURRENT_USER_MESSAGE>
```

The current user message appears exactly once and remains the final block.

### `CURRENT_GOAL`

The backend supplies the selected goal's title and latest continuation note. The note is the short hidden field returned by the Main Coding Agent after the previous task in this goal. It records verified progress, unresolved work, important constraints, and what is likely to matter next.

The Goal Router never writes this note.

### `RECENT_EXACT_GOAL_HISTORY`

This is a mechanical chronological walk backward through complete Q&A pairs already bound to the selected goal. It does not include interleaved tasks from other goals and applies no semantic filtering.

Its initial budget is the smaller of `20,000` tokens or `15%` of the selected model's context window. The harness selects newest complete pairs that fit and presents them oldest to newest. Exact messages and tool evidence remain in persistent storage even when they no longer fit here.

### `RETRIEVED_OLDER_GOAL_HISTORY`

After excluding exchanges already present in recent exact goal history, the backend performs hybrid retrieval over older ledger entries belonging to the selected goal.

Every completed task contributes one immutable ledger entry containing:

- the continuation note returned by the Main Coding Agent;
- the goal binding;
- references to the exact Q&A pair and tool evidence; and
- automatically derived file, command, test, Skill, and MCP evidence.

Hybrid retrieval uses semantic similarity, BM25 or equivalent keyword matching, and recency. It first retrieves compact ledger entries, then expands only the exact source exchanges or evidence required for the current task. A summary is never treated as a replacement for its exact source.

This section is therefore different from recent exact goal history: recent history is chronological and guaranteed recent; retrieved older history is relevance-selected and explicitly excludes that recent window.

### `RELEVANT_PROJECT_CONTEXT`

This section combines two source classes without confusing them:

1. **Goal anchors** are durable sources that must always be considered for the goal.
2. **Dynamic project sources** are ordinary files or evidence retrieved because they are relevant to this specific task.

An anchor does not mean that the entire file is injected on every turn. The context builder always sees a small anchor manifest containing the path, role, status, and summary, then loads only the relevant sections. For Day 10, it may load the plan outline and Day 10 section rather than all of `30-day-plan.md`.

Dynamic sources are discovered through scoped file, keyword, semantic, and evidence retrieval. They are included only when relevant to the current request.

## Anchor lifecycle

The Goal Router does not promote files to anchors. The Main Coding Agent may return an optional anchor proposal together with its normal final result:

```text
VISIBLE ANSWER
The response shown to the user.

CONTINUATION NOTE
The goal's verified progress, unresolved work, constraints, and likely next step.

ANCHOR PROPOSALS
- path: learning/30-day-plan.md
  role: goal_plan
  reason: Defines the lesson sequence and expected progress for this goal.
```

The backend validates that the file exists, belongs to the goal, is not temporary or generated output, has a durable future-facing role, does not violate the anchor budget, and does not silently conflict with an existing anchor.

Anchor states are reversible:

```text
provisional → active → superseded
```

The enforcement policy is:

- Explicit user instruction makes the file an active anchor.
- A clearly central, non-conflicting agent proposal becomes provisional without interrupting the user.
- Repeated successful use or explicit user approval promotes it to active.
- Clearly temporary material remains dynamically retrievable.
- Unclear but inconsequential material remains dynamically retrievable; uncertainty alone does not justify a question.
- Socrates asks only when the decision is consequential, such as replacing an existing authority, choosing between competing canonical files, distinguishing a draft from a final source, or carrying sensitive material into future tasks.

Anti-annoyance rules are enforced by the backend rather than left to prompt judgment:

- At most one anchor question may appear in a completed task response.
- Anchor questions appear at the end of work and never interrupt safe progress.
- Multiple conflicts are combined into one question.
- A rejected file-and-role proposal is not asked again unless the file materially changes or the user reopens the decision.
- An ignored question defaults to dynamic retrieval.
- Non-conflicting provisional changes use a quiet, reversible notification rather than a question.

Anchors are goal-scoped context policy, not a new user-facing hierarchy. The product model remains `Project → Goals → Tasks/Q&A`.

## Who writes each piece of state

| State | Writer |
|---|---|
| Exact user message | Harness, immediately on receipt |
| Goal selection | Goal Router |
| Short routing reason | Goal Router, in the same routing result |
| Exact assistant messages | Harness |
| Tool calls and tool results | Harness |
| Files changed | Derived by the harness from tool execution |
| Active capabilities | Capability runtime, not the router |
| Visible answer | Main Coding Agent |
| Short continuation note | Main Coding Agent, in the same final result |
| Optional anchor proposal | Main Coding Agent, in the same final result |
| Anchor status | Backend policy, overridden by explicit user direction |

The Main Coding Agent does not maintain a large `saved_state` object. Its final result contains the visible answer, one short continuation note, and only when needed a small list of anchor proposals. The router does not generate facts, files, progress lists, anchor proposals, or active capabilities.

The backend automatically records files, commands, tests, tool results, MCP calls, and Skill activations from the execution log.

## Continuation note and context trimming

The continuation note is updated by the Main Coding Agent as part of the same final response:

```text
VISIBLE ANSWER
I added source references to compacted memory records and the focused tests pass.

CONTINUATION NOTE
Compaction provenance fix implemented. Recovery now validates source references.
Focused memory and compaction tests pass. Next concern is whether any compaction
path can still omit source material.
```

The user sees only the visible answer. The backend stores both fields.

When exact history exceeds the prompt budget, the harness performs mechanical trimming:

1. Keep the newest complete Q&A pairs that fit.
2. Use the already-saved continuation note to represent earlier progress.
3. Replace oversized tool results with bounded results and retrievable references.
4. Keep all original messages and tool events in persistent storage.

There is no extra router, summarizer, or state-writer call after the Main Coding Agent. Prompt trimming changes what the next model request sees, not what Socrates stores.

## Per-message lifecycle

```text
User message
    ↓
Persist exact message
    ↓
Build token-budgeted router input
    ↓
Goal Router chooses current / older / new / clarify / compound
    ↓
Bind the task to that goal
    ↓
Build the selected goal's working context
    ↓
Run the coding-agent loop
    ↓
Persist visible answer, continuation note, and tool evidence
    ↓
Trim the next prompt only if its token budget is crossed
```

This preserves the product illusion of one seamless conversation while giving every task a focused backend context.

## Q1-Q10 validation sequence

These ten natural user messages are the baseline routing test. They must be kept as an architecture fixture when the router is implemented.

1. “Hi, how are you?”
2. “Can you review the memory system in Socrates and explain how it currently works?”
3. “What is the biggest architectural weakness in it?”
4. “Fix that and run the relevant tests.”
5. “Does GitHub issue #42 still reproduce against the current code?”
6. “If it does, fix it and draft a concise update for the issue.”
7. “Could that memory fix lose information during compaction?”
8. “How far is our onboarding page from the latest Socrates design in Figma?”
9. “Bring it in line with the design, but keep our existing colour palette.”
10. “Post the implementation summary and test results on GitHub issue #42, then audit every API endpoint touched by that fix for authentication and authorization problems.”

Expected movement:

| Query | Router result | Selected goal |
|---|---|---|
| Q1 | `create_new` | General conversation |
| Q2 | `create_new` | Review Socrates memory system |
| Q3 | `continue_current` | Review Socrates memory system |
| Q4 | `continue_current` | Review Socrates memory system |
| Q5 | `create_new` | Investigate GitHub issue #42 |
| Q6 | `continue_current` | Investigate GitHub issue #42 |
| Q7 | `resume_existing` | Review Socrates memory system |
| Q8 | `create_new` | Align onboarding page with Figma |
| Q9 | `continue_current` | Align onboarding page with Figma |
| Q10 part 1 | `resume_existing` | Investigate GitHub issue #42 |
| Q10 part 2 | `create_new`, depends on part 1 | Security review of issue #42 API changes |

### Q1: first message

Router request:

```text
<RECENT_EXACT_PROJECT_HISTORY>
None
</RECENT_EXACT_PROJECT_HISTORY>

<KNOWN_GOALS>
None
</KNOWN_GOALS>

<CURRENT_USER_MESSAGE>
Hi, how are you?
</CURRENT_USER_MESSAGE>
```

Result: `create_new — General conversation`.

The Main Coding Agent answers normally and saves a continuation note such as `No technical work is active.`

### Q2-Q4: one goal moving from review to implementation

For Q2, Q1 is recent project history and General conversation is the current goal. The final block is:

```text
<CURRENT_USER_MESSAGE>
Can you review the memory system in Socrates and explain how it currently works?
</CURRENT_USER_MESSAGE>
```

The router creates `Review Socrates memory system`.

For Q3, the router sees the exact Q2 pair plus this current-goal note:

```text
Reviewed the memory system. Exact exchanges are stored separately from the
short continuation note. Goal selection determines which earlier information
is provided during later work.
```

The final block is:

```text
<CURRENT_USER_MESSAGE>
What is the biggest architectural weakness in it?
</CURRENT_USER_MESSAGE>
```

The router continues the current goal because “it” is resolved by the exact Q2 pair.

For Q4, the exact Q3 answer identifies the weakness and the final block is:

```text
<CURRENT_USER_MESSAGE>
Fix that and run the relevant tests.
</CURRENT_USER_MESSAGE>
```

The router continues the same goal. Review, fix, and test are stages of one intended outcome.

### Q5-Q6: GitHub issue goal

For Q5, the memory goal is current but the final message explicitly seeks a different outcome:

```text
<CURRENT_USER_MESSAGE>
Does GitHub issue #42 still reproduce against the current code?
</CURRENT_USER_MESSAGE>
```

The router creates `Investigate GitHub issue #42`. Goal routing does not load GitHub. Inside the working loop, the agent searches for and activates the necessary GitHub MCP tools.

For Q6, the current goal note says the bug reproduced and the latest exact goal pair identifies issue #42. Therefore:

```text
<CURRENT_USER_MESSAGE>
If it does, fix it and draft a concise update for the issue.
</CURRENT_USER_MESSAGE>
```

continues the GitHub goal without requiring the user to repeat its name.

### Q7: natural return to an older goal

The current goal is GitHub issue #42. Candidate retrieval supplies the older memory goal because its title and note match “memory” and “compaction.”

```text
<RECENT_EXACT_PROJECT_HISTORY>
Newest complete Q&A pairs fitting the model-aware token budget.
</RECENT_EXACT_PROJECT_HISTORY>

<KNOWN_GOALS>
CURRENT
label: current
title: Investigate GitHub issue #42
note: Terminal reconnect fix implemented. Tests pass. A concise issue update is drafted.

OLDER
label: older_1
title: Review Socrates memory system
note: Compaction provenance fix implemented. Recovery validates source references. Focused tests pass.
</KNOWN_GOALS>

<CURRENT_USER_MESSAGE>
Could that memory fix lose information during compaction?
</CURRENT_USER_MESSAGE>
```

Result: `resume_existing — older_1`. The Main Coding Agent then receives the memory goal's exact history, not the GitHub goal's history.

### Q8-Q9: Figma onboarding goal

Q8 creates `Align onboarding page with Figma`. The working agent—not the router—uses `capability_search` and `activate_capability` to obtain only the relevant Figma MCP tools.

Q9 continues that goal because “it” and “the design” are resolved by the exact Q8 pair. The requirement to preserve the existing colour palette is part of the exact current user message and later continuation note.

### Q10: compound request

The router sees the onboarding goal as current and retrieves the GitHub issue goal as an older candidate. The exact current message remains one final block:

```text
<CURRENT_USER_MESSAGE>
Post the implementation summary and test results on GitHub issue #42, then audit every API endpoint touched by that fix for authentication and authorization problems.
</CURRENT_USER_MESSAGE>
```

It returns two ordered parts:

1. Resume the GitHub issue goal and post the already-prepared summary and test results.
2. Create `Security review of issue #42 API changes`, depending on part 1, and pass only the relevant files, verified results, and exact supporting evidence from the GitHub goal.

The exact user message is stored once. The task has two ordered goal links; it is not duplicated in storage.
