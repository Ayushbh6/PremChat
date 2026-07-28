# Socrates Repo Rules

These rules are strict and non-negotiable. They exist to keep the codebase understandable as Socrates grows into a serious coding agent.

## 1. Keep Package Responsibilities Clear

Each package has one job.

```text
apps/web          -> user interface
apps/server       -> API and WebSocket transport
packages/core     -> agent runtime and orchestration
packages/workspace -> local file, shell, search, git, and patch operations
packages/providers -> model provider abstraction and adapters
packages/contracts -> shared schemas, event types, tool contracts
packages/shared   -> generic reusable utilities
```

Do not place logic in a package just because it is convenient. Put it where it belongs.

The current product and supported distribution boundary are the normal web frontend plus backend, delivered through the NPM CLI and packaged backend/frontend runtime archives. New runtime packaging logic belongs in the neutral root runtime/release script surface. Legacy `apps/desktop`/Tauri is discarded and unsupported; do not modify or use it for V1 or V2 unless the user explicitly reverses this decision.

Runtime archives must be self-contained and secret-free. Packaging must remove deploy-created links back into the source checkout, recursively exclude `.env` and `.env.*` files without mutating their source targets, reject deployed server links whose resolved target escapes the runtime root, and inspect the final archive entry list before publication. A local ignored credential file must never be reachable through a packaged workspace self-link.

LanceDB is pinned to `0.22.3` because that release publishes native packages for every supported runtime target (`darwin-arm64`, `darwin-x64`, and `win32-x64-msvc`). Lance SQL predicates over camel-case schema fields must quote identifiers, and server shutdown must close the shared native connection explicitly.

Retrieval has one shared ownership chain:

```text
packages/core retrieval contracts/chunking/ranking
  -> apps/server retrieval orchestration and LanceDB adapter
  -> existing packages/providers EmbeddingProvider boundary
  -> model-visible tools/agents through strict contracts
```

Do not build separate semantic pipelines for trace recall and memory routing. They must reuse the same Markdown-aware chunker, embedding fingerprinting, index lifecycle, ranking, diagnostics, and parent-result grouping. SQLite is authoritative application state; LanceDB is a disposable/rebuildable retrieval index.

## 2. No Duplicate Implementations

There must never be three versions of the same helper scattered across the repo.

If logic is reused:

- Put domain logic in the domain package that owns it.
- Put cross-boundary schemas in `packages/contracts`.
- Put generic helpers in `packages/shared`.
- Import and reuse the existing function.

Before adding a new helper, search the repo for an existing one.

## 3. Contracts Live In One Place

All shared schemas, events, request types, response types, tool argument types, and approval payload types must live in `packages/contracts`.

This includes:

- WebSocket events.
- HTTP API payloads.
- Tool call schemas.
- Tool result schemas.
- Session schemas.
- Approval schemas.
- Error payload schemas.

Do not redefine event or payload shapes inside `apps/web`, `apps/server`, or `packages/core`.

## 4. WebSocket Events Must Be Typed

Every WebSocket event must have:

- A stable event name.
- A schema.
- A TypeScript type inferred from the schema.
- A single source of truth in `packages/contracts`.

No anonymous event objects should be manually constructed in random files.

Bad:

```ts
socket.send(JSON.stringify({ type: "thing", value: "abc" }))
```

Good:

```ts
const event = AgentMessageDeltaEvent.parse({
  type: "agent.message.delta",
  sessionId,
  text,
})

socket.send(JSON.stringify(event))
```

## 5. The Frontend Must Not Own Agent Logic

`apps/web` renders state and sends user actions. It must not decide how the agent works.

The frontend should use Socrates-owned hooks around Socrates contracts and WebSocket events. Do not make `@ai-sdk/react` the core chat state engine in V1.

Frontend code may:

- Display messages.
- Show tool calls.
- Render diffs.
- Capture voice input through approved browser APIs.
- Trigger read-aloud playback for assistant messages.
- Collect thumbs up/down feedback.
- Ask for approvals.
- Send approval decisions.
- Send cancellation requests.

Frontend code must not:

- Call model providers directly.
- Call transcription or text-to-speech providers directly unless the architecture explicitly chooses browser-native APIs and records that choice through contracts/events.
- Read or write local repo files directly.
- Run shell commands.
- Implement agent loops.
- Duplicate backend validation rules.

## 6. The Server Should Stay Thin

`apps/server` is transport glue. It should validate requests, manage connections, and call package APIs.

Server routes must not become a dumping ground for:

- Agent orchestration.
- Tool implementations.
- Provider-specific logic.
- Filesystem logic.
- Shell command logic.

If a route grows complex, move the logic into the correct package.

## 7. Global Resource Scope Is The App Boundary

The target product opens one global seamless Socrates without requiring a project or conversation selection. Paths, connected accounts, apps, credentials, and the visible Selected/Full access mode define what the current turn may use.

Required target shape:

```text
user -> authorized resource scopes -> goal -> task -> exact exchange/evidence
```

Released project and conversation rows remain traceable migration, audit, presentation, and rollback data. They may map to internal resource/index scopes while compatibility is required, but new semantic authority must not depend on a user-visible project hierarchy.

Selected-path mode limits filesystem operations and indexing to explicit roots. Full-access mode expands filesystem scope only after explicit user choice, remains visible and revocable, and never bypasses approval, credential, destructive-action, message-send, purchase, or external-side-effect policy.

Workspace folders remain real local surfaces and may contain `.socrates/` state during migration. Resource-scope creation and verification belong to `packages/workspace`. Do not edit a workspace root `.gitignore` automatically.

## 8. The Agent Core Must Be Provider-Agnostic

`packages/core` must never import OpenAI, Anthropic, Gemini, Ollama, OpenRouter, LiteLLM, or Vercel AI SDK directly.

The core talks only to the internal model interface from `packages/providers`.

The correct shape is:

```text
packages/core -> ModelProvider interface -> provider adapter
```

Provider/model tokenizer details also belong behind this boundary. Context budgeting must call the provider interface's token counter for the assembled next model request instead of using ad hoc character estimates in `packages/core`, `apps/server`, or `apps/web`.

Not:

```text
packages/core -> OpenAI SDK
packages/core -> Anthropic SDK
packages/core -> Vercel AI SDK
```

