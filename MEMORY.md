# Socrates Memory

This is the maintainer restart surface for Socrates. It records the accepted product model and current implementation objective; detailed authority lives in `context-files/`.

## Mandatory orientation

Before architecture, runtime, capability, prompt, retrieval, persistence, access, Terminal, goal/task, or UI work, read in order:

1. `AGENTS.md`
2. `context-files/REPO_RULES.md`
3. `context-files/GLOBAL_SOCRATES_NORTH_STAR.md`
4. `context-files/UNIFIED_SOCRATES_LIFECYCLE.md`
5. `context-files/AGENT_REFACTOR_MANIFESTO.md`
6. `context-files/AGENT_CAPABILITY_WORKFLOW.md`

Released phase reports, generated output, archived state, `tmp-opencode/`, and old implementations are not product authority.

## Canonical product model

- Socrates is one global, goal-centric assistant. Projects, workspaces, conversations, sessions, Classic, V2, and Flow are not active product coordinates.
- `/welcome` has the established identity, “Welcome to Socrates,” and one **Open Socrates** action to `/chat`. `/chat` has no project or conversation prerequisite.
- Goals organize outcomes. Every user request creates one root task and exact user message before routing. Only a genuinely independent outcome creates a new goal.
- One singleton app state owns the sole foreground goal, active root task, revision, and globally monotonic recovery sequence.
- The same Main Socrates performs the four-way goal decision (`current`, one retrieved older goal, `new`, or `clarify`) and then all foreground work, continuations, reconciliation, and the structured final answer in one loop.
- Goal, memory, and capability candidates are retrieved concurrently. The current capsule and latest exact exchange are guaranteed independently of retrieval score. Exact memory selection after goal binding is deterministic.
- There is no Goal Router, Memory Router, Resource Router, Title Generator, draft agent, reconciliation agent, finalizer, hidden Flow, replacement transcript, alternate foreground pointer, or dual-write lifecycle.

## Exact state and context

- Goals own versioned capsules: objective, summary, state, progress, constraints, decisions, open questions, next actions, and resource references.
- Tasks own exact user/assistant messages, tool evidence, approvals, Terminal output, model calls, usage, and immutable replay events. Exact evidence is never copied into capsule prose.
- Context trimming affects only current model-visible projections. At 170k tokens, automatic provenance-linked compaction replaces only the oldest safe completed-turn head, or an oversized active turn's oldest completed tool-exchange prefix. The active request, pending operations, and newest safe suffix remain raw; canonical sources never change.
- Model-facing anchors are human task/turn ordinals resolved internally to exact ids. Do not expose opaque database ids when a human-sized handle works.

## Paths, resources, and access

- Paths express filesystem autonomy only. Selected paths never imply intent, create resources, bind goals, or inject knowledge/rules.
- Confirmed resources are separate stable records with labels, location history, availability, and fingerprints. Goals may bind zero, one, or many resources; tasks record the exact location used.
- An exact existing path supplied by the user may bind immediately. A discovered path always requires confirmation. Missing/moved resources retain knowledge and may be relinked; ambiguous copies require confirmation.
- Structured read/search is automatic globally in every mode.
- Read only approval-gates every structured mutation and every Terminal `run/start`.
- Selected makes structured writes inside selected roots automatic, approval-gates writes elsewhere, and approval-gates every Terminal `run/start`.
- Full makes ordinary structured mutations, Terminal launches, capability mutations, and external side effects automatic.
- Terminal `inspect/list/stop` is automatic in every mode. Credentials and clarifications remain typed waits. Catastrophic protected operations are hard denied in every mode.
- Frontier handoff always requires explicit approval. Rejection disables Frontier for the whole current task.
- Each task owns an immutable access snapshot. Later access changes affect future tasks only.
- Terminal is an ordinary PTY-backed process launched through a native macOS/Windows containment adapter. Command parsing is explanatory defense in depth, never containment. Full automatic Terminal fails closed when native containment cannot be established.

## Knowledge, agents, and capabilities

