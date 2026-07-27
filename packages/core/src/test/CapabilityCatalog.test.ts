import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import type { DynamicToolCapabilityRegistration } from "@socrates/contracts"
import {
  CapabilitySet,
  capabilityCatalog,
  capabilityInventory,
} from "../capabilities/CapabilityCatalog"
import type {
  ModelToolCapabilityDefinition,
  ServiceCapabilityDefinition,
} from "../capabilities/CapabilityDefinition"
import {
  globalMemoryAgentDefinition,
  phaseOneAgentDefinitions,
  socratesMainAgentDefinition,
} from "../agent/agentDefinitions"

describe("CapabilityCatalog", () => {
  it("is the unique inventory for every capability kind and ownership surface", () => {
    const inventory = capabilityInventory()

    expect(new Set(inventory.map((entry) => entry.id)).size).toBe(inventory.length)
    expect(new Set(inventory.map((entry) => entry.kind))).toEqual(new Set([
      "model_tool",
      "automatic_retrieval",
      "structured_worker",
      "context_stage",
      "deterministic_authority",
      "typed_user_command",
    ]))
    expect(inventory.every((entry) => entry.executorBinding && entry.source.owner && entry.source.definitionPath)).toBe(true)
    expect(inventory.every((entry) => entry.source.callers.length > 0 && entry.source.tests.length > 0)).toBe(true)
  })

  it("projects every static model tool from its canonical runtime schema", () => {
    const tools = capabilityCatalog.list().filter(
      (capability): capability is ModelToolCapabilityDefinition => capability.kind === "model_tool",
    )

    expect(tools).toHaveLength(30)
    for (const capability of tools) {
      expect(capability.providerProjection.inputSchema).toBe(capability.tool.inputSchema)
      expect(capability.providerProjection.resultSchema).toBe(capability.tool.resultSchema)
      expect(capability.providerProjection.providerInputSchema).toMatchObject({ type: "object" })
    }
  })

  it("resolves exact role scopes without duplicate model names", () => {
    for (const definition of phaseOneAgentDefinitions) {
      const resolved = capabilityCatalog.resolve(definition.roleManifest)
      expect(resolved.capabilities.map((capability) => capability.id)).toEqual(definition.roleManifest.capabilityIds)
      const names = resolved.list().map((capability) => capability.tool.name)
      expect(new Set(names).size).toBe(names.length)
    }

    expect(capabilityCatalog.resolve(socratesMainAgentDefinition.roleManifest).getCapability("trace_retrieve")?.id).toBe("tool.trace_retrieve.main")
    expect(capabilityCatalog.resolve(globalMemoryAgentDefinition.roleManifest).getCapability("trace_retrieve")?.id).toBe("tool.trace_retrieve.global")
    expect(() => new CapabilitySet([
      capabilityCatalog.resolve(socratesMainAgentDefinition.roleManifest).getCapability("read")!,
      capabilityCatalog.resolve(socratesMainAgentDefinition.roleManifest).getCapability("read")!,
    ])).toThrow(/duplicate model tool read/)
  })

  it("catalogs every Classic and Flow user command with its canonical strict schema", () => {
    const commands = capabilityCatalog.list().filter(
      (capability): capability is ServiceCapabilityDefinition => capability.kind === "typed_user_command",
    )

    expect(commands).toHaveLength(24)
    expect(commands.map((command) => command.executorBinding)).toEqual(expect.arrayContaining([
      "chat.message.send",
      "terminal.input",
      "v2.message.send",
      "v2.routing.clarification.respond",
      "v2.focus.update",
      "v2.terminal.rename",
    ]))
    expect(commands.every((command) => command.inputSchema && command.resultSchema)).toBe(true)
  })

  it("registers and executes runtime MCP children only through the catalog", async () => {
    const execute = vi.fn(async (input: unknown) => ({ echoed: input }))
    const registration: DynamicToolCapabilityRegistration = {
      id: "dynamic.mcp.test.echo",
      kind: "dynamic_tool",
      name: "mcp__test__echo",
      description: "Echo one value.",
      inputSchema: z.object({ value: z.string() }).strict(),
      resultSchema: z.unknown(),
      providerInputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["value"],
        properties: { value: { type: "string" } },
      },
      source: { type: "mcp", serverId: "test", childName: "echo", scope: "project" },
    }
    const resolved = capabilityCatalog.resolve(socratesMainAgentDefinition.roleManifest, [registration])
    const dynamic = resolved.getCapability("mcp__test__echo")

    expect(dynamic?.id).toBe("dynamic.mcp.test.echo")
    expect(capabilityCatalog.runtimeInventory(socratesMainAgentDefinition.roleManifest, [registration])).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: registration.id, kind: "dynamic_tool", modelToolName: registration.name })]),
    )
    const output = await dynamic?.tool.execute({ value: "hello" }, {
      executors: { mcp_dynamic: execute },
    } as never)
    expect(execute).toHaveBeenCalledWith(
      { dynamicName: "mcp__test__echo", input: { value: "hello" } },
      expect.any(Object),
    )
    expect(output).toEqual({ echoed: { dynamicName: "mcp__test__echo", input: { value: "hello" } } })
    expect(() => capabilityCatalog.resolve(globalMemoryAgentDefinition.roleManifest, [registration])).toThrowError(
      expect.objectContaining({ code: "agent_role_manifest_mismatch" }),
    )
  })
})
