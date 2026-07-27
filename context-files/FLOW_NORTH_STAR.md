# Socrates Flow North Star

This document is the product-intent authority for the target Socrates experience. `UNIFIED_SOCRATES_LIFECYCLE.md` defines the detailed technical lifecycle, `AGENT_REFACTOR_MANIFESTO.md` defines the agent-core replacement architecture, and `AGENT_CAPABILITY_WORKFLOW.md` defines the mandatory change procedure. `V2_FLOW_ARCHITECTURE.md`, `FLOW_CONVERGENCE_PHASE_*.md`, and the released Classic/project-first implementation remain migration evidence; they do not override this target.

## User Promise

The user opens one Socrates and starts talking. They do not first create a project, choose a conversation, manage a context window, or decide whether a request belongs to an old thread.

The product should feel like:

> Hey Soc, what is happening with my mail today, and then let us catch up on AI DPA.

Socrates remembers the user, resolves the authorized resources and earlier work, preserves the right goal continuity, and begins useful work. The user may inspect and correct the organization, but does not have to operate it.

`Socrates remembers everything` means everything the user entrusts to it remains exact, attributable, searchable, retrievable across authorized scopes, and deletable by the user. A model context is only a temporary projection over that memory; it is never the canonical memory itself.

## One Global Socrates

The target product has one primary seamless experience rather than separate project and conversation entry points.

```text
Landing page
  -> Open
  -> Seamless Socrates
```

The header contains only the minimal global controls:

```text
Paths | Access: Selected or Full | Settings
```

- `Paths` manages the folders Socrates may use.
- `Access` visibly switches between selected paths and explicit full-laptop filesystem access, with one-click revocation.
- `Settings` opens models, providers, memory, connections, voice, appearance, privacy, and other user-level preferences.
- Full filesystem access does not bypass approval, credential, destructive-action, purchase, message-send, or external-side-effect policies.

Projects may remain as migration metadata or internal resource/index scopes while released data is preserved. They are not a required user-facing navigation concept in the target product. A path, account, app connection, or other resource is an authorized capability scope; a goal is the unit of meaningful work.

## Goal-Centric Sidebar

The left sidebar is collapsible and organized by goals, not projects or conversations.

```text
Current goal
  exact Q&A pair
  exact Q&A pair

Earlier goal
  exact Q&A pair
```

The current goal opens first. Earlier goals remain searchable and expandable. Expanding a goal shows its exact user/assistant exchanges; a generated capsule never replaces the visible history.

The sidebar may group, search, pin, rename, or archive goals without changing the canonical messages inside them. The user may correct a mistaken grouping, but Socrates must normally organize work correctly without requiring that intervention.

## Canonical Product Concepts

### Goal

A goal is one coherent user outcome or work episode. It is broader than one user message and narrower than a permanent topic category.

Examples:

```text
Handle today's email
Improve the AI DPA backend
Plan the Vienna trip
Prepare the statistics presentation
```

### Task

Every user-authored request creates one task inside a goal. Many tasks normally belong to one goal.

```text
Goal: Handle today's email
  Task 1: Review today's inbox
  Task 2: Reply to Gary
  Task 3: Send the requested attachment
```

A changed verb, person, implementation step, test, or follow-up does not create a new goal when it advances the same coherent outcome.

### Exact Goal History

Every goal owns the canonical exact exchanges, tool evidence, approvals, artifacts, waits, and outcomes produced while working on it. Exact history is never overwritten by a capsule, index, or compaction.

### Goal Capsule

The current goal capsule is a small structured checkpoint of the goal's live working state. It contains the human goal title, objective, verified progress, current task, important decisions, blockers, open items, and exact source anchors needed to inspect the supporting record.

The capsule is not a transcript and is not a replacement for exact history. Capsule versions are saved as the goal changes. When exact older wording or evidence matters, Socrates retrieves the canonical source.

### Goal Ledger

The goal ledger is compact backend-owned structured state containing the goal list, current-goal pointer, titles, lifecycle state, and latest capsules. It does not store or duplicate transcripts, tool output, Terminal streams, files, patches, or other evidence.

The model never receives the whole ledger. It receives the current goal capsule automatically plus a small set of older goal capsules selected by hybrid retrieval for the latest query.

### Resource Scope

Paths, connected accounts, apps, and credentials define what Socrates is authorized to access. Resource scope and goal organization are independent: one goal may use several paths or connections, and one path may support many goals.

## The Simple Goal Decision

The semantic decision for a new user message has only four possible outcomes:

```text
current
retrieved older goal
new
clarify
```

There is no separate semantic distinction between `continue` and `resume`; selecting a goal is enough, and deterministic backend state knows whether its current pointer must change.

Socrates always sees the current goal capsule and latest exact exchange even when hybrid retrieval gives them a weak score. Retrieved older goal capsules appear afterward as numbered alternatives. The simple decision is:

```text
Does the new request belong to the current goal?
  yes -> current
  no  -> does it belong to a retrieved older goal?
           yes -> that goal
           no  -> new
           unclear -> clarify
```

Goal creation requires affirmative evidence of a genuinely independent outcome. A mediocre retrieval score, a different verb, a different named person, a completed task, or a new implementation phase is not enough.

## First Message And General Conversation

A greeting prefix never forces a concrete task into General Conversation.

```text
User: Hey Soc, what is up? Please check what is happening with my mail today.
```

If no work goal exists, Socrates creates `Handle today's email` and places the request there. General Conversation is reserved for conversation that has no concrete outcome, such as a greeting, light social exchange, or casual one-off answer.

The next message:

```text
User: Okay, let us reply to Gary then.
```

