import type { ApprovalDecision, ApprovalRequest, SocratesAgentTurnInput } from "@socrates/core"
import { SocratesError } from "@socrates/shared"
import type { CanonicalSocratesStore } from "../services/canonical/canonicalSocratesStore"

type CredentialRequest = Parameters<NonNullable<SocratesAgentTurnInput["requestCredentialInput"]>>[0]
type CredentialDecision = Awaited<ReturnType<NonNullable<SocratesAgentTurnInput["requestCredentialInput"]>>>

type PendingApproval = { interactionId: string; taskId: string; resolve: (decision: ApprovalDecision) => void }
type PendingCredential = { interactionId: string; taskId: string; source: CredentialRequest["source"]; resolve: (decision: CredentialDecision) => void }

/**
 * One task-scoped in-memory bridge from core's approval/credential callbacks to
 * canonical interaction rows. SQLite records the request and public decision;
 * credentials themselves remain only in the resolving promise.
 */
export class CanonicalInteractionCoordinator {
  private readonly approvals = new Map<string, PendingApproval>()
  private readonly approvalInteractionIds = new Map<string, string>()
  private readonly credentials = new Map<string, PendingCredential>()

  constructor(private readonly store: CanonicalSocratesStore) {}

  registerApproval(taskId: string, request: ApprovalRequest): string {
    const interactionId = this.store.createInteraction({
      taskId,
      kind: request.toolName === "handover_to_frontier" ? "frontier_approval" : "approval",
      toolCallId: request.toolCallId,
      fingerprint: `${request.toolName}:${request.actionPreview}`,
      prompt: request.title,
      publicPayload: {
        toolName: request.toolName,
        actionKind: request.actionKind,
        actionPreview: request.actionPreview,
        risk: request.risk,
        ...(request.description ? { description: request.description } : {}),
      },
    })
    this.approvalInteractionIds.set(request.approvalId, interactionId)
    this.store.markTaskAwaitingInput(taskId)
    return interactionId
  }

  waitForApproval(taskId: string, request: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalDecision> {
    const interactionId = this.findInteractionForApproval(taskId, request.approvalId)
    return new Promise((resolve) => {
      const settle = (decision: ApprovalDecision) => {
        this.approvals.delete(interactionId)
        this.approvalInteractionIds.delete(request.approvalId)
        signal?.removeEventListener("abort", onAbort)
        resolve(decision)
      }
      const onAbort = () => settle({ decision: "rejected", reason: "The task was cancelled." })
      this.approvals.set(interactionId, { interactionId, taskId, resolve: settle })
      signal?.addEventListener("abort", onAbort, { once: true })
    })
  }

  async requestCredential(taskId: string, request: CredentialRequest, signal?: AbortSignal): Promise<CredentialDecision> {
    const interactionId = this.store.createInteraction({
      taskId,
      kind: "credential",
      toolCallId: request.toolCallId,
      fingerprint: `${request.serverId}:${request.envKey}`,
      prompt: `Provide ${request.envKey} for ${request.serverLabel ?? request.serverId}.`,
      publicPayload: { serverId: request.serverId, ...(request.serverLabel ? { serverLabel: request.serverLabel } : {}), envKey: request.envKey, source: request.source },
    })
    this.store.markTaskAwaitingInput(taskId)
    return new Promise((resolve) => {
      const settle = (decision: CredentialDecision) => {
        this.credentials.delete(interactionId)
        signal?.removeEventListener("abort", onAbort)
        resolve(decision)
      }
      const onAbort = () => settle({ decision: "cancelled", source: request.source })
      this.credentials.set(interactionId, { interactionId, taskId, source: request.source, resolve: settle })
      signal?.addEventListener("abort", onAbort, { once: true })
    })
  }

  resolve(input: { interactionId: string; decision: "approved" | "rejected" | "submitted"; publicResolution?: Record<string, unknown>; secret?: string }): void {
    const approval = this.approvals.get(input.interactionId)
    const credential = this.credentials.get(input.interactionId)
    if (!approval && !credential) {
      throw new SocratesError("interaction_not_waiting", "That interaction is not awaiting an active task.", { recoverable: true })
    }
    if (approval && input.decision === "submitted") {
      throw new SocratesError("approval_decision_invalid", "An approval must be approved or rejected.", { recoverable: true })
    }
    if (credential && input.decision !== "submitted" && input.decision !== "rejected") {
      throw new SocratesError("credential_decision_invalid", "Credential input must be submitted or rejected.", { recoverable: true })
    }
    this.store.resolveInteraction({
      id: input.interactionId,
      decision: input.decision,
      ...(input.publicResolution ? { publicResolution: input.publicResolution } : {}),
    })
    const taskId = approval?.taskId ?? credential!.taskId
    this.store.resumeTaskAfterInteraction(taskId)
    if (approval) {
      const decision: ApprovalDecision = input.decision === "approved"
        ? { decision: "approved" }
        : { decision: "rejected", ...(input.publicResolution?.reason && typeof input.publicResolution.reason === "string" ? { reason: input.publicResolution.reason } : {}) }
      approval.resolve(decision)
    } else credential!.resolve(input.decision === "submitted"
      ? { decision: "submitted", value: input.secret, source: credential!.source }
      : { decision: "cancelled", source: credential!.source })
  }

  cancelTask(taskId: string, reason: string): void {
    for (const [id, approval] of this.approvals) {
      if (approval.taskId !== taskId) continue
      approval.resolve({ decision: "rejected", reason })
      this.approvals.delete(id)
    }
    for (const [id, credential] of this.credentials) {
      if (credential.taskId !== taskId) continue
      credential.resolve({ decision: "cancelled", source: credential.source })
      this.credentials.delete(id)
    }
  }

  private findInteractionForApproval(taskId: string, approvalId: string): string {
    // Core emits approval.requested before calling requestApproval. Its opaque
    // approval id is transport-local, so a pending interaction is keyed by the
    // tool request and registered immediately by canonical execution.
    const interactionId = this.approvalInteractionIds.get(approvalId)
    if (!interactionId) throw new SocratesError("approval_interaction_missing", "The approval request was not registered for this task.")
    return interactionId
  }
}
