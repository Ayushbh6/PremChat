import type {
  SocratesGoal as ContractSocratesGoal,
  SocratesGoalCapsule as ContractSocratesGoalCapsule,
} from "@socrates/contracts"

export type SocratesGoalStatus = ContractSocratesGoal["status"]
export type SocratesGoal = ContractSocratesGoal
export type SocratesGoalCapsule = ContractSocratesGoalCapsule

export type SocratesGoalRoutingAction = "continue" | "resume" | "create" | "clarify"

export type SocratesGoalRoutingDecision = Readonly<{
  action: SocratesGoalRoutingAction
  primaryGoalId?: string
  title?: string
  clarificationQuestion?: string
  clarificationGoalIds?: readonly string[]
}>

export type SocratesGoalRoutingCandidate = Readonly<{
  goal: SocratesGoal
  capsule?: SocratesGoalCapsule
  candidate: number
  latestTask?: string
}>

export type SocratesGoalRoutingCandidateSet = Readonly<{
  foreground?: SocratesGoalRoutingCandidate
  parked: readonly SocratesGoalRoutingCandidate[]
  candidates: readonly SocratesGoalRoutingCandidate[]
  totalEligibleParked: number
  parkedCandidateLimit: number
}>

export type SocratesGoalTransition = Readonly<{
  goalId: string
  from: SocratesGoalStatus
  to: SocratesGoalStatus
}>

export type SocratesGoalRoutingPlan = Readonly<{
  action: Exclude<SocratesGoalRoutingAction, "clarify">
  foregroundGoalId: string
  createGoal: boolean
  transitions: readonly SocratesGoalTransition[]
}>

export type SocratesCapsuleRefreshReason =
  | "initial"
  | "parked"
  | "material_change"
  | "pre_compaction"
  | "completed"
  | "stale"

export type ImmutableEvidenceRef = Readonly<{
  evidenceId: string
  taskId: string
  sourceType: string
  sourceLocator: string
  contentHash: string
  capturedAt: string
}>

export type ImmutableEvidenceRecord = Readonly<{
  ref: ImmutableEvidenceRef
  exactContent: string
  metadata?: Readonly<Record<string, unknown>>
}>
