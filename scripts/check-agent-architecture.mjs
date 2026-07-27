import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import process from "node:process"

const root = process.cwd()
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const expectedRoot = resolve(scriptDirectory, "..")
if (resolve(root) !== expectedRoot) {
  throw new Error(`Agent architecture check must run from ${expectedRoot}.`)
}

const writeMode = process.argv.includes("--write")
const generatedPath = resolve(root, "architecture/agent-definitions.generated.json")
const coreEntry = resolve(root, "packages/core/dist/index.js")
const core = await import(`${pathToFileURL(coreEntry).href}?architecture-check=${Date.now()}`)
const definitions = core.phaseOneAgentDefinitionInventory()
const executionOwners = [
  { id: "socrates-main", path: "packages/core/src/agent/SocratesAgent.ts", definitionId: "socrates-main", status: "canonical" },
  { id: "skill-writer", path: "apps/server/src/services/store/skillWriterAgentRunner.ts", definitionId: "skill-writer", status: "canonical" },
  { id: "global-memory", path: "apps/server/src/services/store/memoryAgentRunner.ts", definitionId: "global-memory", status: "canonical" },
  { id: "context-compressor", path: "packages/core/src/agent/CompressorAgent.ts", definitionId: "socrates-context-compactor,memory-context-compactor,context-anchor-repair", status: "canonical" },
  { id: "title-generator", path: "packages/core/src/agent/TitleGeneratorAgent.ts", definitionId: "title-generator", status: "canonical" },
  { id: "soul-confirmation", path: "packages/core/src/agent/SoulConfirmationAgent.ts", definitionId: "soul-confirmation", status: "canonical" },
  { id: "legacy-goal-router", path: "packages/core/src/agent/GoalRouterAgent.ts", definitionId: null, status: "legacy_remove_with_goal_lifecycle" },
  { id: "legacy-memory-router", path: "packages/core/src/agent/MemoryRouterAgent.ts", definitionId: null, status: "legacy_remove_with_memory_selection" },
]
const generated = `${JSON.stringify({
  schemaVersion: 1,
  generatedFrom: "packages/core/src/agent/agentDefinitions.ts",
  phase: "phase-1-shared-agent-core",
  definitions,
  executionOwners,
}, null, 2)}\n`

if (writeMode) {
  await mkdir(dirname(generatedPath), { recursive: true })
  await writeFile(generatedPath, generated, "utf8")
} else {
  const current = await readFile(generatedPath, "utf8").catch(() => "")
  if (current !== generated) {
    throw new Error("Generated agent definition inventory is stale. Run pnpm generate:agent-architecture.")
  }
}

const definitionIds = definitions.map((definition) => definition.id)
if (new Set(definitionIds).size !== definitionIds.length) {
  throw new Error("Agent definition ids must be unique.")
}
for (const required of [
  "socrates-main",
  "skill-writer",
  "title-generator",
  "soul-confirmation",
  "global-memory",
  "socrates-context-compactor",
  "memory-context-compactor",
]) {
  if (!definitionIds.includes(required)) throw new Error(`Missing Phase 1 AgentDefinition ${required}.`)
}

const registryBindings = [
  ["socrates-main", core.createDefaultToolRegistry()],
  ["skill-writer", core.createSkillWriterToolRegistry()],
  ["global-memory", core.createMemoryToolRegistry()],
  ["title-generator", core.createTitleGeneratorToolRegistry()],
  ["soul-confirmation", core.createSoulConfirmationToolRegistry()],
  ["socrates-context-compactor", core.createCompressorToolRegistry()],
  ["memory-context-compactor", core.createCompressorToolRegistry()],
  ["context-anchor-repair", core.createCompressorToolRegistry()],
]
for (const [definitionId, registry] of registryBindings) {
  const definition = definitions.find((entry) => entry.id === definitionId)
  const expected = [...(definition?.modelTools ?? [])].sort()
  const actual = registry.list().map((tool) => tool.name).sort()
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(
      `Role manifest ${definitionId} drifted from its registry. `
      + `Expected [${expected.join(", ")}], received [${actual.join(", ")}].`,
    )
  }
}

