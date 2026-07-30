# Global Socrates North Star

This document is the product-intent authority for the global Socrates experience. `UNIFIED_SOCRATES_LIFECYCLE.md` defines the detailed technical lifecycle, `AGENT_REFACTOR_MANIFESTO.md` defines the agent-core replacement architecture, and `AGENT_CAPABILITY_WORKFLOW.md` defines the mandatory change procedure. Legacy project/conversation records are migration evidence only and never override this target.

Implementation checkpoint (2026-07-30): the global UI shell and goal lifecycle are the accepted base, while persistence, resource knowledge, and access-policy convergence remain active implementation work. The production cutover first creates a verified whole-state archive of the released installation, then initializes a fresh compact canonical database. Only global identity, profile, accepted global rules, cross-project memory, user settings, selected roots, and global capabilities are carried forward. Released goals, projects, conversations, Flow records, messages, tools, Terminal history, and project-scoped memory/capabilities remain recoverable only in the archive and never enter the new active product.

## User Promise

The user opens one Socrates and starts talking. They do not first create a project, choose a conversation, manage a context window, or decide whether a request belongs to an old thread.

The product should feel like:

> Hey Soc, what is happening with my mail today, and then let us catch up on AI DPA.

Socrates remembers the user, resolves the authorized resources and earlier work, preserves the right goal continuity, and begins useful work. The user may inspect and correct the organization, but does not have to operate it.

`Socrates remembers everything` means everything the user entrusts to it remains exact, attributable, searchable, retrievable across authorized scopes, and deletable by the user. A model context is only a temporary projection over that memory; it is never the canonical memory itself.

## One Global Socrates

The target product has one primary seamless experience rather than separate project and conversation entry points.

```text
/welcome
  -> Open Socrates
  -> /chat
```

The header contains only the minimal global controls:

```text
Paths | Access: Read only, Selected, or Full | Settings
```

- `Paths` manages the folders Socrates may use.
- `Access` visibly switches among read-only work, selected paths, and explicit full-laptop filesystem access, with one-click revocation.
- `Settings` navigates to the existing full `/settings` surface rather than opening a chat-owned drawer. That surface keeps provider, global MCP, model, voice, and related settings and exposes the existing `/memory` Memory Center through a visible **Memory Agent** action. The Memory Center does not own or imply MCP tool access: only Main Socrates accepts dynamic MCP capabilities. Memory Agent may propose a reusable skill from exact evidence, but the separate Skill Writer performs an approved skill write.
- Access is an autonomy setting, not resource selection. Structured read/search is globally available in every mode, with selected and recent resources searched first. Selected roots mean only that structured writes inside those roots are approval-free; they never infer a project, bind a resource, inject rules, or limit retrieval.
- Read only and Selected require approval for each Terminal `run` or `start`; Terminal `inspect`, `list`, and `stop` remain automatic. Full makes ordinary structured mutations, Terminal launches, capability changes, and external side effects automatic. Credentials and clarifications remain typed user-input waits.
- Frontier handover always requires explicit approval in every access mode. Rejection removes Frontier for the rest of the current task.
- A small catastrophic set is hard denied in every mode. Terminal launches use enforceable native platform containment; command preflight remains explanatory defense in depth and is never described as containment. If containment cannot be established, automatic Full Terminal fails closed.

Projects may remain as migration metadata or internal resource/index scopes while released data is preserved. They are not a required user-facing navigation concept in the target product. A path, account, app connection, or other resource is an authorized capability scope; a goal is the unit of meaningful work.

## Goal-Centric Sidebar

The left sidebar is collapsible and uses two replacement pages organized by goals, not a nested tree and not projects or conversations.

```text
Goals page                  select goal       Exchanges page
Current goal             ---------------->   <- Goals
Earlier goal                                  exact Q&A pair
Completed goal                                exact Q&A pair
```

Opening the drawer always shows the flat goal list with the current goal first and searchable earlier/completed goals after it. Selecting a goal replaces the list with a flat page of that goal's exact user/assistant exchanges and task-owned work records; a fixed back control returns to goals. Goal rows never expand in place, and a generated capsule never replaces visible history. The new database begins with no goals; released work remains exact only in the verified cutover archive.

