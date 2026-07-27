import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, extname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import process from "node:process"

const root = process.cwd()
const expectedRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
if (resolve(root) !== expectedRoot) throw new Error(`Agent architecture check must run from ${expectedRoot}.`)

const writeMode = process.argv.includes("--write")
const core = await import(`${pathToFileURL(resolve(root, "packages/core/dist/index.js")).href}?architecture-check=${Date.now()}`)
const definitions = core.phaseOneAgentDefinitionInventory()
const capabilities = core.capabilityInventory()
const modelTools = capabilities.filter((capability) => capability.kind === "model_tool")
const commands = capabilities.filter((capability) => capability.kind === "typed_user_command")
const forbiddenProductionPatterns = [
  ["Legacy ToolRegistry authority", /\b(?:ToolRegistry|create[A-Za-z0-9_]*ToolRegistry)\b/],
  ["Shadow model input schema", /\b(?:modelInputSchema|[A-Za-z0-9_]+ToolModelInputSchema|normalizeBashModelInput)\b/],
  ["Provider tool-schema copy", /\btoolJsonSchemas\b/],
  ["Ad hoc dynamic tool attachment", /\bdynamicTools\b|\bgetDynamicToolDefinitions\b/],
  ["Provider tool-name branch", /\bdefinition\.name\s*===/],
]

const executionOwners = [
  { id: "socrates-main", path: "packages/core/src/agent/SocratesAgent.ts", definitionId: "socrates-main", status: "canonical" },
  { id: "skill-writer", path: "apps/server/src/services/store/skillWriterAgentRunner.ts", definitionId: "skill-writer", status: "canonical" },
  { id: "global-memory", path: "apps/server/src/services/store/memoryAgentRunner.ts", definitionId: "global-memory", status: "canonical" },
  { id: "context-compressor", path: "packages/core/src/agent/CompressorAgent.ts", definitionId: "socrates-context-compactor,memory-context-compactor,context-anchor-repair", status: "canonical" },
  { id: "title-generator", path: "packages/core/src/agent/TitleGeneratorAgent.ts", definitionId: "title-generator", status: "canonical" },
  { id: "soul-confirmation", path: "packages/core/src/agent/SoulConfirmationAgent.ts", definitionId: "soul-confirmation", status: "canonical" },
]

const roleMatrix = definitions.map((definition) => {
  const resolved = core.capabilityCatalog.resolve(core.phaseOneAgentDefinitions.find((entry) => entry.id === definition.id).roleManifest)
  return {
    definitionId: definition.id,
    role: definition.role,
    capabilityIds: definition.capabilityIds,
    dynamicCapabilityPrefixes: definition.dynamicCapabilityPrefixes,
    modelTools: resolved.modelDefinitions().map((tool) => tool.name),
  }
})

const generatedFiles = new Map([
  ["architecture/agent-definitions.generated.json", json({
    schemaVersion: 2,
    generatedFrom: "packages/core/src/agent/agentDefinitions.ts",
    phase: "phase-2-shared-capability-catalog",
    definitions,
    executionOwners,
  })],
  ["architecture/capabilities.generated.json", json({
    schemaVersion: 1,
    generatedFrom: "packages/core/src/capabilities/CapabilityCatalog.ts",
    capabilities,
  })],
  ["architecture/role-capability-matrix.generated.json", json({
    schemaVersion: 1,
    generatedFrom: "packages/core/src/agent/agentDefinitions.ts",
    roles: roleMatrix,
  })],
  ["architecture/provider-tool-schemas.generated.json", json({
    schemaVersion: 1,
    generatedFrom: "packages/core/src/capabilities/providerProjection.ts",
    tools: modelTools.map((capability) => ({
      capabilityId: capability.id,
      name: capability.modelToolName,
      schema: capability.providerSchema,
    })),
  })],
  ["architecture/capability-executor-tests.generated.json", json({
    schemaVersion: 1,
    generatedFrom: "packages/core/src/capabilities/CapabilityCatalog.ts",
    capabilities: capabilities.map((capability) => ({
      id: capability.id,
      kind: capability.kind,
      executorBinding: capability.executorBinding,
      implementationPath: capability.source.implementationPath,
      callers: capability.source.callers,
      tests: capability.source.tests,
      status: capability.source.status,
    })),
  })],
  ["architecture/runtime-mcp-capabilities.generated.json", json({
    schemaVersion: 1,
    generatedFrom: "packages/mcp/src/index.ts",
    registrationContract: "DynamicToolCapabilityRegistration",
    runtimeInventoryApi: "CapabilityCatalog.runtimeInventory",
    idPrefix: "dynamic.mcp.",
    modelNamePrefix: "mcp__",
    executionBinding: "mcp_dynamic",
    directFallbackExecutionAllowed: false,
  })],
])