## 9. Workspace Operations Must Go Through `packages/workspace`

All local file, shell, search, git, and patch operations must go through `packages/workspace`.

Project folder creation, existing-folder verification, `.socrates/` scaffold creation, and resource file placement also belong to `packages/workspace`.

Native folder picker adapters also belong to `packages/workspace`. The frontend must not rely on browser-only filesystem APIs for the core project/workspace model.

Do not run ad hoc filesystem or shell logic from:

- `apps/web`
- `apps/server/routes`
- `packages/core/agent`
- random utility files

The agent-facing tool wrapper lives in `packages/core/tools`, but the implementation lives in `packages/workspace`.

## 10. Tools Need Schemas, Permissions, And Ownership

Every agent tool must define:

- Name.
- Description.
- Argument schema.
- Result schema.
- Permission behavior.
- Execution function.
- Owning package.

Tool definitions belong in `packages/core/tools`.

Tool implementation details belong in the package that owns the capability, usually `packages/workspace`.

The V1 model-visible tool surface is intentionally small:

```text
read
search
url_fetch
edit
apply_patch
bash
trace_retrieve
tool_docs
skills
project_docs
repo_docs
soul
user_profile
list_project_resources
mcp_registry
```

Do not expose separate `glob`, `grep`, `write`, `git`, `todo`, `question`, broad web-search, or sub-agent/task tools in the initial tooling phase. Those may exist as internal implementation helpers, but the main Socrates model should see the smaller surface above plus dynamic MCP tools explicitly exposed by the MCP runtime after `mcp_registry describe`. Patch application is exposed as `apply_patch`, not as a hidden patch mode inside `edit`.

Do not dump all skills, MCP servers, MCP tool schemas, workspace runtime facts, or current date/time into the system prompt. Stable routing guidance belongs in the base prompt; changing facts belong behind tools. The runtime must not grep user prompts for skill/MCP names and inject hidden matched ids or descriptions. Socrates should discover extensions itself with `skills list` / `skills describe` and `mcp_registry list` / `mcp_registry describe`.

Each model-visible tool must live in its own small TypeScript file under `packages/core/tools/`, with a single unified registry that exposes the enabled tools to the agent. Do not put all tools into one large class or one large mixed implementation file.

The `read`, `search`, `trace_retrieve`, `tool_docs`, `soul`, `user_profile`, and `list_project_resources` tools are read-only. `mcp_registry` list/describe/check are automatic discovery/validation, while configure/delete require approval and an exact user-supplied or trusted stdio config. `skills` list/describe/read and exact-URL `preview_import` are automatic; `commit_import` requires approval, operates only on the exact destination-bound preview, and must reject conflicts unless replacement was explicitly requested. Never invent MCP packages, skill URLs, commands, or credentials, and never use Terminal to bypass either lifecycle. `project_docs` and `repo_docs` retain their scoped mutation boundaries. Applicable doctrine and project state are loaded when relevant and reconciled at meaningful durable-state checkpoints, not before every approval-required mutation.

`trace_retrieve` must stay high-level and intent-based. Main Socrates starts with `operation="search"` and uses active-project `lexical`, `semantic`, `combined`, or `audit` retrieval. Full active-project search is the default; current/recent conversation narrowing is optional. The main schema must not expose cross-project selectors. Lexical queries search all supplied terms and are rejected above 128 characters; semantic/combined queries are rejected above 1,000 characters. There is no silent truncation. Audit-only filters are for raw tool/shell/file/patch/error evidence. The Global Memory Agent owns a separate explicit cross-project trace contract.

Normal trace search output must stay slim: `resultNumber`, raw matched `content`, `turnId`, `conversationTitle`, human `turnNumber`, `matchedRole`, visible `status`, and `occurredAt`. Memory search output similarly exposes only numbered content plus surface, filename, valid section id/heading, and global/project scope.

`conversationId`, `messageId`, `toolCallId`, chunk/vector ids, terminal ids, process ids, provider ids, and other opaque runtime ids may remain internal for storage, UI events, provider protocol correlation, diagnostics, and backwards compatibility. Normal search results must not expose those ids, scores, source tables, metadata, or inspect argument blobs. Numbered results and the human-sized turn/section reference are enough for follow-up inspection.

Trace retrieval is limited to visible non-deleted conversations (`active` and `archived`). Hard-deleted conversations must not be searchable or inspectable; conversation hard delete removes active LanceDB parents and owning retrieval diagnostics, while project delete drops the complete project index.

Search and inspect results must include enough conversation identity to answer correctly. Socrates should use `conversationTitle` as the human-readable location and the returned `turnId` only when a precise follow-up inspection or same-title disambiguation is needed.

For ordinal recall, the model must use a queryless lexical search with the structured integer `turnNo`, preferably narrowed by `conversationTitle`. The backend must not silently infer `turnNo` from natural-language query text such as "second user message"; without `turnNo`, the call remains ordinary search. Project-scoped ordinal lookup can return the same turn number from multiple visible conversations, so the agent must inspect the relevant clean Q&A-parent result rather than assuming one conversation. Out-of-range ordinal lookup returns no result and must not silently fall back.

Trace retrieval is search-then-inspect:

```text
search
  natural-language, scoped, hybrid retrieval
  returns compact numbered evidence plus provenance

inspect
  exact bounded retrieval by returned resultNumber or natural filters
  returns raw source text or exact tool evidence
```

Retrieval internals such as LanceDB tables, chunks, vectors, embedding fingerprints, jobs, scores, and diagnostics must not become separate model-visible tools. They remain backend implementation details behind model-visible `trace_retrieve` and the automatic typed goal/memory candidate adapters.

Embedding providers must follow the same boundary rules as chat providers. OpenAI hosted embeddings and offline local embeddings through Ollama or a future Hugging Face / sentence-transformers backend must live behind `packages/providers`; frontend code, routes, WebSocket handlers, and `packages/core` must not call embedding SDKs or local model runtimes directly. Socrates must not silently install or download offline embedding models; it should detect missing local setup and show explicit setup guidance.

Conversation/compaction summaries must preserve provenance but are not part of the normal semantic trace corpus and must never be stored as fake user or assistant messages. The `messages` table remains the source for real visible chat text; exact historical wording comes from inspecting the canonical turn or raw audit evidence.

