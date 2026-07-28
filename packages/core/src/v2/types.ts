import type {
  V2Goal as ContractV2Goal,
  V2GoalCapsule as ContractV2GoalCapsule,
} from "@socrates/contracts"

export type V2GoalStatus = ContractV2Goal["status"]
export type V2Goal = ContractV2Goal
export type V2GoalCapsule = ContractV2GoalCapsule

export type V2GoalRoutingAction = "continue" | "resume" | "create" | "clarify"

export type V2GoalRoutingDecision = Readonly<{
  action: V2GoalRoutingAction
  primaryGoalId?: string
  title?: string
  clarificationQuestion?: string
  clarificationGoalIds?: readonly string[]
}>

export type V2GoalRoutingCandidate = Readonly<{
  goal: V2Goal
  capsule?: V2GoalCapsule
  candidate: number
  latestTask?: string
}>

export type V2GoalRoutingCandidateSet = Readonly<{
  foreground?: V2GoalRoutingCandidate
  parked: readonly V2GoalRoutingCandidate[]
  candidates: readonly V2GoalRoutingCandidate[]
  totalEligibleParked: number
  parkedCandidateLimit: number
}>

export type V2GoalTransition = Readonly<{
  goalId: string
  from: V2GoalStatus
  to: V2GoalStatus
}>

export type V2GoalRoutingPlan = Readonly<{
  action: Exclude<V2GoalRoutingAction, "clarify">
  foregroundGoalId: string
  createGoal: boolean
  transitions: readonly V2GoalTransition[]
}>

export type V2CapsuleRefreshReason =
  | "initial"
  | "parked"
  | "material_change"
  | "pre_compaction"
  | "completed"
  | "stale"

export type ImmutableEvidenceRef = Readonly<{
  evidenceId: string
  flowId: string
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
