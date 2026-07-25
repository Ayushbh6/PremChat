"use client"

import type { ConversationToolRun, V2LiveActivity } from "@socrates/contracts"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ChatToolTimeline } from "@/components/chat/ChatToolTimeline"
import type { PendingApproval, PendingCredentialInput } from "@/components/chat/ToolTimelineTypes"
import { toolRunToTimelineItem } from "@/components/chat/ToolTimelineTypes"
import { LivingSphere } from "./LivingSphere"
import type { FlowPresenceState } from "./types"
import styles from "./flowStage.module.css"

interface FlowLiveStageProps {
  activity?: V2LiveActivity
  presenceState: FlowPresenceState
  turnId: string
  toolRuns: ConversationToolRun[]
  approvals: PendingApproval[]
  credentialRequests: PendingCredentialInput[]
  onApprovalDecision?: (approvalId: string, decision: "approved" | "rejected") => void
  onCredentialInput?: (request: PendingCredentialInput, decision: "submitted" | "cancelled", value?: string) => void
}

export function FlowLiveStage({
  activity,
  presenceState,
  turnId,
  toolRuns,
  approvals,
  credentialRequests,
  onApprovalDecision,
  onCredentialInput,
}: FlowLiveStageProps) {
  const reduceMotion = useReducedMotion()
  const label = activity?.turnId === turnId ? activity.label : "Working on your request…"
  const actionableToolIds = new Set([
    ...approvals.map((approval) => approval.toolCallId).filter((id): id is string => Boolean(id)),
    ...credentialRequests.map((request) => request.toolCallId),
  ])
  const actionableTools = toolRuns
    .filter((tool) => tool.turnId === turnId && actionableToolIds.has(tool.toolCallId))
    .map(toolRunToTimelineItem)

  return (
    <motion.section
      className={styles.liveStage}
      data-flow-live-stage
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.985 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
      aria-label="Socrates is working"
    >
      <LivingSphere state={presenceState} size="full" statusLabel={label} showStatus={false} />
      <div className={styles.activitySlot}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={label}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-flow-live-activity
            initial={reduceMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <span aria-hidden="true" />
            {label}
          </motion.p>
        </AnimatePresence>
      </div>
      {(approvals.length > 0 || credentialRequests.length > 0) ? (
        <div className={styles.actionPanel} data-flow-live-action>
          <ChatToolTimeline
            tools={actionableTools}
            approvals={approvals}
            credentialRequests={credentialRequests}
            onApprovalDecision={onApprovalDecision}
            onCredentialInput={onCredentialInput}
          />
        </div>
      ) : null}
    </motion.section>
  )
}
