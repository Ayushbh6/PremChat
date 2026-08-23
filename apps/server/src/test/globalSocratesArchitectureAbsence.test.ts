import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "../../../../")
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), "utf8")
const exists = (relative: string): boolean => fs.existsSync(path.join(root, relative))

const productionRoots = [
  "packages/contracts/src",
  "packages/core/src",
  "apps/server/src",
  "apps/web/src",
].map((relative) => path.join(root, relative))

const sourceFiles = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const fullPath = path.join(directory, entry.name)
  if (entry.isDirectory()) {
    if (["test", "memory", "generated"].includes(entry.name)) return []
    return sourceFiles(fullPath)
  }
  return entry.isFile() && /\.(?:ts|tsx)$/.test(fullPath) && !/\.test\.(?:ts|tsx)$/.test(fullPath) ? [fullPath] : []
})

describe("global Socrates architecture absence", () => {
  it("keeps removed container authorities and product surfaces out of production source", () => {
    const banned = [
      "globalCompatibilityContainer",
      "internalGlobalCompatibilityProject",
      "SOCRATES_Socrates_FLOW_ENABLED",
      "/api/v2/flows",
      "v2.flow.",
      "createSocratesFlow",
      "FlowWorkspace",
      "FlowNavigationSidebar",
    ]
    const violations = productionRoots.flatMap(sourceFiles).flatMap((file) => {
      const content = fs.readFileSync(file, "utf8")
      return banned.filter((token) => content.includes(token)).map((token) => `${path.relative(root, file)}: ${token}`)
    })
    expect(violations).toEqual([])
  })

  it("physically removes the alternate workspace, scoped routes, stores, and historical eval harness", () => {
    for (const relative of [
      "apps/server/src/routes/socratesFlowRoutes.ts",
      "apps/server/src/services/socrates/flowStore.ts",
      "apps/server/src/services/socrates/flowWorkingContext.ts",
      "apps/server/src/runtime/flowSubscriptions.ts",
      "apps/web/src/components/socrates/FlowWorkspace.tsx",
      "apps/web/src/components/socrates/FlowNavigationSidebar.tsx",
      "apps/web/src/lib/socrates/useSocratesFlowRuntime.ts",
      "packages/contracts/src/socratesFlow.ts",
      "scripts/check-flow-convergence-phase0.mjs",
      "evals/flow-convergence",
    ]) expect(exists(relative)).toBe(false)
  })

  it("opens one goal-only shell and keeps legacy product routes as redirects", () => {
    expect(read("apps/web/src/app/welcome/page.tsx")).toContain('href="/chat"')
    expect(read("apps/web/src/app/chat/page.tsx")).toContain("<SocratesApp")
    for (const route of [
      "apps/web/src/app/projects/page.tsx",
      "apps/web/src/app/projects/new/page.tsx",
      "apps/web/src/app/projects/[projectId]/page.tsx",
      "apps/web/src/app/seamless/page.tsx",
      "apps/web/src/app/seamless/projects/[projectId]/page.tsx",
    ]) expect(read(route)).toContain('redirect("/chat")')
    const sidebar = read("apps/web/src/components/socrates/GoalSidebar.tsx")
    expect(sidebar).toContain("Search goals and exact exchanges")
    expect(sidebar).toContain('data-navigation-level={selectedGoal ? "exchanges" : "goals"}')
    expect(sidebar).toContain('aria-label="Back to goals"')
    expect(sidebar).not.toContain("aria-expanded")
    expect(sidebar).not.toContain("Projects")
    expect(sidebar).not.toContain("Conversations")
    expect(exists("apps/web/src/components/socrates/SettingsDrawer.tsx")).toBe(false)
    expect(read("apps/web/src/components/socrates/SocratesApp.tsx")).not.toContain("SettingsDrawer")
    const settings = read("apps/web/src/app/settings/page.tsx")
    expect(settings).toContain('href="/memory"')
    expect(settings).toContain("<McpServersPanel")
    expect(read("apps/web/src/components/memory/MemoryCenterPage.tsx")).not.toContain("McpServersPanel")
  })

  it("uses one global store, one working-context path, and the shared executor authority", () => {
    const runtime = read("apps/server/src/runtime/runtime.ts")
    expect(runtime).toContain('from "../services/socrates/socratesWorkingContext"')
    expect(runtime).toContain("buildSocratesWorkingMessages")
    expect(runtime).toContain("createSocratesToolExecutors")
    expect(read("apps/server/src/services/socrates/socratesWorkingContext.ts")).toContain("prepareExactGoalHistory")
    expect(read("apps/server/src/runtime/toolExecutors.ts")).toContain("createMainToolExecutors")
    expect(read("apps/server/src/services/socrates/socratesStore.ts")).toContain("class GlobalSocratesStore")
    expect(read("packages/core/src/capabilities/CapabilityCatalog.ts")).toContain('"apps/server/src/services/socrates/socratesStore.ts", "canonical"')
  })

  it("keeps one same-Socrates goal decision and one validated atomic finalization", () => {
    const prompt = read("packages/core/src/prompts/socratesGoalResolutionPrompt.ts")
    const coordinator = read("apps/server/src/runtime/goalLifecycleCoordinator.ts")
    const runtime = read("apps/server/src/runtime/runtime.ts")
    expect(prompt).toContain("Candidate numbers are human references")
    expect(prompt).toContain("this goal")
    expect(prompt).not.toContain("goalId: turn.goalId")
    expect(coordinator).toContain("retrieveTurnCandidates")
    expect(coordinator).toContain("resolveSocratesGoal")
    expect(runtime).toContain("this.deps.store.commitValidatedTurn")
    expect(read("apps/server/src/services/turn/validatedTurnFinalization.ts")).toContain("handle.sqlite.transaction")
    for (const removed of [
      "packages/core/src/agent/GoalRouterAgent.ts",
      "packages/core/src/agent/MemoryRouterAgent.ts",
      "packages/core/src/tools/goalSearchTool.ts",
      "packages/core/src/tools/memorySearchTool.ts",
    ]) expect(exists(removed)).toBe(false)
  })

  it("keeps automatic compaction and current-turn result release as separate mechanisms", () => {
    expect(read("packages/contracts/src/tools.ts")).toContain("release: z.array(contextResultHandleSchema)")
    const compression = read("packages/core/src/context/contextCompression.ts")
    expect(compression).toContain("CONTEXT_MODEL_DISPATCH_CEILING_TOKENS = 170_000")
    expect(compression).toContain("recentTailTargetTokens: 70_000")
    expect(read("packages/core/src/context/toolOutputDisposition.ts")).not.toContain('disposition === "distill"')
  })

  it("uses the current canonical tool-call error code for malformed provider tool input", () => {
    expect(read("apps/server/src/services/socrates/socratesStore.ts")).toContain('"socrates_tool_call_not_found"')
    expect(read("apps/server/src/runtime/runtime.ts")).toContain('lookupError.code !== "socrates_tool_call_not_found"')
  })

  it("drops the removed container table and scoped columns in the global migration", () => {
    const migration = read("apps/server/drizzle/0035_yellow_blindfold.sql")
    expect(migration).toContain("CREATE TABLE `global_socrates_state`")
    expect(migration).toContain("DROP TABLE `v2_flows`")
    expect(migration).toContain("DROP COLUMN `flow_id`")
    expect(migration).toContain("LIKE 'socrates.%'")
  })
})
