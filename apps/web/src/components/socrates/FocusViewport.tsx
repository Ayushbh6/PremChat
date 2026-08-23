"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronDown, Copy, RotateCcw } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SocratesApproval, SocratesCredentialInputRequest, SocratesGoalRoutingRun, SocratesTerminal } from "@socrates/contracts";
import type { SocratesDisplayedExchange, SocratesLiveWorkItem, SocratesStage } from "@/lib/socrates/presentation";
import type { SocratesTerminalOutput } from "@/lib/socrates/reducer";
import { LivingSphere, type SocratesPresence } from "./LivingSphere";
import { WorkDisclosure } from "./WorkDisclosure";
import styles from "./socrates.module.css";

type FocusViewportProps = Readonly<{
  exchange: SocratesDisplayedExchange | null;
  stage: SocratesStage;
  historical: boolean;
  work: readonly SocratesLiveWorkItem[];
  approvals: readonly SocratesApproval[];
  credentials: readonly SocratesCredentialInputRequest[];
  clarification?: SocratesGoalRoutingRun;
  terminals: readonly SocratesTerminal[];
  terminalOutputs: Readonly<Record<string, readonly SocratesTerminalOutput[]>>;
  onReturnCurrent: () => void;
  onRetry: () => void;
  onApproval: (approvalId: string, decision: "approved" | "rejected") => void;
  onCredential: (request: SocratesCredentialInputRequest, decision: "submitted" | "cancelled", value?: string) => void;
  onClarification: (answer: string) => void;
  onTerminalInput: (terminalId: string, value: string) => void;
  onTerminalStop: (terminalId: string) => void;
}>;

export function FocusViewport(props: FocusViewportProps) {
  const reduceMotion = useReducedMotion();
  const [queryExpanded, setQueryExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const answer = props.exchange?.assistantMessage?.content ?? props.exchange?.streamingAnswer;
  const presence = presenceForStage(props.stage);
  const live = props.stage.kind === "working" || props.stage.kind === "recovery" || props.stage.kind === "awaiting_input";
  const final = props.stage.kind === "final" && Boolean(answer);

  const copy = async () => {
    if (!answer) return;
    await navigator.clipboard.writeText(answer);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <div className={styles.viewportScroller}>
      <div className={styles.exchangeCanvas} data-stage={props.stage.kind} data-historical={props.historical || undefined}>
        {props.historical ? (
          <div className={styles.historyBanner}>
            <span>Viewing an exact past exchange</span>
            <button type="button" onClick={props.onReturnCurrent}>Return to current</button>
          </div>
        ) : null}
        {props.exchange ? (
          <motion.section
            key={props.exchange.id}
            className={styles.userQueryArea}
            initial={reduceMotion ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className={styles.userQuery} data-expanded={queryExpanded || undefined}>
              <p>{props.exchange.userMessage.content || "Attached files"}</p>
              {props.exchange.userMessage.attachments?.length ? (
                <div className={styles.queryAttachments}>{props.exchange.userMessage.attachments.map((attachment) => <span key={attachment.id}>{attachment.fileName}</span>)}</div>
              ) : null}
              <button type="button" onClick={() => setQueryExpanded((value) => !value)}>
                {queryExpanded ? "Show less" : "Show more"}<ChevronDown aria-hidden="true" />
              </button>
            </div>
          </motion.section>
        ) : null}

        <div className={styles.focusStage}>
          <div className={styles.orbPlane} data-receded={final || undefined}>
            <LivingSphere
              state={presence}
              statusLabel={props.stage.label}
              showStatus={!final && (Boolean(props.exchange) || props.stage.kind !== "idle")}
            />
          </div>
          <AnimatePresence mode="wait">
            {final ? (
              <motion.article
                key={`answer-${props.exchange?.id ?? "current"}`}
                className={styles.answerSheet}
                initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.42, ease: [0.2, 0.72, 0.2, 1] }}
              >
                <div className={styles.answerMarkdown}><ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown></div>
                <div className={styles.answerActions}>
                  <button type="button" onClick={() => void copy()}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? "Copied" : "Copy"}</button>
                </div>
              </motion.article>
            ) : props.stage.kind === "failed" || props.stage.kind === "cancelled" ? (
              <motion.div key="failure" className={styles.failurePanel} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <span>{props.stage.kind === "failed" ? "Task interrupted" : "Task cancelled"}</span>
                <h2>{props.stage.label}</h2>
                <button type="button" onClick={props.onRetry}><RotateCcw aria-hidden="true" />Try again</button>
              </motion.div>
            ) : null}
          </AnimatePresence>
          {(live || props.work.length > 0 || props.approvals.length > 0 || props.credentials.length > 0 || props.terminals.length > 0) ? (
            <WorkDisclosure
              stage={props.stage}
              work={props.work}
              approvals={props.approvals}
              credentials={props.credentials}
              clarification={props.clarification}
              terminals={props.terminals}
              terminalOutputs={props.terminalOutputs}
              onApproval={props.onApproval}
              onCredential={props.onCredential}
              onClarification={props.onClarification}
              onTerminalInput={props.onTerminalInput}
              onTerminalStop={props.onTerminalStop}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

const presenceForStage = (stage: SocratesStage): SocratesPresence => {
  if (stage.kind === "working") {
    if (stage.phase === "routing") return "routing";
    if (stage.phase === "tool") return "working";
    return "thinking";
  }
  if (stage.kind === "recovery") return "routing";
  if (stage.kind === "awaiting_input") return "awaiting_input";
  if (stage.kind === "final") return "complete";
  if (stage.kind === "failed" || stage.kind === "cancelled") return "error";
  return "idle";
};
