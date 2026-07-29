import { bashToolInputSchema, bashToolOutputSchema } from "@socrates/contracts"
import type { SocratesTool, ToolPolicyDecision } from "./types"

const highRiskCommandPattern =
  /\b(sudo|rm\s+-rf|Remove-Item|del\s+\/[sq]|rmdir\s+\/[sq]|mkfs|dd\s+if=|chmod\s+-R|chown\s+-R|git\s+(commit|push|reset|clean|checkout|switch|merge|rebase)|docker|curl|Invoke-WebRequest|wget|pnpm\s+(add|install|i|dev|start)|npm\s+(install|i|start|run\s+dev)|yarn\s+(add|dev|start)|migrate|prisma\s+migrate)\b/i

const decideBashPolicy: SocratesTool<typeof bashToolInputSchema._type, typeof bashToolOutputSchema._type>["decidePolicy"] = (
  input,
  context,
): ToolPolicyDecision => {
  const operation = input.operation
  const readOnly = context.filesystemAuthorization
    ? context.filesystemAuthorization.mode === "read_only"
    : context.runtimeConfig.sandboxMode === "read_only" || context.runtimeConfig.approvalMode === "read_only_auto"
  if (readOnly) {
    return { type: "denied", reason: "Terminal is not available while Access is set to Read only. Use read or search for structured inspection." }
  }
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
  if (context.runtimeConfig.approvalMode === "approve_all" && !highRiskCommandPattern.test(preview)) {
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
          ? "Socrates wants to start a background Terminal in the active project workspace."
          : "Socrates wants to run a command in the active project workspace.",
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
    "Run commands or manage named persistent Terminals from an authorized working directory. Terminal runs as the local user and is not OS-sandboxed; path selection checks cwd but cannot promise process containment. Use run for a bounded foreground command, start with a unique name for a server or interactive process, inspect with that name to receive status plus new output, stop with that name, and list to discover existing names. Prefer read, search, edit, and apply_patch for structured file work. Use inputMode=user when the visible Terminal must accept user input.",
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
