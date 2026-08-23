import crypto from "node:crypto"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const terminalSupervisorProtocolVersion = "pty-v4-20260715-lifecycle"

export const terminalSupervisorSocketPath = (scope: string): string => {
  const hash = crypto.createHash("sha256").update(`${scope}:${terminalSupervisorProtocolVersion}`).digest("hex").slice(0, 16)
  return process.platform === "win32" ? `\\\\.\\pipe\\socrates-terminal-${hash}` : path.join(os.tmpdir(), `socrates-terminal-${hash}.sock`)
}

export const terminalHostSocketPath = (supervisorSocketPath: string, terminalId: string): string => {
  const suffix = crypto.createHash("sha256").update(terminalId).digest("hex").slice(0, 16)
  return process.platform === "win32"
    ? `\\\\.\\pipe\\socrates-terminal-host-${suffix}`
    : path.join(path.dirname(supervisorSocketPath), `socrates-terminal-host-${suffix}.sock`)
}

export const terminalChildProcessArgs = (
  parentModuleUrl: string,
  childModuleName: string,
  args: readonly string[],
): string[] => {
  const sourceRuntime = fileURLToPath(parentModuleUrl).endsWith(".ts")
  const childPath = fileURLToPath(new URL(`./${childModuleName}.${sourceRuntime ? "ts" : "js"}`, parentModuleUrl))
  if (!sourceRuntime) return [childPath, ...args]
  // Resolve from the server workspace that owns this helper. Detached children
  // must not depend on whichever cwd happened to launch the server.
  const loaderUrl = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href
  return ["--import", loaderUrl, childPath, ...args]
}