The sidebar may group, search, pin, rename, or archive goals without changing the canonical messages inside them. The user may correct a mistaken grouping, but Socrates must normally organize work correctly without requiring that intervention.

Selecting an earlier exchange is passive inspection. It changes only the displayed projection; it never moves the canonical current-goal pointer, reopens a completed goal, rebinds a task, or turns the inspected exchange into a new conversation. If the user submits while inspecting history, the UI returns to the canonical live tail and creates the new task there; the normal same-Socrates four-way decision then chooses current, a retrieved older goal, new, or clarify from authoritative context. The composer remains available while history is open so inspection does not become a dead end.

## Focused Global Canvas

`/chat` is one fixed-height viewport shell rather than a document page with visible header/footer bands:

```text
fixed seamless header: sidebar toggle                         Paths | Access | Settings
middle-only scroll region: one exact user query + current work or one saved answer
fixed composer: attachments, model/thinking, voice, send/stop
```

The header and composer remain in place while only the middle reading layer scrolls. The surfaces may use subtle background blending or translucency, but no decorative divider is required merely to prove that they are fixed. The canvas preserves enough bottom inset that long answers never disappear behind the composer. Narrow layouts keep the same hierarchy; panels and notes fold or overlay instead of shrinking the answer into an unusable column.

Exactly one exchange is displayed at a time. The current user request is right-aligned, width-capped, and presentation-collapsed behind **Show more** when long without changing its exact stored text. A new request replaces the previous exchange on the live canvas; older exact exchanges remain available only through their goal in the sidebar.

The living orb remains one persistent visual element across idle, routing, working, waiting, and settled states. During a live turn it becomes prominent and exactly one fixed-height human-facing activity sentence appears beneath it. New routing, memory gathering, capability lookup, thinking, tool, Terminal, wait, and finalization states replace that sentence in place; they never stack into a feed. The runtime supplies typed safe presentation state. The frontend may group parallel work into one sentence, but must not infer semantics from arbitrary provider text or show raw ids, secrets, malformed tool syntax, `undefined`, unrestricted hidden reasoning, or a counterfeit chain of thought.

Detailed provider-visible work, tools, and evidence appear in one collapsed disclosure that can be expanded while work proceeds and after completion. Approval, credential, Terminal-input, clarification, and other user-action states retain their full interactive controls and are never reduced to the one-line sentence. The final answer enters only after validation and atomic persistence; it then becomes the foreground reading layer while the same orb fades into a pale, quiet background and the live sentence clears. Transitions preserve layout, focus, screen-reader announcements, and `prefers-reduced-motion`.

Two lightweight movable poster notes remain visible above the canvas on desktop:

- **Live Work** shows a safe concise projection of recent meaningful Socrates activity, such as files read or edited, tools used, Terminal state, and verified central knowledge updates. It never exposes secret values or raw unbounded output.
- **Live Goal** shows the backend-authoritative current goal, current task, lifecycle state, and compact metadata. Inspecting history does not replace it with the historical exchange's label.

The notes may be dragged only from explicit handles, moved with keyboard controls, raised in a deterministic stack, clamped after viewport changes, and stored under one versioned global presentation key. Their coordinates, open state, and z-order are frontend presentation state only. The canvas exposes no reset-notes control. On narrow screens they become accessible folded tabs or panels instead of covering the exchange or composer.

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

The model never receives the whole ledger. It receives the current goal capsule automatically plus at most three older goal capsules selected by hybrid retrieval for the latest query.

### Resource Scope

Paths, connected accounts, apps, and credentials define authorization and autonomy only. A resource is a separate, explicitly confirmed durable identity with a human label, canonical-location history, availability, and optional repository fingerprint. Exact user-supplied existing paths may bind immediately; discovered candidates require confirmation. One goal may bind several resources and one resource may support many goals. Task bindings record the exact location used; goal bindings carry active resources forward. Selected roots never become resources automatically.

## The Simple Goal Decision

The semantic decision for a new user message has only four possible outcomes:

```text
current
retrieved older goal
new
clarify
```

