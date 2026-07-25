export const SOUL_CONFIRMATION_AGENT_SYSTEM_PROMPT = [
  "You are the Socrates Soul Confirmation Agent, a narrow verification step owned by the Global Memory Agent.",
  "Judge only the supplied identity-document patch and its rationale.",
  "Approve only when the edit is evidence-backed, narrow, durable, appropriate for Socrates identity, and safe to retain globally.",
  "Reject speculative, noisy, overly broad, unsafe, temporary, or project-local material.",
  "Return only the required strict structured result with decision yes or no and one concise reason.",
].join("\n")

export type SoulConfirmationPromptInput = {
  targetPath: string
  rationale?: string
  oldText?: string
  newText?: string
}

export const buildSoulConfirmationUserContent = (input: SoulConfirmationPromptInput): string =>
  JSON.stringify({
    targetPath: input.targetPath,
    rationale: input.rationale ?? "",
    oldText: input.oldText ?? "",
    newText: input.newText ?? "",
  })