`list_project_resources` must use backend project resource records and should be preferred before shell probing when the user asks about uploaded project files under `.socrates/resources/`. Its model-visible input is limited to `kind` and `limit`, and its output must stay to filenames/metadata only.

Chat screenshots/images are different from project resources. They are stored under `<workspace>/.socrates/attachments/`, tracked by `message_attachments`, and referenced in user messages with filename, MIME type, size, and path. The agent prompt should teach Socrates to use native image parts when available, and to reopen known attachment paths with `read` when prior or exact screenshot inspection is needed. These attachments must not be surfaced through `list_project_resources`. Attachment files may remain after a conversation is deleted; if trace retrieval has no visible provenance, Socrates must not invent the deleted conversation title or message context from the filename alone.

The `edit` tool is the primary V1 model-visible single-file mutation tool. Existing files should use targeted `oldString`/`newString` replacements; whole-file `content` on an existing file requires explicit `overwrite: true` and should be reserved for deliberate rewrites. New deliverables, scratch files, or generated files that are derived from files in a subfolder should use an explicit path in that same subfolder or the nearest relevant existing folder; the workspace root is appropriate only when the user asks for it, the artifact is truly project-level, or the task is standalone workspace-level work with no relevant subfolder. The separate `apply_patch` tool covers multi-hunk or multi-file patch application. Its preferred model-facing input is `patchText` using the structured `*** Begin Patch` envelope with `*** Add File`, `*** Update File`, `*** Delete File`, and `*** Move to` sections so models do not need to calculate unified-diff hunk counts; `@@` labels are optional hints and exact old lines do the matching. Standard unified diffs remain accepted for compatibility when already valid and are applied via `git apply`. Both must show a diff or equivalent preview and require approval unless the user explicitly runs a full-access mode. The harness tracks file freshness from `read` results; existing-file edits, patches, deletes, and renames require a prior active-turn read, and another mutation to the same file after a successful mutation must re-read first. Generic `edit` and `apply_patch` writes to `<workspace>/.socrates/MEMORY.md`, `<workspace>/.socrates/PROJECT_NOTES.md`, and `<workspace>/.socrates/repo_docs/*.md` are rejected; workspace docs must be changed through `project_docs` or `repo_docs`. Model-facing tool inputs must not carry content hashes.

When the user asks Socrates to write code, create a script, build a small program, implement something, or build a small app/tool, Socrates should treat that as a request to create or edit a real workspace file with `edit`, not as a request for a long inline code block. For non-trivial implementation/build work, Socrates uses `.socrates/` as a flexible working space to record a useful plan, track active tasks, keep one-off scripts or probes, and reconcile verified progress. The plan and task record may be one file, several purpose-named files, or another clear free-flowing layout; `PLAN.md` and `TASKS.md` are examples, never mandatory filenames. Disposable investigation scripts, test probes, generated diagnostics, and temporary working artifacts belong under `.socrates/work/` or another clearly transient `.socrates/` subpath. These working artifacts are intentionally outside the durable surface registry and must not substitute for project memory, notes, or repo doctrine. Production code, user deliverables, migrations, and permanent tests belong in their proper attached workspace/repo locations. Socrates should choose a sensible path when obvious, ask one concise question only when destination/language/intent is genuinely ambiguous, optionally verify with Terminal, and summarize file path plus run instructions in the final answer. If the work is based on files in a subfolder, generated outputs should stay in that subfolder or the nearest relevant existing folder unless the user says otherwise. If the user says "wherever" or lets Socrates decide, use that nearest relevant folder when one is known; use the repo root only for genuinely project-level or standalone workspace-level work, or create a small well-named folder only when the task naturally needs multiple files. It should paste a full runnable file in chat only when the user explicitly asks for inline code or when no write-capable workspace is available.

Before installing Python packages or running generated Python code, Socrates should read project notes when workspace runtime facts matter. The backend maintains a protected `runtime_context` section in `.socrates/PROJECT_NOTES.md` with compact generated workspace scan facts such as detected stack, package manager, and virtual-environment hints. It refreshes lazily when `project_docs` touches notes and is rewritten only when the generated signature changes. If a project-local environment or package-manager workflow is detected, Socrates should use that instead of creating a second environment or running raw global `pip`. If no environment is detected and dependencies are needed, it should ask the user before creating a venv or installing packages unless the user already explicitly requested setup. Terminal output, live terminal state, dependency dumps, package lists, and root-script inventories must not be persisted in `runtime_context`.

Generated plotting/data scripts should save charts or artifacts to files and print their paths by default. Avoid GUI-blocking calls like `plt.show()` unless the user explicitly asks for an interactive window.

`.socrates/` is Socrates-owned memory, runtime, resource, and transient agent-work storage. Free-form plans, task records, and `work/` are transient working conventions rather than durable memory surfaces; create only what helps the task, keep it current at meaningful milestones, and condense or remove obsolete scratch material that would mislead a later run. They are not locations for production code, user deliverables, migrations, or permanent tests. Generic workspace mutation tools may own these transient paths, while protected memory/doctrine paths remain owned by `project_docs` and `repo_docs`. Ordinary "do not edit files", "make no workspace changes", or "review only" instructions protect user workspace artifacts but do not by themselves suppress narrowly scoped backend-owned memory housekeeping. Suppress it when the user semantically includes Socrates memory, project notes, internal state, `.socrates`, or all changes whatsoever.

`current_time` is the read-only no-input current date/time authority. Use it for date-sensitive answers, filenames, logs, and document prose that truly needs today's date or exact time. The Socrates system prompt must not include changing current date/time fields.

`project_docs` is the main workspace memory surface. Use `area: "memory"` for durable cross-conversation project state: goals, decisions, constraints, blockers, durable user/project preferences, changed workflow facts, and handoff facts. Use `area: "notes"` for live assistant notes: active project context, active todos, checked files, partial progress, next commands, restart points, and the protected backend-owned `runtime_context` and `state_ledger` sections. Runtime project docs are structured markdown; prefer `read_index`, then `read_section` or `patch_section`, when a known section is enough. Any `project_docs` call for notes first ensures the generated `runtime_context`, but model-authored edits cannot change either protected section. `project_docs` outputs include system runtime date/time metadata, and successful edits stamp frontmatter with backend-owned `updated_at`, `updated_by`, and `last_edited_section`. Project-memory review and mutation occur only when lifecycle evidence identifies a meaningful durable-state change: material goal/scope change, future-dependent decision, verified milestone, blocker/incomplete handoff, or final reconciliation. A workspace mutation by itself is not such a change.

