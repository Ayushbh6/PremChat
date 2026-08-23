import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { SocratesError } from "@socrates/shared"

/**
 * Native process containment used by Terminal hosts. It intentionally grants
 * writes only to an exact task/resource root; command-text checks are separate
 * explanatory defence in depth and are not represented as containment.
 */
export type TerminalContainment = Readonly<{
  kind: "macos_sandbox"
  launcher: string
  profile: string
  writableRoots: readonly string[]
}>

export type TerminalContainmentAvailability =
  | Readonly<{ available: true; kind: TerminalContainment["kind"] }>
  | Readonly<{ available: false; reason: string }>

export const nativeTerminalContainmentAvailability = (platform: NodeJS.Platform = process.platform): TerminalContainmentAvailability => {
  if (platform === "darwin") {
    return fs.existsSync("/usr/bin/sandbox-exec")
      ? { available: true, kind: "macos_sandbox" }
      : { available: false, reason: "The macOS sandbox launcher is unavailable." }
  }
  if (platform === "win32") {
    return { available: false, reason: "The Windows restricted Terminal launcher is unavailable." }
  }
  return { available: false, reason: `Native Terminal containment is not available on ${platform}.` }
}

/**
 * Full automatic Terminal calls must use this function. It throws rather than
 * silently falling back to a normal child process when enforcement is absent.
 */
export const requireNativeTerminalContainment = (input: {
  writableRoots: readonly string[]
  platform?: NodeJS.Platform
  temporaryRoots?: readonly string[]
}): TerminalContainment => {
  const platform = input.platform ?? process.platform
  const availability = nativeTerminalContainmentAvailability(platform)
  if (!availability.available) {
    throw new SocratesError("terminal_containment_unavailable", `${availability.reason} Full access cannot launch Terminal automatically.`, {
      recoverable: true,
      details: { platform },
    })
  }
  const writableRoots = uniqueCanonicalRoots(input.writableRoots)
  if (writableRoots.length === 0) {
    throw new SocratesError("terminal_containment_root_required", "Full access needs an exact writable task or resource root before Terminal can launch automatically.", {
      recoverable: true,
    })
  }
  for (const root of writableRoots) assertSafeWritableRoot(root)
  if (platform !== "darwin") {
    throw new SocratesError("terminal_containment_unavailable", "No enforceable native Terminal containment launcher is available.", { recoverable: true })
  }
  const temporaryRoots = uniqueCanonicalRoots(input.temporaryRoots ?? []).filter((root) => !isDangerousRoot(root))
  return {
    kind: "macos_sandbox",
    launcher: "/usr/bin/sandbox-exec",
    profile: macosSandboxProfile({ writableRoots, temporaryRoots }),
    writableRoots,
  }
}

export const macosSandboxProfile = (input: {
  writableRoots: readonly string[]
  temporaryRoots?: readonly string[]
}): string => {
  const writableRoots = uniqueCanonicalRoots(input.writableRoots)
  if (writableRoots.length === 0) throw new SocratesError("terminal_containment_root_required", "A Terminal containment profile needs a writable root.")
  for (const root of writableRoots) assertSafeWritableRoot(root)
  const temporaryRoots = uniqueCanonicalRoots(input.temporaryRoots ?? []).filter((root) => !isDangerousRoot(root))
  const writableClauses = [...new Set([...writableRoots, ...temporaryRoots])]
    .map((root) => `  (subpath ${sandboxString(root)})`)
    .join("\n")
  return [
    "(version 1)",
    "(deny default)",
    // The child can execute normal development tools, but every descendant
    // inherits the same file policy. This is the isolation boundary.
    "(allow process*)",
    "(allow sysctl-read)",
    "(allow file-read*)",
    "(allow network-outbound)",
    "(allow file-write*",
    writableClauses,
    ")",
  ].join("\n")
}

const uniqueCanonicalRoots = (roots: readonly string[]): string[] => {
  const canonical = roots
    .filter((root) => Boolean(root?.trim()))
    .map((root) => canonicalExistingPath(root))
  return [...new Set(canonical)].sort()
}

const canonicalExistingPath = (requested: string): string => {
  const resolved = path.resolve(requested)
  try {
    return fs.realpathSync.native(resolved)
  } catch {
    throw new SocratesError("terminal_containment_root_missing", "Terminal containment requires an existing task or resource root.", {
      recoverable: true,
      details: { path: resolved },
    })
  }
}

const assertSafeWritableRoot = (root: string): void => {
  if (isDangerousRoot(root)) {
    throw new SocratesError("terminal_containment_root_too_broad", "Terminal containment cannot grant automatic writes to a filesystem root or the entire home directory.", {
      recoverable: true,
      details: { root },
    })
  }
}

const isDangerousRoot = (root: string): boolean => {
  const parsed = path.parse(root)
  return root === parsed.root || root === os.homedir()
}

const sandboxString = (value: string): string => JSON.stringify(value)
