import { bashToolInputSchema, bashToolOutputSchema } from "@socrates/contracts"
import type { SocratesTool, ToolPolicyDecision } from "./types"
import { decideAccess } from "./accessPolicy"

const highRiskCommandPattern =
  /\b(sudo|rm\s+-rf|Remove-Item|del\s+\/[sq]|rmdir\s+\/[sq]|mkfs|dd\s+if=|chmod\s+-R|chown\s+-R|git\s+(commit|push|reset|clean|checkout|switch|merge|rebase)|docker|curl|Invoke-WebRequest|wget|pnpm\s+(add|install|i|dev|start)|npm\s+(install|i|start|run\s+dev)|yarn\s+(add|dev|start)|migrate|prisma\s+migrate)\b/i

// This is an explicit product hard-denial classifier, not the containment
// boundary. Native Terminal containment protects child processes from writes
// outside their exact roots; command preflight prevents named catastrophic
// operations before an approval or Full-mode launch can reach that boundary.
const catastrophicCommandPattern =
  /(?:\brm\s+-[^\n]*r[^\n]*f\s+(?:\/|~\/?|\$HOME\b)|\b(?:rm\s+-[^\n]*r[^\n]*f\s+)?\/dev\/(?:disk|rdisk)|\b(?:mkfs|diskutil\s+eraseDisk)\b|\bdd\s+if=.*\sof=\/dev\/|\b(?:format\s+[A-Za-z]:|Remove-Item\s+.*(?:C:\\|\$env:USERPROFILE)|del\s+.*(?:C:\\|%USERPROFILE%)))/i

const decideBashPolicy: SocratesTool<typeof bashToolInputSchema._type, typeof bashToolOutputSchema._type>["decidePolicy"] = (
  input,
  context,
): ToolPolicyDecision => {
  const operation = input.operation
  if (operation === "inspect" || operation === "stop" || operation === "list") {
    return { type: "auto" }
  }

  const rawCommand = "command" in input ? input.command : undefined
  const command = rawCommand?.trim()
  if (rawCommand !== undefined && isNoopTerminalCommand(rawCommand)) {
    return {
      type: "denied",
      code: "terminal_noop_command",
      recoverable: true,
      reason: "Terminal is for executable commands, not notes. Use assistant text for notes, or call read, search, MCP, or browser tools for inspection.",
    }
  }

  const preview = command ?? "Terminal command"
  if (catastrophicCommandPattern.test(preview)) {
    return {
      type: "denied",
      code: "terminal_catastrophic_operation_denied",
      recoverable: false,
      reason: "This command is a protected catastrophic operation and cannot be run by Socrates in any access mode.",
    }
  }

  if (decideAccess({ authorization: context.filesystemAuthorization, action: "terminal_run" }) === "automatic") {
    return { type: "auto" }
  }

  return {
    type: "approval_required",
    request: {
      actionKind: /^git\s+commit\b/i.test(preview)
        ? "git_commit"
        : /^git\s+push\b/i.test(preview)
          ? "git_push"
          : "shell_command",
      title: "Approve shell command",
      description:
        operation === "start"
          ? "Socrates wants to start a background Terminal from the task's working directory."
          : "Socrates wants to run this exact command from the task's working directory.",
      actionPreview: preview,
      risk: highRiskCommandPattern.test(preview) ? "high" : "medium",
    },
  }
}

const isNoopTerminalCommand = (command: string): boolean => {
  const lines = command
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.length === 0 || lines.every((line) => line.startsWith("#"))
}

export const bashTool: SocratesTool<typeof bashToolInputSchema._type, typeof bashToolOutputSchema._type> = {
  name: "bash",
  description:
    "Run commands or manage named persistent Terminals from an authorized working directory. Terminal launches use native process containment that restricts descendant writes to exact task and resource roots; if that containment cannot be established, automatic Full-access Terminal launch fails closed. Protected catastrophic operations remain denied in every access mode. Use run for a foreground command, start with a unique name for a server or interactive process, inspect with that name to receive status plus new output, stop with that name, and list to discover existing names. Prefer read, search, edit, and apply_patch for structured file work. Use inputMode=user when the visible Terminal must accept user input.",
  inputSchema: bashToolInputSchema,
  resultSchema: bashToolOutputSchema,
  permission: "execute",
  executeLane: "mutation",
  category: "shell",
  decidePolicy: decideBashPolicy,
  execute: (input, context) => context.executors.bash(input, context),
  summary: (output) => {
    const operation = output.operation ?? "run"
    if (output.reusedTerminal) {
      return output.message ?? `Reused Terminal ${output.terminal?.name ?? "session"}.`
    }
    if (operation === "start" && output.process) {
      return `Started Terminal ${output.terminal?.name ?? "session"}.`
    }
    if ((operation === "inspect" || operation === "status" || operation === "output" || operation === "stop") && output.process) {
      return `Terminal ${output.terminal?.name ?? "session"} is ${output.process.status}.`
    }
    if (operation === "list") {
      return `${output.totalMatches ?? output.terminals?.length ?? 0} Terminal(s) listed.`
    }
    return `Command exited ${output.exitCode === null ? "without an exit code" : `with code ${output.exitCode}`}.`
  },
  resultPreview: (output) => [output.stdout, output.stderr].filter(Boolean).join("\n"),
  metrics: () => ({ commandsRun: 1 }),
}
