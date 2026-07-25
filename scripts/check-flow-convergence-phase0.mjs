import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import process from "node:process"

const root = process.cwd()
const baselinePath = resolve(root, "evals/flow-convergence/phase-0-baseline.json")
const baseline = JSON.parse(await readFile(baselinePath, "utf8"))

const fail = (message) => {
  throw new Error(`Flow convergence Phase 0 gate failed: ${message}`)
}

if (baseline.version !== 1) fail("version must be 1")
if (!/^\d{4}-\d{2}-\d{2}$/.test(baseline.capturedAt ?? "")) fail("capturedAt must be YYYY-MM-DD")
if (!Array.isArray(baseline.runtimeInventory) || baseline.runtimeInventory.length === 0) fail("runtimeInventory must not be empty")
if (!Array.isArray(baseline.scenarios) || baseline.scenarios.length === 0) fail("scenarios must not be empty")

const assertUniqueIds = (items, label) => {
  const ids = items.map((item) => item.id)
  if (ids.some((id) => typeof id !== "string" || id.trim() === "")) fail(`${label} contains an empty id`)
  if (new Set(ids).size !== ids.length) fail(`${label} ids must be unique`)
}

assertUniqueIds(baseline.runtimeInventory, "runtimeInventory")
assertUniqueIds(baseline.scenarios, "scenarios")

for (const entry of baseline.runtimeInventory) {
  if (typeof entry.path !== "string" || !Array.isArray(entry.anchors) || entry.anchors.length === 0 || typeof entry.finding !== "string") {
    fail(`runtime inventory ${entry.id} is incomplete`)
  }
  const source = await readFile(resolve(root, entry.path), "utf8")
  for (const anchor of entry.anchors) {
    if (!source.includes(anchor)) fail(`${entry.id} no longer matches ${entry.path}; missing anchor ${JSON.stringify(anchor)}`)
  }
}

const requiredScenarioIds = new Set([
  "native-invalid-tool-input-recovers",
  "plaintext-tool-envelope-is-not-an-answer",
  "short-followup-preserves-meaning",
  "completion-does-not-deselect-goal",
  "meaningful-followup-reopens-same-goal",
  "related-new-goal-has-transition-context",
  "classic-flow-roundtrip-does-not-copy-qna",
  "single-live-activity-line",
])

for (const scenario of baseline.scenarios) {
  requiredScenarioIds.delete(scenario.id)
  if (typeof scenario.observed !== "string" || scenario.observed.trim() === "") fail(`${scenario.id} needs an observed behavior`)
  if (!Array.isArray(scenario.turns) || scenario.turns.length === 0) fail(`${scenario.id} needs at least one turn`)
  if (scenario.turns.some((turn) => !["user", "assistant", "runtime"].includes(turn.role) || typeof turn.content !== "string")) {
    fail(`${scenario.id} contains an invalid turn`)
  }
  if (typeof scenario.targetInvariant !== "string" || scenario.targetInvariant.trim() === "") fail(`${scenario.id} needs a target invariant`)
  if (!Number.isInteger(scenario.ownerPhase) || scenario.ownerPhase < 1) fail(`${scenario.id} needs an ownerPhase of 1 or later`)
  if (!new Set(["pending", "passing"]).has(scenario.status)) fail(`${scenario.id} has an invalid status`)
  if (typeof scenario.futureTestSurface !== "string" || scenario.futureTestSurface.trim() === "") fail(`${scenario.id} needs a future test surface`)
}

if (requiredScenarioIds.size > 0) fail(`missing required scenarios: ${[...requiredScenarioIds].join(", ")}`)

const pending = baseline.scenarios.filter((scenario) => scenario.status === "pending").length
const passing = baseline.scenarios.length - pending
process.stdout.write(`Flow convergence Phase 0 baseline OK: ${baseline.runtimeInventory.length} runtime anchors, ${baseline.scenarios.length} scenarios (${pending} pending, ${passing} passing).\n`)