`repo_docs` owns the runtime `.socrates/repo_docs/*.md` doctrine files. They are structured markdown with stable section ids; prefer `read_index`, `read_section`, and `patch_section` for focused doctrine changes. `repo_docs` outputs include system runtime date/time metadata, and successful edits stamp frontmatter with backend-owned `updated_at`, `updated_by`, and `last_edited_section`. Root maintainer documentation lives in `context-files/*.md`, not `.socrates/repo_docs/`, so do not confuse it with Socrates runtime-owned docs.

Memory candidate retrieval must stay centralized, automatic, read-only, and surface-aware. Its first pass runs concurrently with goal-candidate retrieval and includes the current capsule when available. After the same-Socrates goal decision, a changed bound goal or empty eligible first pass may trigger exactly one targeted query through that same retrieval service; deterministic selection then filters and reranks exact candidates by authorization, resource scope, bound goal/task, provenance, relevance, and duplication. There is no model-driven Memory Router or second retrieval authority in the target critical path. The same main Socrates that performed the work owns mandatory pre-final reconciliation and verifies exact project/repo doc mutations; asynchronous Global Memory work owns profile/identity curation. Backend-owned `runtime_context` and `state_ledger` sections are never reconciliation targets.

The structured main-Socrates reconciliation/finalization contract is implemented and mandatory. Do not reintroduce a detached final router or a semantic classifier shortcut around the checkpoint. The July 2026 `skip_candidate` evaluation remains historical evidence that probabilistic skipping was unsafe; its fixtures/reports are not runtime authority.

Candidate-retrieval or deterministic-selection failure must be typed, observable, non-blocking when safe, and honest. Persist the failed phase/error and any observed usage, continue with the guaranteed current capsule/latest exact exchange when authorized, and never imply that failed recall succeeded. Do not add another model router, retry queue, or pending-reconciliation ledger as a workaround.

Frontier is a one-way same-task model handover, not consultation or multi-agent dialogue. The default Socrates model is the primary worker and must make a real, substantive effort before requesting Frontier; task length, difficulty, high consequence, code, ordinary uncertainty, multiple normal tools, or one recoverable error are not sufficient reasons by themselves. Expose `handover_to_frontier` only while a distinct configured Frontier target is available; accept only optional compact `focus`; and always require explicit user approval, including in approve-all/full-access mode. Approval transfers the exact current model-visible working context—including any already-applied automatic compaction and turn-local releases—without a second handover summary or reduction; exact released and compacted sources remain retrievable from canonical evidence. It discards provisional driver answer text on the transfer step, removes the tool, keeps the Frontier runtime across automatic wait/resume, and returns to the selected main model only on the next user-authored turn. Rejection returns a clear rejected-tool result, removes the tool for the rest of the turn, and deterministically instructs Socrates to continue and complete the task itself.

Model thinking selectors must reflect supported provider behavior. If a model marks reasoning mandatory, do not expose or send Off/None; if a persisted thinking selection becomes unsupported, resolve it to the model's supported default without overwriting the saved row. OpenRouter Grok 4.5 currently requires reasoning and supports only Low, Medium, and High, so Frontier defaults to Low.

Always-apply rules must be centralized and capped, not scattered through arbitrary docs. The accepted shape is a small global lane in `user_profile.md` named `Global Always-Apply Rules` plus a project lane in workspace project memory named `Project Always-Apply Rules`, each capped at 10 human-readable rules. The backend must attach them with the three bounded identity sections through one per-project stable-prelude snapshot before conversation/user text, not five visible tool calls. Cache reuse is stat-fast-path plus content-hash validation: same-content rewrites and unrelated-section edits retain the snapshot, only a changed standing-section hash rebuilds it, and the in-memory cache must remain bounded. Pre-turn routing must hard-skip standing targets already in the snapshot and deduplicate exact dynamic targets. These rules are for hard behavior constraints only; larger explanations and repo doctrine remain in `.socrates/repo_docs/*`. Dynamic router-selected docs, tool results, and memory/action ledgers must stay after the current user message so stable prompt prefixes remain reusable across providers.

Models and generic workspace tools must never receive plaintext credentials. Model-facing MCP configuration may declare only secret key names and a semantic source through `secretBindings`; user input is the default, while workspace-env reuse requires the user's explicit request. Credential values must travel through the typed one-at-a-time credential input flow and remain transient until the MCP runtime writes the private scope env file. Persisted events, tool arguments/results, approvals, and `mcp.json` may contain key names but never values. Generic read/search/Terminal access must reject real env files, private keys, and credential material; safe env templates may remain readable.

The durable `.socrates` architecture has one code-owned authority: `packages/contracts/src/socratesSurfaces.ts`. It defines the nine global/project durable surfaces, paths and aliases, read tools, write owners, load policies, cache classes, and mutation restrictions. Runtime path guards and storage helpers must derive from that registry; prompts and docs must not maintain competing durable path maps. Free-form transient `.socrates` plans, task records, scripts, probes, and diagnostics are deliberately not extra memory authorities. The generated model-facing surface map is only a compact projection. Stable model context order is base prompt, compact identity core, global rules, project rules, then the generated surface map; project metadata, retrieval results, runtime facts, attachments, tools, and ledgers remain dynamic afterward.

`tool_docs` retrieves Socrates tool-usage guidance, not conversation history. Use `trace_retrieve` for raw conversation/tool provenance, `tool_docs` for tool behavior, `project_docs` for workspace memory/notes, `repo_docs` for repository doctrine, `current_time` for current date/time, and `user_profile` for durable cross-project user profile facts.

`url_fetch` is the exact-URL internet read primitive. It fetches one HTTP(S) URL as bounded text or metadata without crawling links, saving files, or returning binary bodies. Broad web search remains a configured search/MCP/provider capability, not an automatic part of URL fetch.

Primary tool-usage docs are runtime-bundled markdown assets, not inline seed strings. They live in `apps/server/src/memory/defaults/primary/tool_usage/`, are copied into server `dist` during build, and install into `~/.Socrates/tool_usage/` so Socrates can read them through `tool_docs`.

