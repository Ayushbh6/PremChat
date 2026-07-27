import { createDefaultModelProvider, findModelOption, listModels, type ProviderCredentialResolver } from "@socrates/providers"
import { buildSocratesSystemPrompt } from "../prompts/socratesPrompt"
import { createDefaultToolRegistry } from "../tools/registry"
import { SocratesAgent } from "./SocratesAgent"
import { socratesMainAgentDefinition } from "./agentDefinitions"

export const createDefaultSocratesAgent = (credentials?: ProviderCredentialResolver): SocratesAgent => {
  return new SocratesAgent(
    createDefaultModelProvider(credentials),
    createDefaultToolRegistry(),
    socratesMainAgentDefinition,
    { system: buildSocratesSystemPrompt() },
  )
}

export { findModelOption, listModels }
