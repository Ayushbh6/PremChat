import { describe, expect, it } from "vitest"
import {
  clampSocratesNotePosition,
  moveSocratesNoteWithKey,
  parseSocratesNoteLayout,
  resetSocratesNoteLayout,
} from "./noteLayout"

describe("global Socrates note layout", () => {
  it("recovers malformed or partial stored layouts", () => {
    expect(parseSocratesNoteLayout("{")).toEqual(resetSocratesNoteLayout())
    expect(parseSocratesNoteLayout(JSON.stringify({
      version: 1,
      positions: { work: { x: 12, y: 24 }, goal: { x: "bad", y: 9 } },
      frontNoteId: "work",
    }))).toEqual({
      version: 1,
      positions: { work: { x: 12, y: 24 }, goal: { x: 0, y: 0 } },
      frontNoteId: "work",
    })
  })

  it("clamps a requested drag to the visible surface inset", () => {
    const clamped = clampSocratesNotePosition({
      current: { x: 0, y: 0 },
      requested: { x: 500, y: -500 },
      note: { left: 100, right: 300, top: 100, bottom: 220 },
      surface: { left: 0, right: 600, top: 0, bottom: 500 },
      inset: 16,
    })
    expect(clamped).toEqual({ x: 284, y: -84 })
  })

  it("supports deterministic keyboard movement and reset", () => {
    expect(moveSocratesNoteWithKey({ x: 10, y: 20 }, "ArrowRight", false)).toEqual({ x: 24, y: 20 })
    expect(moveSocratesNoteWithKey({ x: 10, y: 20 }, "ArrowUp", true)).toEqual({ x: 10, y: -20 })
    expect(moveSocratesNoteWithKey({ x: 10, y: 20 }, "Home", false)).toEqual({ x: 0, y: 0 })
    expect(moveSocratesNoteWithKey({ x: 10, y: 20 }, "Enter", false)).toBeNull()
  })
})