const productionRoots = [resolve(root, "packages/core/src"), resolve(root, "apps/server/src")]
const productionFiles = (await Promise.all(productionRoots.map((directory) => listTypeScriptFiles(directory)))).flat()
const sources = await Promise.all(productionFiles.map(async (path) => ({ path, source: await readFile(path, "utf8") })))
const relativePath = (path) => relative(root, path).replaceAll("\\", "/")

for (const owner of executionOwners) {
  const source = await readFile(resolve(root, owner.path), "utf8").catch(() => "")
  if (!source) throw new Error(`Agent execution owner is missing: ${owner.path}.`)
  if (owner.status.startsWith("legacy_") && !source.includes("new AgentRuntime")) {
    throw new Error(`Legacy debt ${owner.id} changed; remove its inventory row only with the owning lifecycle cutover.`)
  }
}
const discoveredExecutionOwners = sources
  .filter(({ path, source }) =>
    /export class (?:Socrates|Compressor|GoalRouter|MemoryRouter|TitleGenerator|SoulConfirmation)Agent\b/.test(source)
    || /export const run(?:MemoryAgent|SkillWriter)Turn\b/.test(source),
  )
  .map(({ path }) => relativePath(path))
  .sort()
const inventoriedExecutionOwners = [...new Set(executionOwners.map((owner) => owner.path))].sort()
if (JSON.stringify(discoveredExecutionOwners) !== JSON.stringify(inventoriedExecutionOwners)) {
  throw new Error(
    `Agent execution-owner inventory drift. Discovered [${discoveredExecutionOwners.join(", ")}], `
    + `inventoried [${inventoriedExecutionOwners.join(", ")}].`,
  )
}

const runtimeOwners = sources.filter(({ source }) => /export class AgentRuntime\b/.test(source))
if (runtimeOwners.length !== 1 || relativePath(runtimeOwners[0].path) !== "packages/core/src/agent/AgentRuntime.ts") {
  throw new Error(`Expected one AgentRuntime owner, found: ${runtimeOwners.map(({ path }) => relativePath(path)).join(", ") || "none"}.`)
}

for (const { path, source } of sources) {
  const file = relativePath(path)
  const code = stripCommentsAndStrings(source)
  const directProviderCall = /(?:\bprovider|\.provider)\.(?:stream|generateStructured)\s*(?:<[^>]+>)?\s*\(/.test(code)
  if (directProviderCall && file !== "packages/core/src/agent/AgentRuntime.ts") {
    throw new Error(`Direct model-provider execution outside AgentRuntime: ${file}.`)
  }
  const directContextPreparation = /\bprepareContextForModelCall\s*\(/.test(code)
  if (directContextPreparation && ![
    "packages/core/src/agent/ContextPipeline.ts",
    "packages/core/src/context/contextCompression.ts",
  ].includes(file)) {
    throw new Error(`Context preparation bypasses ContextPipeline: ${file}.`)
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

const productionBindings = [
  ["packages/core/src/agent/createDefaultSocratesAgent.ts", "socratesMainAgentDefinition"],
  ["apps/server/src/services/store/skillWriterAgentRunner.ts", "skillWriterAgentDefinition"],
]
for (const [caller, definition] of productionBindings) {
  const source = await readFile(resolve(root, caller), "utf8")
  if (!source.includes(definition)) throw new Error(`${caller} does not bind ${definition}.`)
}
if (sources.some(({ source }) => source.includes("systemPromptOverride"))) {
  throw new Error("Ad hoc Socrates systemPromptOverride remains reachable in production source.")
}
const corePublicEntry = await readFile(resolve(root, "packages/core/src/index.ts"), "utf8")
if (/\b(?:prepareContextForModelCall|precomputeContextSnapshot)\b/.test(corePublicEntry)) {
  throw new Error("Legacy raw context-preparation functions remain exported from the public core entrypoint.")
}

process.stdout.write(`Agent architecture Phase 1 OK: ${definitions.length} definitions, one provider runtime, one context pipeline.\n`)

function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:\\.|[^"\\])*"/g, "")
    .replace(/'(?:\\.|[^'\\])*'/g, "")
    .replace(/`(?:\\.|[^`\\])*`/g, "")
}

async function listTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const paths = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (["dist", "test", "__tests__"].includes(entry.name)) continue
      paths.push(...await listTypeScriptFiles(path))
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue
    paths.push(path)
  }
  return paths
}
