import type { ModelToolDefinition } from "@socrates/contracts"
import { zodToJsonSchema } from "zod-to-json-schema"
import type { SocratesTool } from "../tools/types"

export const projectModelTool = (tool: SocratesTool<any, any>): ModelToolDefinition => {
  try {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      resultSchema: tool.resultSchema,
      providerInputSchema: canonicalProviderInputSchema(tool.inputSchema),
    }
  } catch (error) {
    throw new Error(`Cannot project model tool ${tool.name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export const canonicalProviderInputSchema = (schema: unknown): unknown => {
  const projected = schema && typeof schema === "object" && "_def" in schema
    ? zodToJsonSchema(schema as never, { $refStrategy: "none" })
    : schema
  if (!isRecord(projected)) {
    throw new Error("Capability input schema did not produce a JSON Schema object.")
  }
  if (projected.type === "object") return projected
  const variants = Array.isArray(projected.anyOf)
    ? projected.anyOf
    : Array.isArray(projected.oneOf)
      ? projected.oneOf
      : undefined
  if (variants?.length && variants.every(isObjectSchemaTree)) {
    return { ...projected, type: "object" }
  }
  throw new Error("Model-tool capability schemas must project to a top-level JSON Schema object.")
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const isObjectSchemaTree = (value: unknown): boolean => {
  if (!isRecord(value)) return false
  if (value.type === "object") return true
  const variants = Array.isArray(value.anyOf)
    ? value.anyOf
    : Array.isArray(value.oneOf)
      ? value.oneOf
      : undefined
  return Boolean(variants?.length && variants.every(isObjectSchemaTree))
}
