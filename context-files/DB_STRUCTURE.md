# Socrates Database Structure

The executable authority is `apps/server/src/db/schema.ts` plus ordered Drizzle migrations. The production target is one fresh compact SQLite database. The released database is preserved intact in a verified cutover archive and is never an active compatibility store.

## Canonical product tables

The active schema has 26 product tables plus migration-framework metadata:

```text
app_state                 settings
access_roots              access_snapshots
goals                     goal_capsule_versions
tasks                     messages
task_events               model_calls
tool_calls                interaction_requests
terminal_sessions         terminal_output_chunks
artifacts                 resources
resource_locations        resource_bindings
knowledge_entries         knowledge_versions
memory_notes              background_jobs
capabilities              capability_versions
retrieval_sources         context_compactions
```

No project, workspace, conversation, session, Flow, V2 duplicate, bridge, projection, title-worker, separate approval/credential, separate usage/error, memory-document-index, or role-specific job table belongs in the new database.

## Global state and exact work

`app_state` is a singleton containing only the foreground goal, active root task, monotonic revision, recovery sequence, and cutover state. It owns no transcript or resource scope.

Every user request creates one `task` and exact immutable user `message` before routing. A task may have no goal only while routing or clarification is unresolved. `messages`, `tool_calls`, `terminal_output_chunks`, and canonical artifact content remain exact. `task_events` is the append-only globally sequenced replay/recovery stream. Model usage lives on `model_calls`; feedback versions live on the relevant assistant message; failures live on their owning task/call/job plus an event.

`interaction_requests` unifies approval, credential, clarification, Frontier, and proposal-acceptance waits. Secret values are never persisted. `terminal_sessions` and `terminal_output_chunks` preserve named PTY lifecycle and exact output while every continuation remains attached to the same root task.

## Goals, capsules, and resources

`goals` owns durable goal identity and lifecycle. `goal_capsule_versions` stores structured objective, summary, progress, constraints, decisions, open questions, next actions, and stable resource references. Capsules never copy exact exchanges or evidence.

`resources` owns stable confirmed identity and human labels. `resource_locations` owns canonical path history, availability, and optional filesystem/Git fingerprints. `resource_bindings` binds a resource/location to either a goal or an exact task. Goal bindings carry active resources forward; task bindings record the location actually used. Selected access roots are never resource bindings.

## Knowledge and capabilities

`knowledge_entries` owns stable global/resource knowledge ids and kinds: identity, profile, global rule, resource memory, resource rule, or repository fact. `knowledge_versions` owns exact content, status, provenance, evidence, and version history. Direct user edits and Memory Agent actions use the same validation/versioning path. At most 10 global rules and 10 rules per resource may be active.

`memory_notes` is the durable evidence-backed Memory Agent inbox. `background_jobs` owns Memory Agent, Skill Writer, speech, indexing, cleanup, and other asynchronous work. Memory Agent and Skill Writer never receive MCP capabilities or installed-skill execution.

`capabilities` owns skill/MCP identity, global/resource scope, state, metadata, and secret key bindings. `capability_versions` owns exact skill hashes or MCP configuration history and approval provenance. Skill content remains in canonical `SKILL.md` files. MCP and provider secrets remain in the OS keychain; SQLite stores only bindings and status.

## Access, retrieval, and compaction

`access_roots` owns canonical selected roots. `access_snapshots` stores the immutable mode, root set, working directory, and policy revision captured for one task. Paths define autonomy only.

`retrieval_sources` tracks canonical source identity, version/hash, visibility, and derived-index state. LanceDB under Socrates cache is disposable and rebuildable. Retrieval diagnostics use `task_events`; there is no second retrieval-run authority.

`context_compactions` stores provenance-linked derived summaries and exact compacted source boundaries. It never overwrites canonical messages, tool calls, or output.

## Whole-state archive and fresh cutover

Before replacing a released database, the cutover service:

1. acquires a maintenance lock and verifies no active task or Terminal;
2. checkpoints WAL and passes `PRAGMA integrity_check`;
3. copies the complete released state into `~/.Socrates/backups/cutover-<timestamp>/old-state`;
4. writes and verifies a permission-restricted checksum manifest;
5. creates a temporary fresh canonical database;
6. imports only global identity/profile/accepted rules/cross-project memory and user settings/access/global capabilities;
7. regenerates catalog-owned tool guidance;
8. validates zero imported work history; and
9. atomically swaps the database or restores the old installation on failure.

The archive is retained until explicit user deletion. Settings may list its timestamp, integrity, size, and reveal action, but does not restore it or browse old chats.

## Test isolation

Every mutating test sets disposable `SOCRATES_HOME`, database, workspace, credentials, ports, Terminal state, and browser profile. Tests never archive, migrate, reset, or inspect the user's normal Socrates state.
