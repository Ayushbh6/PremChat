import { createDefaultModelProvider, findModelOption, listModels, type ProviderCredentialResolver } from "@socrates/providers"
import { capabilityCatalog } from "../capabilities/CapabilityCatalog"
import { buildSocratesSystemPrompt } from "../prompts/socratesPrompt"
import { SocratesAgent } from "./SocratesAgent"
import { socratesMainAgentDefinition } from "./agentDefinitions"

export const createDefaultSocratesAgent = (credentials?: ProviderCredentialResolver): SocratesAgent => {
  return new SocratesAgent(
    createDefaultModelProvider(credentials),
    capabilityCatalog,
    socratesMainAgentDefinition,
    { system: buildSocratesSystemPrompt() },
  )
}

export { findModelOption, listModels }
