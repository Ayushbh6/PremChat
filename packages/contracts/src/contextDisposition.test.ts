import { describe, expect, it } from "vitest"
import { contextDispositionToolInputSchema } from "./tools"

describe("contextDispositionToolInputSchema", () => {
  it("accepts only a compact release handle list", () => {
    expect(contextDispositionToolInputSchema.parse({ release: ["R1", "R600"] })).toEqual({
      release: ["R1", "R600"],
    })
  })

  it("rejects legacy decisions, malformed handles, and duplicates", () => {
    expect(contextDispositionToolInputSchema.safeParse({
      decisions: [{ result: "result_1", action: "release" }],
    }).success).toBe(false)
    expect(contextDispositionToolInputSchema.safeParse({ release: ["result_1"] }).success).toBe(false)
    expect(contextDispositionToolInputSchema.safeParse({ release: ["R1", "R1"] }).success).toBe(false)
  })
})
