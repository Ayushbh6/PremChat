import { z } from "zod"

export const capabilityCandidateSchema = z.object({
  resultNumber: z.number().int().positive(),
  id: z.string().min(1),
  kind: z.enum(["skill", "mcp"]),
  name: z.string().min(1),
  description: z.string().min(1),
  scope: z.enum(["builtin", "global", "path"]),
  uri: z.string().startsWith("socrates://"),
}).strict()
export type CapabilityCandidate = z.infer<typeof capabilityCandidateSchema>

export const capabilityCandidateRetrievalSchema = z.object({
  results: z.array(capabilityCandidateSchema).max(8),
  totalMatches: z.number().int().nonnegative(),
  warnings: z.array(z.string()).optional(),
}).strict()
export type CapabilityCandidateRetrieval = z.infer<typeof capabilityCandidateRetrievalSchema>