for (const [path, content] of generatedToolDocs(capabilities)) generatedFiles.set(path, content)
for (const [path, content] of generatedFiles) await writeOrCheck(path, content)

assertUnique(definitions.map((definition) => definition.id), "Agent definition ids")
assertUnique(capabilities.map((capability) => capability.id), "Capability ids")
assertUnique(commands.map((command) => command.executorBinding), "Typed user command bindings")
if (modelTools.length !== 28) throw new Error(`Expected 28 static model-tool capabilities, found ${modelTools.length}.`)
if (commands.length !== 24) throw new Error(`Expected 24 typed user-command capabilities, found ${commands.length}.`)
for (const kind of ["model_tool", "automatic_retrieval", "structured_worker", "context_stage", "deterministic_authority", "typed_user_command"]) {
  if (!capabilities.some((capability) => capability.kind === kind)) throw new Error(`Capability kind ${kind} is missing.`)
}

for (const definition of core.phaseOneAgentDefinitions) {
  const resolved = core.capabilityCatalog.resolve(definition.roleManifest)
  if (JSON.stringify(resolved.capabilities.map((capability) => capability.id)) !== JSON.stringify(definition.roleManifest.capabilityIds)) {
    throw new Error(`Role manifest ${definition.id} drifted from CapabilityCatalog resolution.`)
  }
  const names = resolved.modelDefinitions().map((tool) => tool.name)
  assertUnique(names, `${definition.id} model tool names`)
}

for (const capability of capabilities) {
  if (!capability.executorBinding) throw new Error(`Capability ${capability.id} has no executor binding.`)
  if (!capability.hasInputSchema || !capability.hasResultSchema) throw new Error(`Capability ${capability.id} is missing a canonical input or result schema.`)
  for (const path of [
    capability.source.definitionPath,
    capability.source.implementationPath,
    ...capability.source.callers,
    ...capability.source.tests,
  ].filter(Boolean)) await requirePath(path, capability.id)
  if (capability.kind === "model_tool" && capability.providerSchema?.type !== "object") {
    throw new Error(`Model tool ${capability.id} does not expose a top-level object provider schema.`)
  }
}

const expectedCommands = [
  "chat.message.send", "chat.turn.cancel", "chat.conversation.subscribe", "chat.conversation.unsubscribe",
  "approval.decide", "credential.input.submit", "terminal.stop", "terminal.input", "terminal.resize", "terminal.rename", "feedback.submit",
  "v2.flow.subscribe", "v2.flow.unsubscribe", "v2.message.send", "v2.routing.clarification.respond", "v2.focus.update",
  "v2.turn.cancel", "v2.approval.decide", "v2.feedback.submit", "v2.credential.input.submit",
  "v2.terminal.stop", "v2.terminal.input", "v2.terminal.resize", "v2.terminal.rename",
].sort()
if (JSON.stringify(commands.map((command) => command.executorBinding).sort()) !== JSON.stringify(expectedCommands)) {
  throw new Error("Typed user-command inventory drifted from the Classic and Flow protocol boundary.")
}

const productionRoots = [
  "packages/contracts/src",
  "packages/core/src",
  "packages/mcp/src",
  "packages/providers/src",
  "packages/workspace/src",
  "apps/server/src",
  "apps/web/src",
].map((path) => resolve(root, path))
const productionFiles = (await Promise.all(productionRoots.map(listSourceFiles))).flat()
const productionSources = await readSources(productionFiles)
const relativePath = (path) => relative(root, path).replaceAll("\\", "/")

const toolSources = productionSources.filter(({ path }) => relativePath(path).startsWith("packages/core/src/tools/") && relativePath(path).endsWith("Tool.ts"))
const discoveredToolCounts = new Map()
for (const { path, source } of toolSources) {
  const count = [...source.matchAll(/^export const [A-Za-z0-9_]+Tool(?::|\s*=)/gm)].length
  if (count) discoveredToolCounts.set(relativePath(path), count)
}
const catalogToolCounts = new Map()
for (const capability of modelTools) {
  catalogToolCounts.set(capability.source.definitionPath, (catalogToolCounts.get(capability.source.definitionPath) ?? 0) + 1)
}
if (JSON.stringify([...discoveredToolCounts].sort()) !== JSON.stringify([...catalogToolCounts].sort())) {
  throw new Error(`Static tool export inventory drift. Discovered ${JSON.stringify([...discoveredToolCounts])}; cataloged ${JSON.stringify([...catalogToolCounts])}.`)
}