`soul` is the only model-visible reader for `~/.Socrates/identity.md`. It supports `read`, `read_index`, and `read_section` for identity, voice, relationship, operating-principle, safety, and tool/memory-discipline sections. It is read-only: the main agent cannot write this doc through `soul` or generic workspace mutation tools. `user_profile` reads `~/.Socrates/user_profile.md` with the same read/index/section pattern and is also read-only for the main agent. Identity and user-profile edits are backend-memory-agent controlled, evidence-backed, patch-verified, and require the applicable confirmation/update policy before applying. Applied identity updates must create durable notifications for the user.

The `bash` tool id is the only V1 model-visible command execution tool, but product/UI/prompt copy should call it Terminal. It may run git, package managers, test commands, Docker, dev servers, REPLs, prompts, basic TUI commands, and bounded one-off scripts when no exact structured tool exists. Policy decides whether each command is auto-allowed, approval-gated, or denied. Internally it is PTY-backed and platform-native: POSIX on macOS/Linux, ConPTY PowerShell-first on Windows, and cmd fallback. Do not add separate model-visible PowerShell, cmd, terminal, or process tools without updating contracts. Destructive, broad network, install, git mutation, delete, migration, and outside-workspace commands require approval by default.

Use `bash` `list` before complex or ambiguous Terminal work. Every raw `run` completes normally when fast or auto-detaches after the configured foreground threshold into the same named PTY Terminal; it must never be killed or restarted solely to detach. Healthy Terminals referenced by an active/waiting task have no fixed two-hour expiry. Once independent work is exhausted, Socrates must call the separate event-driven `wait` tool rather than polling or emitting a false final answer. `wait` accepts only human Terminal names and requested terminal events, has a short schema-limited reason, and resumes the same task only on a requested event. If a Terminal needs input, only the user may send raw xterm stdin through the frontend; raw stdin stays redacted from model context and persistence.

For interactive user input, use a named `start` Terminal and a portable Node.js or Python stdin program; do not assume Bash-only prompt syntax on a zsh-backed POSIX session. The current Terminal schema/runtime capability block overrides stale memory or prior-chat statements that interaction is unavailable. When `start` returns `awaiting_input`, the completion/failure wait is runtime-enforced so a model cannot accidentally finalize or fail the task while the user is typing. Reconcile durable state after resume only when the result changes the goal, a future-dependent decision, a verified milestone, a blocker/handoff, or the final state.

Main-server close must reject new Terminal operations, abort and drain active turns, wait for in-flight starts, and only then dispose the manager. It must not terminate fully committed independently supervised Terminals, but an interrupted `starting` operation must be physically stopped and persisted instead of escaping as an untracked host. Startup reconciles persisted `starting`, `running`, and `awaiting_input` sessions with the supervisor and requeues an interrupted claimed continuation before ready-task resumption. Explicit stop, conversation deletion, workspace switching, and deliberate supervisor shutdown remain process-lifetime boundaries; a failed physical stop must be recorded as `detached`, never falsely as `stopped`.

Supervisor transport errors must be handled conservatively. Do not kill or replace a supervisor from a single request failure. Supervisors must serialize shutdown behind in-flight starts, refuse new starts after shutdown begins, support targeted host cleanup, and self-expire after a bounded period with no hosts or active starts. Use bounded reconnect attempts, require repeated live-poll failures before declaring loss, persist a compact normalized recovery reason, and wake matching waits as `failed` when the PTY is confirmed uncontrollable. Supervisor sockets are scoped per Socrates home so tests and installations cannot control each other's Terminals.

Workspace-mutating work must be serialized per workspace across concurrent conversations. `edit`, `apply_patch`, `project_docs` edits, `repo_docs` patches, and foreground mutating Terminal commands such as Git branch changes/commits/pushes, package installs, migrations, and file-generating scripts use the shared workspace mutation queue. Read-only commands and background Terminals such as dev servers/watchers must not hold that queue forever.

Terminal commands already start in the active workspace. Commands that begin by changing into a guessed absolute path outside the active workspace, such as `cd /Users/example/project && ...`, must be rejected with a recoverable error. For commands that operate inside a subfolder, Socrates should use the `cwd` input instead of prefixing the command with `cd`. Before Terminal commands create files or directories, Socrates should verify the intended parent directory exists and use an explicit relative path or `cwd` so outputs do not accidentally land in the workspace root. Relative `cd` inside the workspace and absolute paths used as explicit arguments or destinations may still be allowed by policy and approval.

The agent should prefer `read` for file/document/image inspection, `search` for file discovery or content search, and `url_fetch` for exact remote URL reads because those tools provide bounded structured output. This is a preference, not a hard restriction. If those tools fail or give poor output, an approved Terminal fallback such as a local extractor, `cat`, `find`, `grep`, `pdftotext`, a small parser, or a document-render/OCR script may still run. Do not deny a legitimate approved Terminal command solely because a more specialized Socrates tool exists.

Tool outputs must be bounded. `read` uses an estimated `tokenLimit` default of 4,000 tokens and a hard model-requested max of 6,000 estimated tokens across normal files, PDFs, documents, presentations, spreadsheets, SVG text, and other readable formats. `charLimit` remains available for character paging and has a hard cap of 80,000 characters, but effective read output is bounded by both `charLimit` and `tokenLimit`; truncation metadata must make cuts explicit. `search` defaults to at most 20 results and has a hard runtime cap of 50 results; generated/vendor directories such as `.git`, `node_modules`, `dist`, `build`, `.next`, `.turbo`, and `coverage` are skipped by default and warnings must tell the model to narrow noisy searches. Large files, PDFs, documents, slides, command outputs, and trace retrieval results must be paged or summarized instead of dumped wholesale into model context.

Conversation and history text follow a stricter rule than ordinary paged tool reads. Exact user messages, visible assistant answers, explicit constraints, approvals, blockers, and canonical tool evidence are immutable and exactly retrievable. Exact goal/view scoping, finite candidate selection, and pagination select complete source items and never token-slice an individual selected message. Never write `bounded context` alone in architecture, product copy, logs, or handoffs; name the actual operation and whether it changes only the model-visible projection. When assembled model-visible input reaches 170k estimated tokens, the shared runtime automatically summarizes only the oldest completed-turn head into a provenance-linked hidden compaction, preserves approximately 70k of the newest completed Q/A by whole-turn boundary plus the active turn, targets a rebuilt request around 100k, and accepts no result above 120k. If safe compaction fails, the main model is not dispatched above the 170k trigger. Canonical rows are never overwritten, and exact deferred text remains recoverable through trace inspection.