Those four outcomes remain the only product semantics even if the provider transport uses one flat structured envelope for reliable generation. The backend validates and normalizes that envelope before any goal mutation.

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
  -> retrieve goal, memory, and capability candidates in parallel
  -> same-Socrates semantic goal resolution
  -> deterministic exact memory selection for the resolved goal
  -> one shared Socrates working loop
  -> normal tools, useful notes/memory, and in-loop reconciliation as needed
  -> the last continuation returns the validated structured final result
  -> atomic answer, task, goal capsule, and current-goal commit
  -> publish the answer
  -> asynchronous memory enrichment
```

Hybrid retrieval is mechanical candidate discovery, not semantic authority. It combines lexical, semantic, entity, recency, source, and goal signals through one shared retrieval foundation. The active goal is always supplied independently of its search score.

Capability retrieval supplies a compact set of semantically matched installed skills and MCP tools without dumping all capability metadata or schemas into the prompt. It never uses keyword-only prompt matching. Socrates may deepen a missed lookup through `read` and `search`; before claiming that no suitable installed capability exists, it must search `socrates://capabilities`. The always-visible `capability_manager` is not selected by retrieval: it is the single approval-gated mutation entrypoint for adding or changing skills and MCPs.

The semantic goal decision belongs to Socrates itself through the shared runtime and shared prompt core. It is one minimal no-tool turn-resolution step, not a separate Goal Router personality, provider loop, tool-using agent, or independently evolving prompt harness.

Memory selection is deterministic after goal resolution. The parallel first-pass memory query includes the current capsule when available. If Socrates binds a different goal, or the first pass contains no eligible exact memory, the same retrieval service may run one targeted bound-goal query before deterministic reranking. There is no model-driven Memory Router in the critical path. The main Socrates may use the shared retrieval capability when deeper exact inspection is needed.

Asynchronous enrichment may index exact sources, refresh lossless derived goal and memory links, and curate durable memory through the shared agent architecture. It cannot update authoritative task/goal/capsule state, delay the visible turn, rewrite canonical messages, or become a second semantic authority over the completed work.

After goal binding there is no draft phase, detached reconciliation phase, or separate final-formatting phase. Socrates works normally and reconciles important knowledge inside the same tool loop. If nothing worth preserving changed, it answers without ceremonial document work. If something important changed, it updates the correct working or durable surface with normal tools and then the last continuation of that same loop returns `answer + goal state + goal note`.

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

## Exact Context And Automatic Efficiency

The ordinary model request includes:

1. The stable Socrates operating context and currently authorized capabilities.
2. The exact latest user message.
3. The resolved current goal capsule.
4. The latest exact exchange in that goal.
5. Deterministically selected exact memory and evidence relevant to the request.
6. The same tool, approval, Terminal, wait, continuation, and finalization behavior on every turn.

Exact goal history remains canonical even when it is not all attached to one provider request. Selection and exact pagination are lossless. At 170k estimated model-visible tokens, one shared automatic compactor replaces the oldest completed-turn head with a provenance-linked hidden summary. If one active turn is itself oversized, it may additionally replace only that turn's oldest completed tool-exchange prefix, never a partial call/result group. The original request, pending operations, and newest tool-exchange suffix remain raw. It preserves approximately 70k of newest safe raw context when possible, targets a rebuilt request around 100k, and rejects a result above 120k. The stable canonical turn/task ordinals map internally to exact source ids and survive repeated compactions. Canonical history never changes, and the main model is not dispatched above the trigger if safe compaction fails.

Within a turn, each successful individual tool result over 3,000 estimated tokens receives the next `R<n>` handle and one compact reminder appended to that existing tool result. It is never a separate hidden message. Socrates may release an unneeded handle alongside its next normal tool call without another model round trip. Release affects only the current model-visible copy; exact evidence remains immutable and retrievable.

One shared final output guard prevents any static or dynamic capability from dumping an unbounded result into the model. Dynamic MCP output is stored exactly before projection, is capped at approximately 4,000 estimated tokens by default and 6,000 maximum, and exposes exact continuation/recovery through existing read and trace capabilities rather than another tool.

