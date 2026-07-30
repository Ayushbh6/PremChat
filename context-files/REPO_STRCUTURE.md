# Socrates Repository Structure

This document maps current production authority. `GLOBAL_SOCRATES_NORTH_STAR.md` owns product intent; `UNIFIED_SOCRATES_LIFECYCLE.md` owns the exact turn/goal lifecycle; `AGENT_REFACTOR_MANIFESTO.md` and `AGENT_CAPABILITY_WORKFLOW.md` own architecture and change procedure.

## Top level

```text
apps/
  web/       Next.js global shell and redirects
  server/    Fastify HTTP/WebSocket runtime and SQLite authority
  desktop/   desktop packaging/launcher
  cli/       CLI distribution
packages/
  contracts/ executable schemas and shared types
  core/      one provider-neutral agent runtime, prompts, capabilities, retrieval/context logic
  providers/ normalized model-provider adapters
  workspace/ structured filesystem tools and access enforcement
  mcp/       MCP integration
  shared/    ids, errors, common utilities
context-files/ maintainer architecture/product authority
scripts/       builds, checks, evals, packaging
```

## Global web shell

```text
apps/web/src/app/welcome/
apps/web/src/app/chat/
apps/web/src/components/socrates/
  SocratesApp.tsx
  SocratesHeader.tsx
  GoalSidebar.tsx
  FocusViewport.tsx
  LivingSphere.tsx
  WorkDisclosure.tsx
  LiveNotes.tsx
  SocratesComposer.tsx
apps/web/src/lib/socrates/
  api.ts
  socket.ts
  reducer.ts
  presentation.ts
  noteLayout.ts
  useSocratesRuntime.ts
```

Legacy project/seamless pages are redirect stubs. The old alternate workspace/components/stores are deleted. Shared low-level chat, settings, memory, MCP, speech, and Terminal components remain only where the global shell or non-chat management screens reuse them.

## Global server surface

```text
apps/server/src/routes/socratesRoutes.ts
apps/server/src/services/socrates/
  socratesStore.ts
  socratesWorkingContext.ts
  globalSocratesMigration.ts
apps/server/src/v2/
  runtime.ts
  websocket.ts
  subscriptions.ts
  goalLifecycleCoordinator.ts
  toolExecutors.ts
  terminalRuntime.ts
  liveActivity.ts
```

The `v2` directory/table/type prefix is physical lineage retained to avoid a destructive all-at-once storage rename. It is not a second product runtime. Active routes and events are `/api/socrates/*` and `socrates.*`; the removed container table, scoped routes, UI, stores, subscriptions, feature flag, and ids do not exist.

`GlobalSocratesStore` owns the one global state, goals, exact task/exchange reads, event persistence/replay, tools, approvals, Terminal, deletion, and atomic finalization boundary. `SocratesStore` remains the shared lower-level resource, provider settings, access, memory, retrieval, and project-document service.

## Contracts

```text
packages/contracts/src/socrates.ts
packages/contracts/src/socratesPresentation.ts
packages/contracts/src/filesystemAccess.ts
packages/contracts/src/agentRuntime.ts
packages/contracts/src/tools.ts
```

`socrates.ts` owns the global HTTP/WebSocket/domain projections. Provider projection, runtime validation, persistence, and frontend use the same strict terminal answer schema.

## Agent runtime

```text
packages/core/src/agent/
  agentDefinitions.ts
  AgentInstance.ts
  AgentRuntime.ts
  SocratesAgent.ts
  ContextPipeline.ts
  socratesFinalOutput.ts
packages/core/src/capabilities/CapabilityCatalog.ts
packages/core/src/prompts/socratesPrompt.ts
packages/core/src/prompts/socratesGoalResolutionPrompt.ts
packages/core/src/context/
packages/core/src/retrieval/
```

There is one main Socrates definition/runtime. Goal resolution is a zero-tool phase of that same definition. Goal, memory, and capability candidates are retrieved in parallel; exact memory selection is deterministic after binding. No Goal Router agent, Memory Router, detached draft/finalizer, or provider-specific agent loop exists.

## Provider layer

`packages/providers` normalizes OpenAI/ChatGPT subscription, OpenRouter, Google, native DeepSeek, and Ollama behind `ModelProvider`. OpenRouter with ordinary tools receives the canonical terminal schema as an internal provider-native submission tool; the adapter immediately normalizes it to answer text and never emits it as a capability call.

## Filesystem and Terminal

`apps/server/src/services/store/accessStore.ts` owns global access and immutable task snapshots. `packages/workspace/src/tools/common.ts` owns canonical/symlink-safe structured path resolution. Terminal supervision remains under server WebSocket/runtime services and launches only through the native containment adapter after policy evaluation.

## Memory, resources, skills, and MCP

Confirmed resources, bindings, and typed versioned global/resource knowledge are central database records. Global identity/profile are read only to main Socrates; `memory_note` proposes durable curation. `capability_manager` owns global or bound-resource skill/MCP mutation through the shared catalog/service. Generic edit cannot write skill files.

## Persistence and migrations

`apps/server/src/db/schema.ts` is schema authority. The production cutover archives and verifies the whole released installation, creates the compact schema at a temporary path, seeds only accepted global knowledge and user setup, then swaps atomically. Released work history is not imported.

## Tests

- Contract tests live beside `packages/contracts`.
- Agent/provider tests live beside `packages/core` and `packages/providers`.
- Server store/route/migration/runtime/absence tests live under `apps/server/src/test` and focused service directories.
- Web reducer/presentation/layout and composer tests live under `apps/web/src/lib`.
- Real provider scripts use explicit disposable `SOCRATES_HOME`.
- Browser E2E uses isolated DB/workspace/ports and verifies visible state plus persisted evidence.

## No-shadow rule

Before creating a file, search for the canonical owner. Update it first and remove superseded code. A change is incomplete if it leaves a second schema, runtime, registry, retrieval path, pointer, container, UI shell, or generated guidance copy.