## 11. Dangerous Actions Require Approval

The agent must request user approval before actions that can change the system or consume meaningful resources.

Approval is required for:

- File writes.
- Patch application.
- Package installation.
- Shell commands with side effects.
- Git commits.
- Git pushes.
- Deleting files.
- Moving files.
- Network operations that send workspace content to external services outside the selected model provider flow.

Read-only actions may be allowed automatically depending on policy.

Approval requests and decisions must use schemas from `packages/contracts`.

## 12. No Hidden Side Effects

Functions should make side effects obvious from their name and package.

Bad:

```ts
getProjectInfo() // silently runs git commands and writes cache files
```

Good:

```ts
readProjectInfo()
refreshProjectInfoCache()
```

Side effects must be explicit.

## 13. Prefer Small, Composable Functions

Reusable base functions should be small and organized by responsibility.

Avoid large files that mix:

- Validation.
- Business logic.
- IO.
- UI formatting.
- Provider translation.
- Persistence.

Split by responsibility before the file becomes difficult to reason about.

## 14. Errors Must Be Structured

Cross-boundary errors must use structured error payloads from `packages/contracts`.

Do not throw raw strings across package or WebSocket boundaries.

Errors should include:

- Stable code.
- Human-readable message.
- Optional details.
- Source package when useful.

## 15. Session State Must Be Explicit

Long-running agent work must be represented through explicit session/task state.

The system should be able to answer:

- What session is running?
- What message started it?
- What tools were called?
- What approvals were requested?
- What commands ran?
- What files changed?
- What failed?

No important agent state should exist only in memory if it is needed for recovery, display, or audit.

Only one active turn may run per conversation in V1. This is a per-conversation lock, not a global app lock: different conversations may each run an active turn concurrently while the backend process is alive. The composer must switch from send mode to stop mode while its current conversation has an active turn, and return to send mode after `turn.completed`, `turn.failed`, or `turn.cancelled`.

When a turn is cancelled after assistant text has streamed, Socrates must persist that visible text as a cancelled partial assistant message and carry it forward in later semantic chat history. Historical tool calls, tool results, and reasoning from the cancelled turn remain audit/UI data only and are not blindly loaded into later prompts.

Context compression must preserve this same visible-history rule. Recent real user/assistant messages stay real role-typed messages in model context. Hidden summaries, compaction notes, and context briefs must not be stored as fake user or assistant messages. Raw rows stay in SQLite, and compacted context must point back to turn ids or targeted audit queries whenever precision matters.

Compression should run at provider-call boundaries. Do not compress by mutating in-flight tool execution state. Persist the tool output first, then compact or summarize only the model-facing context before the next model call.

Large-result release is a shared Socrates within-turn model-context policy, not Flow persistence. Each successful individual tool result over 3,000 estimated tokens receives the next turn-local friendly handle (`R1`, `R2`, ...); only qualifying results increment the counter, so the 600th qualifying result is `R600`. After a qualifying tool batch, append one compact hidden reminder naming every new handle once. When Socrates has extracted what it needs and is already requesting another normal tool, it may piggyback `context_disposition({ release: ["R1"] })` in that same response. Release is the only action: there is no keep, distill, or unresolved state. Omission never blocks the normal tools, and the disposition call adds no model inference, is approval-free, and is excluded from functional-tool budgets. Releasing replaces only the current model-visible copy with a tiny receipt and exact-retrieval hint; immutable audit evidence remains available through `trace_retrieve`. Final answers need no release because intermediate tool results are not automatically projected into the next user turn.

The context count used for those decisions must include the exact request being considered for the next provider call: system prompt, visible history, hidden summaries, current-turn tool calls/results, and available tool definitions/schemas. `tokenUsage` remains provider-reported diagnostic/cost usage and must not be substituted for model-facing `contextUsage`.

## 16. Streaming Is Event-Based

Streaming output must use typed events.

This applies to:

- Model deltas.
- Tool progress.
- Shell stdout.
- Shell stderr.
- Transcription progress.
- Read-aloud generation/playback status.
- Feedback creation or updates.
- Approval requests.
- Patch proposals.
- Task completion.

Do not invent separate streaming formats for each feature.

## 17. Voice, Audio, And Feedback Must Be Persisted

Voice input, read-aloud output, and message feedback must use shared contracts, typed events, and database records.

The required model is:

```text
voice input -> transcription -> normal user message
read aloud -> assistant message -> audio output record
feedback -> exact message, turn, or model call being rated
```

Do not hide these flows in frontend-only state.

Do not add large sets of nullable voice/audio/feedback columns to `messages`. Use dedicated tables linked back to messages, turns, model calls, artifacts, and errors.

## 18. Add New Providers Behind The Provider Interface

New model providers must be added as adapters in `packages/providers`.

Direct providers that need official API behavior, such as DeepSeek KV-cache and `reasoning_content` tool-loop continuation, should get a small provider folder under `packages/providers/src/<provider>/` and register through `ProviderRouter`. Do not implement them as one-off server route calls or frontend-specific provider branches.

Provider-specific request-shape compatibility belongs inside `packages/providers`, not in core/server/frontend tool logic. For example, official DeepSeek requires every function tool `parameters` schema to be top-level `type: "object"`, so the DeepSeek adapter may normalize model-visible union schemas into object-shaped provider parameters. Core must still validate actual tool calls against the original strict schemas in `packages/contracts`.

They must not leak provider-specific response shapes into:

- `packages/core`
- `apps/server`
- `apps/web`

If a provider has unique capabilities, expose only the normalized subset first. Add extensions deliberately.

V1 should use direct AI SDK provider packages behind the Socrates provider abstraction. Do not use Vercel AI Gateway as the default provider path.

Local Ollama chat models are a first-class provider adapter path behind `packages/providers`. Discovery must be read-only, must not pull/install/delete models, and should expose only the normalized Socrates model surface first. Ollama-specific request/response shapes must not escape into core, server routes, or frontend components.

## 19. Keep Naming Stable And Boring

Use predictable names.

Examples:

