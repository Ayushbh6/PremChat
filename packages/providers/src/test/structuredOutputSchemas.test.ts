import { memoryAgentJournalOutputSchema } from "@socrates/contracts"
import { Output } from "ai"
import { describe, expect, it } from "vitest"

type JsonSchema = {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
}

describe("structured output schema projection", () => {
  it("projects the Memory Agent journal with every object property required for OpenAI strict mode", async () => {
    const responseFormat = await Output.object({ schema: memoryAgentJournalOutputSchema }).responseFormat as {
      schema: JsonSchema
    }
    const projected = responseFormat.schema

    expectStrictObjectPropertiesRequired(projected)
    const skillItem = projected.properties?.skillsAffected?.items
    const investigationItem = projected.properties?.openInvestigations?.items
    expect(skillItem?.required).toContain("skillId")
    expect(investigationItem?.required).toContain("investigationId")
    expect(JSON.stringify(skillItem?.properties?.skillId)).toContain("null")
    expect(JSON.stringify(investigationItem?.properties?.investigationId)).toContain("null")
  })
})

const expectStrictObjectPropertiesRequired = (schema: JsonSchema): void => {
  if (schema.type === "object") {
    const propertyNames = Object.keys(schema.properties ?? {}).sort()
    expect([...(schema.required ?? [])].sort()).toEqual(propertyNames)
    for (const property of Object.values(schema.properties ?? {})) {
      expectStrictObjectPropertiesRequired(property)
    }
  }
  if (schema.items) expectStrictObjectPropertiesRequired(schema.items)
  for (const variant of schema.anyOf ?? []) expectStrictObjectPropertiesRequired(variant)
  for (const variant of schema.oneOf ?? []) expectStrictObjectPropertiesRequired(variant)
}
