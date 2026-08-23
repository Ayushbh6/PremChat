import path from "node:path"
import { describe, expect, it } from "vitest"
import type { FilesystemAuthorizationSnapshot } from "@socrates/contracts"
import { decideAccess } from "../tools/accessPolicy"

const snapshot = (mode: FilesystemAuthorizationSnapshot["mode"]): FilesystemAuthorizationSnapshot => ({
  id: "access_1",
  turnId: "task_1",
  mode,
  revision: 3,
  roots: [{ id: "root_1", label: "Selected", path: path.resolve("/selected") }],
  workingRootPath: path.resolve("/selected"),
  createdAt: "2026-07-30T00:00:00.000Z",
})

describe("global access policy", () => {
  it.each(["read_only", "selected", "full"] as const)("keeps reads and Terminal control automatic in %s", (mode) => {
    expect(decideAccess({ authorization: snapshot(mode), action: "structured_read" })).toBe("automatic")
    expect(decideAccess({ authorization: snapshot(mode), action: "terminal_control" })).toBe("automatic")
  })

  it("uses selected roots only for write autonomy", () => {
    const authorization = snapshot("selected")
    expect(decideAccess({ authorization, action: "structured_write", targetPath: "inside.txt", workspacePath: "/selected" })).toBe("automatic")
    expect(decideAccess({ authorization, action: "structured_write", targetPath: "/elsewhere/outside.txt", workspacePath: "/selected" })).toBe("approval_required")
  })

  it("requires Read-only mutation and Terminal approvals without denying them", () => {
    const authorization = snapshot("read_only")
    expect(decideAccess({ authorization, action: "structured_write", targetPath: "/any/file.txt", workspacePath: "/selected" })).toBe("approval_required")
    expect(decideAccess({ authorization, action: "terminal_run" })).toBe("approval_required")
  })

  it("allows ordinary Full actions but never Frontier or catastrophic operations", () => {
    const authorization = snapshot("full")
    expect(decideAccess({ authorization, action: "structured_write" })).toBe("automatic")
    expect(decideAccess({ authorization, action: "terminal_run" })).toBe("automatic")
    expect(decideAccess({ authorization, action: "capability_change" })).toBe("automatic")
    expect(decideAccess({ authorization, action: "frontier_handoff" })).toBe("approval_required")
    expect(decideAccess({ authorization, action: "catastrophic" })).toBe("denied")
  })
})