```text
AgentRuntime
CapabilityCatalog
CapabilitySet
ModelProvider
Workspace
ApprovalStore
SessionStore
WebSocketEvent
```

Avoid clever names. The repo should be easy to navigate months later.

## 20. Search Before Adding

Before adding any new:

- Utility.
- Schema.
- Event type.
- Tool.
- Provider helper.
- Workspace operation.

Search the repo first.

Use `rg` or `rg --files` before creating new abstractions.

## 21. Documentation Must Track Architecture

If package responsibilities, event contracts, approval policy, or dependency direction changes, update `context-files/`.

Architecture docs are not decorative. They are working agreements.

## 22. The Default Bias Is Reuse

When implementing a feature, the default path is:

1. Find the existing contract.
2. Find the existing package owner.
3. Add the smallest missing reusable function there.
4. Import it where needed.
5. Avoid one-off local implementations.

If a one-off is unavoidable, leave a short comment explaining why it is intentionally not shared.

## 23. Model-Driven Capabilities Must Be Real Agents

Any serious model-driven capability must follow the shared agent pattern instead of becoming a one-off provider call hidden inside a route, store, or UI handler. `context-files/AGENT_REFACTOR_MANIFESTO.md` defines the mandatory replacement architecture and `context-files/AGENT_CAPABILITY_WORKFLOW.md` defines the mandatory change procedure; both must be read completely and followed for every agent, capability, tool, shared utility, prompt, retrieval, context, provider, or generated tool-documentation change.

Required pattern:

```text
prompt
  -> shared runner
  -> RoleManifest resolved through CapabilityCatalog
  -> scoped CapabilitySet
  -> executor mapping
  -> structured validation
  -> typed events and persistence
```

The target public execution boundary is one provider-neutral `AgentRuntime` entrypoint reused by the interactive main agent and every structured worker. It accepts a typed configuration object rather than positional arguments or boolean combinations: prompt/messages, a role-scoped `CapabilitySet` and executors, multimodal message parts, model/runtime settings, limits, hooks, and a discriminated completion mode (`text`, `structured`, or `streaming_tools_structured_final`). It returns one typed event stream plus one final typed result.

`AgentRuntime` is the single released provider-execution abstraction. `SocratesAgent` owns interactive turn policy while focused internal lifecycle modules own retrieval, deterministic memory selection, tools, ledgers, approvals, and recovery. The same-Socrates goal-resolution phase configures the same definition and prompt core; it is not another agent role. Do not reintroduce a second runner, direct provider orchestration, or divergent behavior behind similarly named wrappers.

The public runtime may remain internally modular. Context assembly, provider iteration, tool execution, approvals, recovery, final validation, and telemetry should stay focused components; one entrypoint does not justify a god class.

This applies to foreground Socrates, model-driven asynchronous Global Memory work, the Skill Writer Agent, user-approved compactors, and future reusable model-driven roles. Deterministic retrieval, memory selection, permission checks, ledger transitions, transactions, and validation remain ordinary catalogued services rather than fake agents. Backend stores may coordinate, persist, validate, and apply approved effects, but they must not own private model orchestration for agent-like work.

This is a non-negotiable creation invariant for every new model-driven agent, router, or worker. Before implementation or review can be considered complete, all of the following must be true:

- The prompt lives in the owning package's designated `prompts/` folder; do not leave production system prompts inline in routes, stores, runtimes, or orchestration helpers.
- The capability has a clearly named agent/router module owned by the correct package and initialized through the shared runner. Do not call `provider.generateStructured()` directly from a feature runtime as a substitute for an agent.
- Input, output, and cross-boundary contracts use strict Zod schemas in `packages/contracts` when shared between packages or persisted; package-private schemas must still be strict, named, and reusable.
- The runner receives an explicitly scoped `CapabilitySet` resolved from a declared `RoleManifest`, plus its executor mapping. A role that needs no model tools resolves to an intentionally empty set; it does not invent tools or bypass the catalog.
- Structured output gets strict validation, one bounded repair attempt where recovery is safe, and an explicit bounded fallback or typed failure policy.
- Provider, auth mode, model, and thinking settings resolve through a dedicated worker role whenever the capability is independently configurable. Do not alias an unrelated worker's setting to avoid adding the role.
- Model calls, usage, failures, and durable effects use the repository's typed telemetry, event, persistence, and error paths.
- Focused tests cover the prompt/runner contract, strict invalid-output behavior and repair/fallback path, worker settings API, and any settings UI row.

Search for and reuse the closest compliant agent before creating any of these pieces. An existing non-compliant component is technical debt to correct, never precedent for another shortcut. Reviewers must reject a new agent/router/worker that does not satisfy this checklist.

Agent-to-agent communication should start simple and reusable. The accepted first protocol is a backend-backed notepad:

- Socrates creates `memory_note` with only a human `note` and optional `importance`.
- The backend attaches current-turn lookup refs such as conversation id, message id, turn id, source project, workspace path when available, and a default project-local skill-scope hint.
- The receiving agent reads at most 10 numbered notes through an inbox-style `memory_notes` interface, classifies each lead before acting, chains into `trace_retrieve` when exact evidence is needed, and marks the note done with `outcome` plus a one-line `resolution` after applying, finding the memory already represented, proposing a skill, or deliberately skipping it.

Do not expose backend lookup refs as fields that the sending model has to author. They are storage and retrieval plumbing, not a human-facing contract.

Global memory must stay global. User profile `active_context` stores only currently useful user-life context that can transfer across projects. Project-specific active context belongs in `.socrates/PROJECT_NOTES.md` under `active_context`; if the Memory Agent receives a project-local note, it should skip global writes and record that reason in the note resolution.

Skill writing follows the same rule. The Memory Agent may decide that an approved skill create/update should happen, chooses project/global scope, and uses human-facing skill names. Repeated subject matter is not a skill; repeated ordered work with triggers, phases, decision gates, corrections, and verification is. Socrates-originated notes default to project scope unless cross-project evidence or a global collaboration procedure justifies global scope. Every proposal must carry inspected source-turn evidence. Final `SKILL.md` authoring belongs to the Skill Writer Agent. `skill_write` is a narrow scoped save/validation tool, not another model or hidden fourth agent; it must reject no-op updates and unsafe supporting-file paths. The backend determines proposal operation from canonical target existence, so an existing skill is always an update even if the model mistakenly asks to create it. Main Socrates must run `skills list` and describe the best exact match before domain tools for ordered multi-step, verification/review, and closure/handoff workflows; generic tool knowledge is not a substitute for checking learned user-specific gates.

