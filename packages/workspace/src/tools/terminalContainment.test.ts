import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createWorkspaceShellSession } from "./bashTool"
import { macosSandboxProfile, nativeTerminalContainmentAvailability, requireNativeTerminalContainment } from "./terminalContainment"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const temporaryDirectory = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "socrates-containment-"))
  roots.push(root)
  return root
}

describe("native Terminal containment", () => {
  it("fails closed when no native launcher exists or the requested root is dangerously broad", () => {
    const root = temporaryDirectory()
    expect(nativeTerminalContainmentAvailability("win32")).toMatchObject({ available: false })
    expect(() => requireNativeTerminalContainment({ writableRoots: [root], platform: "win32" })).toThrow(/cannot launch Terminal automatically/i)
    expect(() => requireNativeTerminalContainment({ writableRoots: [os.homedir()] })).toThrow(/entire home directory/i)
  })

  it("renders a native macOS profile that permits writes only in the exact approved root", async () => {
    if (process.platform !== "darwin" || !nativeTerminalContainmentAvailability().available) return
    const root = temporaryDirectory()
    const outside = `${root}-outside`
    fs.mkdirSync(outside)
    const containment = requireNativeTerminalContainment({ writableRoots: [root] })
    expect(macosSandboxProfile({ writableRoots: [root] })).toContain(JSON.stringify(fs.realpathSync.native(root)))

    const session = createWorkspaceShellSession(root, { containment })
    try {
      const allowed = await session.run({ operation: "run", command: "printf allowed > permitted.txt" })
      expect(allowed.exitCode).toBe(0)
      expect(fs.readFileSync(path.join(root, "permitted.txt"), "utf8")).toBe("allowed")

      const denied = await session.run({ operation: "run", command: `printf blocked > ${JSON.stringify(path.join(outside, "blocked.txt"))}` })
      expect(denied.exitCode).not.toBe(0)
      expect(fs.existsSync(path.join(outside, "blocked.txt"))).toBe(false)
    } finally {
      session.dispose()
    }
  })
})
