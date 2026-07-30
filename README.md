<p align="center">
  <img src="./apps/web/public/brand/socrates-logo.png" width="132" alt="Socrates logo" />
</p>

<h1 align="center">Socrates</h1>

<p align="center">
  <strong>Your local-first AI co-pilot for real project work.</strong>
</p>

<p align="center">
  Local data. Real tools. Traceable results.
</p>

---

Socrates is a local-first coding and investigation workspace that keeps long-running goals coherent across exact exchanges. You can work with local tools, inspect evidence, and return to any goal without making projects or conversations first.

## What Socrates Can Do

- Start work in the browser with one command.
- Maintain global goals, exact Q&A history, and persistent recovery state.
- Run shell, search, patch, file, git, and workspace tools safely.
- Call AI models for coding, analysis, and planning in a provider-aware stack.
- Stream live tool use, output, errors, and assistant responses.
- Compress context for long sessions while preserving key details.
- Preserve context evidence with quote-friendly search and turn-aware trace retrieval.
- Keep a local SQLite trail of events, tools, messages, and run metadata.
- Download and run signed-free npm runtime bundles from GitHub Releases.

## Current Project State

- Current GitHub runtime release: **v0.1.19**. The direct global Socrates cutover in this checkout is active development and is not a release claim.
- Runtime availability for macOS 15+ (arm64/x64) and Windows x64.
- The product entry is `/welcome` with one **Open Socrates** action to `/chat`.
- `/chat` is one global goal-centric shell: fixed `Paths | Access | Settings`, fixed composer, one current exact exchange, and a collapsible goal hierarchy of exact Q&A pairs.
- One durable global Socrates state owns the foreground goal and active root task. Goals own versioned capsules; root tasks own messages, tools, Terminal lineage, usage, and evidence.
- The same provider-neutral Socrates agent owns semantic goal choice, tools, typed interactions, Terminals, MCP servers, skills, deterministic exact-memory selection, central global/resource knowledge, and the Global Memory Agent. Repository-local `.socrates` is not a runtime authority.
- Historical exchange selection is passive. The next send always returns to the canonical live tail before Socrates decides whether the request continues the current goal, resumes an older goal, creates a new goal, or needs clarification.
- The shared voice setting defaults to **Not configured**. Offline packs download only after the user presses Install; transcripts append to the unsent draft and never auto-send.
- Ollama can serve local chat models from the normal model picker when the local Ollama runtime is reachable.
- Trace retrieval upgraded for broader match windows and exact quote context.
- Duplicate tool-call handling added to avoid repeated identical retrieval passes in one turn.
- Context compression now uses a first-class structured `CompressorAgent`.
- Socrates now enforces repo-docs preflight before write/approval-required mutations and requires durable project memory closure after meaningful work.

## Quick Start

Install and run (no setup):

```bash
npx @socrates-ai/cli
```

Or install globally:

```bash
npm install -g @socrates-ai/cli
socrates
```

When testing the CLI from this repo, use the local bin directly:

```bash
node apps/cli/bin/socrates.mjs --version
```

## Local Development

Run the normal backend and web frontend directly. Native desktop/Tauri delivery has been discarded and is not a supported development or release path.

Terminal 1:

```bash
pnpm install
pnpm --filter @socrates/server dev
```

Terminal 2:

```bash
pnpm --filter web dev
```

Useful build targets:

```bash
pnpm runtime:build      # build the normal backend/frontend runtime
pnpm runtime:archive    # generate runtime zip
pnpm runtime:smoke      # verify packaged runtime retrieval dependencies
```

## Runtime Location

App data defaults to:

```text
~/.Socrates/socrates.sqlite
```

Use `SOCRATES_HOME` to point the workspace to a custom root or `SOCRATES_DB_PATH` for a specific SQLite file.

## Stack at a Glance

```text
apps/
  web/       Next.js global goal interface and settings
  server/    Fastify APIs, WebSockets, tool coordination, persistence

packages/
  core/      agent orchestration and context logic
  workspace/ local operations and tool adapters
  providers/ model integrations and token handling
  contracts/ schemas for events and tool contracts
  shared/    utility types and helpers
```

## Notes

- Node.js 20+ is required.
- Runtime downloads and app data are kept local.
- Provider credentials stay outside message/event payloads.