Pre-made skill import is not skill writing and must not invoke the Skill Writer. Accept one portable ZIP only through staged preview and explicit user commit; parse standards-compatible YAML, preserve package files, never execute during inspection/install, never honor `allowed-tools` as approval, cap archive/extracted/file counts and sizes, reject traversal/symlinks/encryption/multiple roots/reserved provenance files, and install through atomic same-root replacement with rollback. Disabled skills must be excluded from model discovery while remaining visible to management UI.

## 24. One Global Goal-Centric Socrates

`context-files/FLOW_NORTH_STAR.md` is the product-intent authority. `context-files/UNIFIED_SOCRATES_LIFECYCLE.md` is the detailed lifecycle and cleanup authority. `context-files/AGENT_REFACTOR_MANIFESTO.md` is the normative authority for rebuilding the agent/runtime/capability boundary, and `context-files/AGENT_CAPABILITY_WORKFLOW.md` is its mandatory operational workflow. Read them completely before related work. `context-files/V2_FLOW_ARCHITECTURE.md` and historical phase reports record released implementation and migration constraints; they do not override the global goal-centric target.

Required boundary:

- Preserve existing Classic, project, and V2 data non-destructively. Compatibility records are migration reality, not target user concepts or permission to expand duplicate semantic state.
- The landing page opens one seamless Socrates. The target header exposes Paths, visible Selected/Full access, and Settings. The collapsible sidebar groups exact Q&A by goals and has no required project hierarchy.
- Paths and connected resources define authorization. Goals define coherent outcomes. Tasks are individual user requests inside goals. Every message creates a task; only a genuinely independent outcome creates a goal.
- Every turn persists the exact message, retrieves goal and memory candidates concurrently, performs one same-Socrates decision (`current`, retrieved older goal, `new`, or `clarify`), deterministically selects exact memory, runs the shared loop, commits answer/task/goal/capsule state atomically, then enriches memory asynchronously.
- The current goal capsule and latest exact exchange are always supplied independently of retrieval score. Older candidate capsules are numbered, human-readable, and backend-resolved.
- Do not retain a separate Goal Router agent, `goal_search` tool loop, model-driven pre-turn/post-turn Memory Router, independent title agent, or another finalization authority.
- Hybrid retrieval ranks candidates and exact sources. It never decides intent. Deterministic post-binding memory selection owns authorization, scope, provenance, relevance, and duplication filters.
- The goal capsule is versioned structured live state with exact source anchors. It does not replace exact goal history. The backend ledger stores the current pointer and capsule references, not transcript/evidence bodies, and is not a model tool.
- Selected messages remain exact whole items in canonical storage and exact retrieval. Automatic oldest-head model-context compaction runs at the shared 170k trigger, keeps an approximately 70k newest whole-turn suffix, targets roughly 100k, rejects results above 120k, and never overwrites canonical evidence.
- The same main Socrates owns task tools, approvals, Terminal/wait continuation, reconciliation, and the validated substantive answer. It cannot rebind the task after work begins.
- One transaction persists the validated answer, task outcome, verified goal progress/state, capsule version, current-goal pointer, usage, and evidence links before publication.
- Reuse one agent runtime, capability catalog, provider layer, retrieval foundation, tool contract, permission system, Terminal lifecycle, validation path, and asynchronous enrichment architecture.
- Full filesystem access remains visible, explicit, and revocable and never waives destructive-action or external-side-effect approvals. Connected mail, calendar, browser, cloud, and communication accounts remain separately permissioned.
- Keep released transport, speech, provider, and persistence compatibility safe while migrating, but do not let those adapters define new semantic authority.

The shorthand is:

```text
one global Socrates
one goal-centric exact memory
one shared execution and retrieval architecture
non-destructive migration from released surfaces
```

## 25. Viewport Shells Stay Fixed And Lists Scroll Independently

This is a hard design invariant for every Socrates page, drawer, sidebar, inspector, and management surface.

- Persistent page chrome must not be placed inside the document or list scroll region. Headers, titles, primary controls, composers, and footers stay fixed within their viewport shell; only the intended middle content region scrolls.
- Important state and navigation controls must never disappear merely because their associated content scrolls. Keep them outside the scroll region or make them sticky within that region; examples include historical/current-state indicators, return/back controls, active status, and required actions.
- Sidebars have an explicit fixed width and `overflow: hidden` outer shell. Their section title and navigation controls are non-scrolling. The active names/items list owns the bounded `overflow-y: auto` region.
- The target collapsible sidebar is one goal hierarchy: current goal first, then searchable earlier goals, with exact Q&A pairs nested beneath the selected goal. It contains no required Projects or Conversations level.
- Paths, access mode, and Settings remain fixed header controls rather than sidebar navigation levels. Their panels may scroll internally without moving the main composer or goal history.
- Released Classic/project navigation may remain inside an explicit compatibility surface during migration, but it must not constrain the target global shell or reintroduce a second semantic history.
- Browser verification for any shell/sidebar change must prove that scrolling the active list does not move the shell heading, fixed controls, main workspace, or composer, at both desktop and narrow responsive widths.
- During a live seamless turn, exactly one fixed-height human-facing activity sentence appears beneath the prominent orb. Each new phase/tool status replaces that sentence in place; statuses never accumulate into a vertical list, tag collection, or mini trace.
- The backend/runtime owns the concise activity label from typed execution state. The frontend must not derive agent meaning from arbitrary text or render raw ids, malformed tool syntax, `undefined`, secrets, or unrestricted reasoning as the label. Parallel work is summarized into the same one-line slot.
- Approval, credential, Terminal-input, and other user-action states retain their full interactive components. They must not be hidden behind the one-line activity slot.
- After the validated final answer is durably saved, the answer becomes the foreground reading layer, the orb recedes to its subtle background state, the live sentence disappears, and persisted reasoning/tool history is represented by one collapsed expandable disclosure. Historical turns do not replay live activity.
- Orb/status/answer transitions must preserve layout stability, keep the composer fixed, and honor reduced-motion preferences.
