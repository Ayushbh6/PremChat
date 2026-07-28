import { describe, expect, it } from "vitest"
import {
  limitModelOutputItems,
  limitModelOutputText,
  resolveModelOutputCharLimit,
} from "./modelOutput"

describe("model output limits", () => {
  it("uses a 4k-token default and enforces the 6k-token hard cap", () => {
    expect(resolveModelOutputCharLimit()).toBe(16_000)
    expect(resolveModelOutputCharLimit({ charLimit: 80_000, tokenLimit: 6_000 })).toBe(24_000)
    expect(resolveModelOutputCharLimit({ charLimit: 80_000, tokenLimit: 80_000 })).toBe(24_000)
  })

  it("pages exact text by character offset", () => {
    const first = limitModelOutputText("abcdefghij", { charLimit: 4, tokenLimit: 6_000 })
    const second = limitModelOutputText("abcdefghij", {
      charLimit: 4,
      tokenLimit: 6_000,
      offset: first.truncation.nextOffset ?? 0,
    })

    expect(first).toEqual({
      text: "abcd",
      truncation: {
        truncated: true,
        charLimit: 4,
        originalLength: 10,
        returnedLength: 4,
        nextOffset: 4,
      },
    })
    expect(second.text).toBe("efgh")
    expect(second.truncation.nextOffset).toBe(8)
  })

  it("bounds serialized list output and provides an entry offset", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({ name: `entry-${index}` }))
    const first = limitModelOutputItems(items, { charLimit: 55, tokenLimit: 6_000 })
    const second = limitModelOutputItems(items, {
      charLimit: 55,
      tokenLimit: 6_000,
      offset: first.truncation.nextOffset ?? 0,
    })

    expect(first.items.length).toBeGreaterThan(0)
    expect(JSON.stringify(first.items).length).toBeLessThanOrEqual(55)
    expect(first.truncation.truncated).toBe(true)
    expect(second.items[0]).toEqual(items[first.truncation.nextOffset ?? 0])
  })
})