for (const owner of executionOwners) {
  const source = await readFile(resolve(root, owner.path), "utf8").catch(() => "")
  if (!source) throw new Error(`Agent execution owner is missing: ${owner.path}.`)
  if (owner.status.startsWith("legacy_") && !source.includes("new AgentRuntime")) {
    throw new Error(`Legacy debt ${owner.id} changed; remove its inventory row only with the owning lifecycle cutover.`)
  }
}
const discoveredExecutionOwners = productionSources
  .filter(({ path, source }) =>
    /export class (?:Socrates|Compressor|GoalRouter|MemoryRouter|TitleGenerator|SoulConfirmation)Agent\b/.test(source)
    || /export const run(?:MemoryAgent|SkillWriter)Turn\b/.test(source),
  )
  .map(({ path }) => relativePath(path))
  .sort()
const inventoriedExecutionOwners = [...new Set(executionOwners.map((owner) => owner.path))].sort()
if (JSON.stringify(discoveredExecutionOwners) !== JSON.stringify(inventoriedExecutionOwners)) {
  throw new Error(`Agent execution-owner inventory drift. Discovered [${discoveredExecutionOwners.join(", ")}], inventoried [${inventoriedExecutionOwners.join(", ")}].`)
}

const runtimeOwners = productionSources.filter(({ source }) => /export class AgentRuntime\b/.test(source))
if (runtimeOwners.length !== 1 || relativePath(runtimeOwners[0].path) !== "packages/core/src/agent/AgentRuntime.ts") {
  throw new Error(`Expected one AgentRuntime owner, found: ${runtimeOwners.map(({ path }) => relativePath(path)).join(", ") || "none"}.`)
}