remains inside `Handle today's email` because the current capsule and latest exact exchange show that Gary was discovered during the email review. It creates another task, not another goal.

## Canonical Turn Lifecycle

Every user-authored turn follows one global sequence:

```text
persist the exact user message immediately
  -> retrieve goal candidates and memory candidates in parallel
  -> same-Socrates semantic goal resolution
  -> deterministic exact memory selection for the resolved goal
  -> one shared Socrates agent loop
  -> validated final result
  -> atomic answer, task, goal capsule, and current-goal commit
  -> publish the answer
  -> asynchronous memory enrichment
```

Hybrid retrieval is mechanical candidate discovery, not semantic authority. It combines lexical, semantic, entity, recency, source, and goal signals through one shared retrieval foundation. The active goal is always supplied independently of its search score.

The semantic goal decision belongs to Socrates itself through the shared runtime and shared prompt core. It is one minimal no-tool turn-resolution step, not a separate Goal Router personality, provider loop, tool-using agent, or independently evolving prompt harness.

Memory selection is deterministic after goal resolution. The parallel first-pass memory query includes the current capsule when available. If Socrates binds a different goal, or the first pass contains no eligible exact memory, the same retrieval service may run one targeted bound-goal query before deterministic reranking. There is no model-driven Memory Router in the critical path. The main Socrates may use the shared retrieval capability when deeper exact inspection is needed.

Asynchronous enrichment may index exact sources, refresh lossless derived goal and memory links, and curate durable memory through the shared agent architecture. It cannot update authoritative task/goal/capsule state, delay the visible turn, rewrite canonical messages, or become a second semantic authority over the completed work.

## Goal Switching And Restoration

When Socrates selects another goal:

```text
save the current capsule version
  -> move the current-goal pointer
  -> load the selected goal capsule
  -> attach its latest exact exchange
  -> select exact relevant memory/evidence
  -> continue through the same Socrates loop
```

The user experiences continuity because the capsule restores the live working state and exact history remains retrievable. Switching goals does not copy messages, invent a conversation, or start another Socrates.

## Exact Context And Consent

The ordinary model request includes:

1. The stable Socrates operating context and currently authorized capabilities.
2. The exact latest user message.
3. The resolved current goal capsule.
4. The latest exact exchange in that goal.
5. Deterministically selected exact memory and evidence relevant to the request.
6. The same tool, approval, Terminal, wait, continuation, and finalization behavior on every turn.

Exact goal history remains canonical even when it is not all attached to one provider request. Selection and exact pagination are lossless. If Socrates believes additional relevant exact content cannot fit a provider request, it must pause before dispatch and ask the user to approve the specifically described lossy operation. No automatic compactor may infer that permission.

Goal capsules and lossless indexes may guide retrieval, but they may not be presented as exact quotes or silently substitute for relevant exact source text.

## Execution Choreography

The visual thesis remains one calm workspace with the living Socrates orb as the active visual anchor.

During a live turn, the exact user query remains visible above the orb. One fixed-height activity sentence changes in place as typed execution state advances. It never accumulates into a vertical list of thoughts or raw tool envelopes. Approvals, credentials, Terminal input, and other user-action states remain full interactive components.

The final answer enters the reading layer only after its structured result passes validation and the atomic persistence transaction succeeds. The orb then recedes, the activity sentence disappears, and persisted reasoning/tool history becomes one collapsed expandable disclosure. The composer remains fixed.

## Semantic And Mechanical Ownership

Socrates owns semantic judgment:

- whether the latest request uses the current goal, an older goal, a new goal, or needs clarification;
- what work to perform;
- when evidence is sufficient;
- the substantive visible answer and verified goal progress.

Deterministic backend code owns mechanics:

- exact persistence;
- hybrid candidate retrieval and exact inspection;
- embeddings, indexes, and source filters;
- access scope, permissions, approvals, and credentials;
- candidate numbering and id resolution;
- validation, transactions, telemetry, and publication.

The backend never invents semantic meaning. Socrates never owns persistence ids, raw vector internals, or a mutable ledger tool.

## Success Criteria

The product reaches this North Star only when all of the following are true:

- Opening Socrates enters one seamless global workspace without creating or selecting a project.
- Paths, access mode, and settings are the only persistent header controls needed to begin.
- Concrete work following a greeting creates or selects a work goal rather than General Conversation.
- `Review today's email` followed by `reply to Gary` creates two tasks in one goal.
- `Inspect the Memory Agent`, `improve it`, and `test it` remain one coherent goal.
- The current goal and latest exact exchange are supplied on every turn regardless of retrieval score.
- Older goals are retrieved automatically and represented by a small set of human-readable capsules.
- The goal decision exposes only current, retrieved older goal, new, or clarify.
- There is no model-driven Memory Router or tool-using Goal Router in the critical path.
- Exact messages and answers remain canonical, visible, attributable, searchable, and deletable.
- Goal capsules restore working state without replacing exact goal history.
- The sidebar groups exact Q&A pairs by goal and contains no required project hierarchy.
- One agent runtime, capability catalog, tool contract, retrieval foundation, and finalization path serve every turn.
- The answer, task outcome, capsule update, and current-goal state commit atomically before publication.

## Migration Principle

Released Classic, project, V2 transport, namespaced persistence, bridge, and workspace records must remain safe and recoverable during migration. They are not permission to preserve the old user model indefinitely.

Migration must be non-destructive and explicit. Existing project/workspace metadata can become internal resource scopes; existing conversations and Flow queries can be attached to canonical goals; existing exact messages and evidence remain unchanged. New production authority must converge on one global Socrates, one goal-centric history, and one turn lifecycle. Old routers, project-first navigation authority, view-specific semantic state, and parallel context systems must be removed after the replacement is proven.
