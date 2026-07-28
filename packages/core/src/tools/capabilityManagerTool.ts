import {
  capabilityManagerToolInputSchema,
  capabilityManagerToolOutputSchema,
  type CapabilityManagerToolInput,
  type CapabilityManagerToolOutput,
} from "@socrates/contracts"
import { createId, SocratesError } from "@socrates/shared"
import type { SocratesTool } from "./types"

export const capabilityManagerTool: SocratesTool<CapabilityManagerToolInput, CapabilityManagerToolOutput> = {
  name: "capability_manager",
  description:
    "Manage installed skills and MCP servers only when the user asks to add, update, enable, disable, or remove one. Skill create/update delegates to the Skill Writer; skill imports use the secure preview then commit flow. MCP configure validates before enabling and collects declared secrets through private credential input. Discovery is handled by automatic capability retrieval and read/search under socrates://capabilities, not by this tool.",
  inputSchema: capabilityManagerToolInputSchema,
  resultSchema: capabilityManagerToolOutputSchema,
  permission: "mutate",
  executeLane: "mutation",
  category: "mcp",
  decidePolicy: (input) => {
    if (input.operation === "mcp_check" || input.operation === "skill_preview_import") return { type: "auto" }
    return {
      type: "approval_required",
      request: {
        actionKind: "file_write",
        title: approvalTitle(input),
        description: "Apply this explicit capability change through the governed capability manager.",
        actionPreview: JSON.stringify(input, null, 2),
        risk: input.operation.endsWith("delete") ? "medium" : "low",
      },
    }
  },
  execute: async (input, context) => {
    if (!context.executors.capability_manager) {
      throw new SocratesError("capability_manager_unavailable", "Capability management is unavailable in this runtime.", { recoverable: true })
    }
    if (input.operation !== "mcp_configure" || !input.server.secretBindings?.length) {
      return context.executors.capability_manager(input, context)
    }
    if (!context.requestCredentialInput) {
      throw new SocratesError("credential_input_handler_unavailable", "Secure credential input is unavailable.", { recoverable: true })
    }
    const resolvedSecretEnv: Record<string, string> = {}
    for (const binding of input.server.secretBindings) {
      const decision = await context.requestCredentialInput({
        credentialRequestId: createId("creq"),
        toolCallId: context.toolCallId ?? createId("tcall"),
        serverId: input.server.id,
        ...(input.server.label ? { serverLabel: input.server.label } : {}),
        envKey: binding.envKey,
        source: binding.source,
      })
      if (decision.decision !== "submitted" || !decision.value) {
        throw new SocratesError("credential_input_cancelled", `Credential entry for ${binding.envKey} was cancelled.`, { recoverable: true })
      }
      resolvedSecretEnv[binding.envKey] = decision.value
    }
    return context.executors.capability_manager(input, context, resolvedSecretEnv)
  },
  summary: (output) => output.summary,
  resultPreview: (output) => JSON.stringify(output, null, 2),
  metrics: (output) => output.operation === "mcp_check" || output.operation === "skill_preview_import"
    ? {}
    : { filesEdited: 1 },
}

const approvalTitle = (input: CapabilityManagerToolInput): string => {
  const target = "name" in input
    ? input.name
    : input.operation === "mcp_configure"
      ? input.server.id
      : input.operation === "mcp_check" || input.operation === "mcp_delete"
        ? input.id
        : "capability"
  return `${input.operation.replaceAll("_", " ")} ${target}`
}