No runtime action ledger, synthetic user warning, memory-note ledger, Terminal-capability message, progress checkpoint, or final checkpoint may be injected into the model conversation. Backend mechanics remain silent unless a real tool result must report its own error or approved result-local notice. Every model-visible input category is declared, reviewable, and protected by an allowlist; new categories require explicit user approval.

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
- `/welcome` exposes one **Open Socrates** action and it enters `/chat`; `/seamless` is only a compatibility redirect into that same global shell.
- Paths, access mode, and settings are the only persistent header controls needed to begin.
- The header and composer stay fixed, only the middle reading layer scrolls, and exactly one current or deliberately selected historical exchange is visible.
- Concrete work following a greeting creates or selects a work goal rather than General Conversation.
- `Review today's email` followed by `reply to Gary` creates two tasks in one goal.
- `Inspect the Memory Agent`, `improve it`, and `test it` remain one coherent goal.
- The current goal and latest exact exchange are supplied on every turn regardless of retrieval score.
- Older goals are retrieved automatically and represented by a small set of human-readable capsules.
- No more than three older goal capsules are projected into normal turn resolution.
- Relevant skills and MCP tools are retrieved automatically, while `socrates://capabilities` remains the mandatory exact fallback before an unavailable-capability claim.
- The goal decision exposes only current, retrieved older goal, new, or clarify.
- There is no model-driven Memory Router or tool-using Goal Router in the critical path.
- Exact messages and answers remain canonical, visible, attributable, searchable, and deletable.
- Automatic 170k oldest-head compaction preserves an approximately 70k newest whole-turn suffix and exact source recovery without interrupting the user.
- Large current-turn tool results use release-only `R<n>` handles without mandatory classification or extra inference calls.
- Goal capsules restore working state without replacing exact goal history.
- The sidebar uses flat Goals and Exact exchanges replacement pages with a back control; it contains no nested goal tree or project/conversation level.
- Historical exchange selection is passive, and a send from history returns to the live tail before normal semantic goal resolution.
- Live work uses one replace-in-place activity sentence, one collapsed detail disclosure, and no stacked pseudo-thinking feed; the persisted final answer appears only after atomic commit.
- `Live Work` and backend-authoritative `Live Goal` notes remain movable, keyboard accessible, responsive, secret-safe presentation projections and never become state authorities.
- One agent runtime, capability catalog, tool contract, retrieval foundation, and finalization path serve every turn.
- A normal no-tool request uses one goal-decision call and one foreground final call; tool-using work adds only the provider continuations genuinely required to consume tool results.
- No shadow steering message, per-batch action ledger, detached reconciliation call, or detached final-formatting call reaches Socrates.
- The answer, task outcome, capsule update, and current-goal state commit atomically before publication.

## Migration Principle

Released Classic, project, V2 transport, namespaced persistence, bridge, and workspace records must remain safe and recoverable during migration. Data preservation does not require preserving obsolete ownership models.

Migration is explicit, idempotent, and one-way into canonical global ownership:

1. Create or restore the one global Socrates state independently of every project, conversation, and Flow.
2. Import each released goal and capsule into the canonical global goal ledger while preserving its stable identity, lifecycle, timestamps, and source provenance.
3. Import each exact exchange and its tools, approvals, Terminal lineage, usage, artifacts, errors, and evidence as one task-owned record without rewriting user or assistant content.
4. Retain project/workspace coordinates only where they describe source provenance, retrieval/index scope, or the immutable per-turn access snapshot.
5. Record an idempotent migration receipt before retiring the corresponding legacy owner. A failed migration leaves the legacy source untouched and is retryable.
6. After migration succeeds, active `/chat`, HTTP, WebSocket, retrieval, compaction, Terminal, and recovery paths use only the canonical global state. They never create or require a hidden Flow.

Legacy UI routes redirect into `/chat`; legacy data readers exist only inside the migrator and can be removed once the supported upgrade window closes. There is no permanent compatibility Flow, no copied live transcript, no dual-write period, and no second current-goal pointer. New production authority converges on one global Socrates, one goal-centric exact history, one root-task lifecycle, and one transport/recovery session layer that owns no semantic state.
