export type GoalCandidateCard = Readonly<{
  goalId: string
  candidate: number
  status: string
  title: string
  note: string
}>

export type ActiveGoalCard = Readonly<{
  goalId: string
  title: string
  state: string
  note: string
  openDecisions?: readonly string[]
  blockers?: readonly string[]
  objective?: string
  taskOrdinal?: number
  taskRequest?: string
  transition?: Readonly<{
    previousGoalTitle: string
    relationship: string
    verifiedOutcome: string
  }>
}>