for (const { path, source } of productionSources) {
  const file = relativePath(path)
  const code = stripCommentsAndStrings(source)
  if (/(?:\bprovider|\.provider)\.(?:stream|generateStructured)\s*(?:<[^>]+>)?\s*\(/.test(code)
    && file !== "packages/core/src/agent/AgentRuntime.ts"
    && !file.startsWith("packages/providers/src/")) {
    throw new Error(`Direct model-provider execution outside AgentRuntime: ${file}.`)
  }
  if (/\bprepareContextForModelCall\s*\(/.test(code) && !["packages/core/src/agent/ContextPipeline.ts", "packages/core/src/context/contextCompression.ts"].includes(file)) {
    throw new Error(`Context preparation bypasses ContextPipeline: ${file}.`)
  }
  for (const [label, pattern] of forbiddenProductionPatterns) {
    if (pattern.test(code)) throw new Error(`${label} remains in production source: ${file}.`)
  }
}

const auxiliaryFiles = (await listSourceFiles(resolve(root, "scripts"))).filter((path) => relativePath(path) !== "scripts/check-agent-architecture.mjs")
for (const { path, source } of await readSources(auxiliaryFiles)) {
  const code = stripCommentsAndStrings(source)
  for (const [label, pattern] of forbiddenProductionPatterns) {
    if (pattern.test(code)) throw new Error(`${label} remains in executable script: ${relativePath(path)}.`)
  }
}

for (const migratedCaller of [
  "packages/core/src/agent/TitleGeneratorAgent.ts",
  "packages/core/src/agent/SoulConfirmationAgent.ts",
  "packages/core/src/agent/CompressorAgent.ts",
  "apps/server/src/services/store/memoryAgentRunner.ts",
]) {
  const source = await readFile(resolve(root, migratedCaller), "utf8")
  if (!source.includes("AgentInstance")) throw new Error(`${migratedCaller} must bind its AgentDefinition through AgentInstance.`)
  if (source.includes("new AgentRuntime")) throw new Error(`${migratedCaller} still constructs AgentRuntime directly.`)
}

if (productionSources.some(({ source }) => source.includes("systemPromptOverride"))) {
  throw new Error("Ad hoc Socrates systemPromptOverride remains reachable in production source.")
}
const corePublicEntry = await readFile(resolve(root, "packages/core/src/index.ts"), "utf8")
if (/\b(?:prepareContextForModelCall|precomputeContextSnapshot)\b/.test(corePublicEntry)) {
  throw new Error("Legacy raw context-preparation functions remain exported from the public core entrypoint.")
}

process.stdout.write(`Agent architecture Phase 2 OK: ${definitions.length} agents, ${capabilities.length} capabilities, ${modelTools.length} static tools, ${commands.length} typed commands.\n`)

function generatedToolDocs(inventory) {
  const groups = new Map()
  for (const capability of inventory.filter((entry) => entry.kind === "model_tool" && !entry.source.status.startsWith("legacy_"))) {
    for (const outputPath of capability.documentationPaths) {
      const path = `apps/server/src/memory/defaults/primary/tool_usage/${outputPath}`
      const entries = groups.get(path) ?? []
      entries.push(capability)
      groups.set(path, entries)
    }
  }
  return new Map([...groups].map(([path, entries]) => {
    const title = entries.length > 1
      ? entries.map((entry) => entry.modelToolName).join(" and ")
      : entries[0]?.documentationTitle ?? entries[0]?.modelToolName
    const purpose = entries.map((entry) => `- \`${entry.modelToolName}\`: ${entry.description}`)
    const routing = [
      ...entries.map((entry) => `- Use \`${entry.modelToolName}\` when the active task requires its cataloged ${entry.policy.approval === "automatic" ? "read/retrieval" : "mutation/execution"} capability.`),
      ...entries.flatMap((entry) => entry.documentationGuidance.slice(1).map((guidance) => `- ${guidance}`)),
    ]
    const inputs = entries.map((entry) => `- \`${entry.modelToolName}\` uses the one canonical schema owned by \`${entry.id}\`; send only documented fields and do not add aliases or placeholder values.`)
    const workflow = entries.map((entry, index) => `${index + 1}. Select \`${entry.modelToolName}\` only for the behavior described above, pass an exact valid input, and use its persisted result as evidence before continuing.`)
    const lines = [
      "---",
      "socrates_doc: tool_doc",
      "schema_version: 1",
      "owner_tool: tool_docs",
      "scope: global",
      "index_tags: [tool_usage]",
      "---",
      "",
      "<!-- Generated by scripts/check-agent-architecture.mjs from CapabilityCatalog. Do not edit by hand. -->",
      `# ${title} Usage Guide`,
      "",
      '<!-- socrates:section id="purpose" kind="purpose" tags="tools" -->',
      "## Purpose",
      "",
      ...purpose,
      '<!-- /socrates:section -->',
      "",
      '<!-- socrates:section id="when_to_use" kind="routing" tags="tools" -->',
      "## When To Use",
      "",
      ...routing,
      '<!-- /socrates:section -->',
      "",
      '<!-- socrates:section id="inputs" kind="schema" tags="tools" -->',
      "## Inputs",
      "",
      ...inputs,
      '<!-- /socrates:section -->',
      "",
      '<!-- socrates:section id="workflow" kind="workflow" tags="tools" -->',
      "## Workflow",
      "",
      ...workflow,
      '<!-- /socrates:section -->',
      "",
      '<!-- socrates:section id="failure_handling" kind="recovery" tags="tools" -->',
      "## Failure Handling",
      "",
      "- If input validation fails, correct the call against the canonical schema; do not guess, normalize, or silently drop fields.",
      "- If execution returns a typed error, preserve it as evidence and either correct the call or explain the blocker.",
      "- Never bypass the CapabilityCatalog or call a provider, executor, or dynamic MCP child through a parallel path.",
      '<!-- /socrates:section -->',
      "",
    ]
    return [path, `${lines.join("\n").trim()}\n`]
  }))
}

async function writeOrCheck(path, expected) {
  const absolute = resolve(root, path)
  if (writeMode) {
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, expected, "utf8")
    return
  }
  const current = await readFile(absolute, "utf8").catch(() => "")
  if (current !== expected) throw new Error(`Generated architecture artifact is stale: ${path}. Run pnpm generate:agent-architecture.`)
}

async function requirePath(path, capabilityId) {
  await access(resolve(root, path)).catch(() => {
    throw new Error(`Capability ${capabilityId} references missing path ${path}.`)
  })
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`)
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:\\.|[^"\\])*"/g, "")
    .replace(/'(?:\\.|[^'\\])*'/g, "")
    .replace(/`(?:\\.|[^`\\])*`/g, "")
}

async function readSources(paths) {
  return Promise.all(paths.map(async (path) => ({ path, source: await readFile(path, "utf8") })))
}

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const paths = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (["dist", "test", "__tests__", "node_modules"].includes(entry.name)) continue
      paths.push(...await listSourceFiles(path))
      continue
    }
    if (!entry.isFile() || ![".ts", ".mjs"].includes(extname(entry.name)) || entry.name.endsWith(".test.ts")) continue
    paths.push(path)
  }
  return paths
}