- Durable identity, profile, global rules, global memory, resource rules, resource memory, and resource repository facts are typed, versioned SQLite knowledge with provenance and accepted/pending/superseded/deleted state.
- Global hard rules precede resource rules; current explicit instructions take precedence where policy permits. There are at most 10 active global rules and 10 active rules per resource.
- Explicit user rules activate after validation. Inferred rules and inferred skills require semantic user acceptance regardless of access mode.
- Existing repo-local `.socrates` directories remain untouched and are never created, read, imported, or written by the new runtime. Temporary task scratch lives under `~/.Socrates/work/<task-id>`.
- Main Socrates alone receives normal tools, retrieved installed skills, and eligible MCP tools.
- The Memory Agent receives exact notes/evidence, owns typed knowledge curation, has no MCP tools, installed skills, goal retrieval, or memory-routing phase, and may create an evidence-backed pending skill proposal.
- The Skill Writer receives only an accepted request/proposal, exact evidence, narrow read/search/trace access, and typed skill-write authority. It has no MCP tools and never loads installed skills.
- Socrates Context Compactor and Memory Context Compactor are narrow shared-runtime roles. Frontier is a configured worker target, not a second product runtime.
- Runtime capability eligibility is global plus capabilities attached to resources bound to the task/goal, followed by semantic retrieval. Never dump all capabilities into context.

## Persistence and cutover

- The new active database contains exactly the 26 product tables listed in `context-files/DB_STRUCTURE.md`, plus migration-framework metadata.
- Before schema replacement, acquire a maintenance lock, refuse active task/Terminal state, checkpoint WAL, run integrity checks, and stage a permission-restricted whole-state archive with a verified hash manifest.
- Seed the fresh database only with identity, profile, accepted global rules and cross-project memory, provider/worker settings, access mode and selected roots, and global skills/MCP configuration and secret bindings.
- Do not import released goals, projects, conversations, Flow records, messages, tools, traces, approvals, Terminal history, usage, project/resource memory, or project-scoped capabilities.
- Swap the verified fresh database atomically. Failure leaves/restores the old installation. Repeated cutover attempts are idempotent. Archives remain until the user explicitly deletes them.
- The active runtime never reads the archive or released schema. Settings exposes archive inventory and reveal only—no restore or legacy viewer.
- New Socrates home: database, backups, global/resource skills, artifacts, task work, retrieval cache, runtime, logs, trash, and a development-only permission-0600 secret fallback. Production secrets live in the OS keychain.

## UI contract

- `/chat` is a `100dvh` seamless shell with fixed header, fixed bottom-safe-area composer, and middle-only scrolling.
- Header: sidebar toggle and exact Socrates logo/identity on the left; `Paths | Access | Settings` on the right. Settings navigates to the full `/settings`; **Memory Agent** links to `/memory`.
- Exactly one live/latest or passively selected historical exchange is displayed. Long user queries are right-aligned, width-limited, height-clamped, and use Show more/Show less only when needed.
- Sending while viewing history immediately returns to the canonical live tail. History selection never changes the foreground goal or branches the task lineage.
- The established orb remains persistent. During work it shows one replace-in-place safe activity sentence and a collapsed **Thinking and work** disclosure. It never exposes unrestricted hidden chain-of-thought. Typed approvals, credentials, clarifications, and Terminal input remain full controls.
- After the atomic final commit, the orb recedes behind the exact Markdown answer without moving the header or composer. Failure, cancellation, disconnect, compaction, and recovery are typed states.
- Exactly two viewport-bound movable notes exist: **Live Work** and backend-authoritative **Live Goal**. They are presentation projections, keyboard accessible, collision/clamp safe, position persistent, and mobile-accessible. There is no canvas reset control.
- The sidebar is two replacement pages: a flat goal list, then one goal's flat exact-exchange list with back control. Queries are never nested under goal rows.
- Use the exact established Socrates logo and orb assets. Do not invent substitute marks, empty-state marketing copy, card mosaics, or ornamental borders/shadows.

## Verification and safety

- Mutating tests use isolated `SOCRATES_HOME`, database, resource roots, ports, credentials, Terminal state, and browser profile. Never reset or mutate the user's normal state.
- Architecture-absence checks forbid Flow/project/conversation owners, duplicate schemas/stores, old routes, role-specific runners, tracked `tmp-opencode`, and generated references to removed capabilities.
- Completion requires full build/typecheck/lint/unit/integration/architecture suites, cutover fault injection, access and containment matrices, resource/knowledge/capability tests, compaction/recovery tests, responsive accessibility tests, and natural isolated DeepSeek V4 Pro plus Terra E2E after restart.
- Release v0.1.20 remains halted. Do not recreate tags, publish, or run release workflows without explicit user authorization.
- Preserve dirty-worktree changes that are unrelated or not known to be ours. Never treat `tmp-opencode/` as product code or authority.
