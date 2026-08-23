"use client";

import { Check, ChevronDown, CircleAlert, KeyRound, Square, Terminal, Wrench, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import type {
  SocratesApproval,
  SocratesCredentialInputRequest,
  SocratesGoalRoutingRun,
  SocratesTerminal,
} from "@socrates/contracts";
import type { SocratesLiveWorkItem, SocratesStage } from "@/lib/socrates/presentation";
import type { SocratesTerminalOutput } from "@/lib/socrates/reducer";
import styles from "./socrates.module.css";

type WorkDisclosureProps = Readonly<{
  stage: SocratesStage;
  work: readonly SocratesLiveWorkItem[];
  approvals: readonly SocratesApproval[];
  credentials: readonly SocratesCredentialInputRequest[];
  clarification?: SocratesGoalRoutingRun;
  terminals: readonly SocratesTerminal[];
  terminalOutputs: Readonly<Record<string, readonly SocratesTerminalOutput[]>>;
  onApproval: (approvalId: string, decision: "approved" | "rejected") => void;
  onCredential: (request: SocratesCredentialInputRequest, decision: "submitted" | "cancelled", value?: string) => void;
  onClarification: (answer: string) => void;
  onTerminalInput: (terminalId: string, value: string) => void;
  onTerminalStop: (terminalId: string) => void;
}>;

export function WorkDisclosure({
  stage,
  work,
  approvals,
  credentials,
  clarification,
  terminals,
  terminalOutputs,
  onApproval,
  onCredential,
  onClarification,
  onTerminalInput,
  onTerminalStop,
}: WorkDisclosureProps) {
  const active = stage.kind === "working" || stage.kind === "recovery" || stage.kind === "awaiting_input";
  const actionCount = approvals.length + credentials.length + (clarification ? 1 : 0) + terminals.filter((terminal) => terminal.awaitingInput).length;
  return (
    <details id="socrates-work-disclosure" className={styles.workDisclosure} open={stage.kind === "awaiting_input"}>
      <summary>
        <ChevronDown aria-hidden="true" />
        <span>{active ? "Thinking and work" : "Work details"}</span>
        {active ? <i className={styles.workPulse} aria-label="Work is updating"><b /><b /><b /></i> : null}
        {actionCount ? <em>{actionCount} action{actionCount === 1 ? "" : "s"}</em> : null}
      </summary>
      <div className={styles.workDisclosureBody}>
        <p className={styles.reasoningNotice}>Socrates shows concise work commentary and exact tool evidence here. Private chain-of-thought is never exposed.</p>
        {clarification ? (
          <ClarificationForm question={clarification.clarificationQuestion ?? "Which goal should this continue?"} onSubmit={onClarification} />
        ) : null}
        {approvals.map((approval) => (
          <div key={approval.id} className={styles.actionCard}>
            <CircleAlert aria-hidden="true" />
            <span><strong>Approval needed</strong><small>{approval.actionKind.replaceAll("_", " ")}</small></span>
            <button type="button" onClick={() => onApproval(approval.id, "rejected")}><X aria-hidden="true" />Reject</button>
            <button type="button" data-primary="true" onClick={() => onApproval(approval.id, "approved")}><Check aria-hidden="true" />Approve</button>
          </div>
        ))}
        {credentials.map((request) => <CredentialForm key={request.id} request={request} onResolve={onCredential} />)}
        {terminals.map((terminal) => (
          <TerminalCard
            key={terminal.id}
            terminal={terminal}
            outputs={terminalOutputs[terminal.id] ?? []}
            onInput={onTerminalInput}
            onStop={onTerminalStop}
          />
        ))}
        {work.length ? (
          <ul className={styles.workList}>
            {work.map((item) => (
              <li key={item.id} data-state={item.state}>
                {item.kind === "terminal" ? <Terminal aria-hidden="true" /> : <Wrench aria-hidden="true" />}
                <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                <em>{item.state}</em>
              </li>
            ))}
          </ul>
        ) : <p className={styles.noWork}>Exact tools and evidence will appear as Socrates works.</p>}
      </div>
    </details>
  );
}

function ClarificationForm({ question, onSubmit }: Readonly<{ question: string; onSubmit: (answer: string) => void }>) {
  const [answer, setAnswer] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (answer.trim()) onSubmit(answer.trim());
  };
  return (
    <form className={styles.inlineInputCard} onSubmit={submit}>
      <strong>{question}</strong>
      <div><input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Tell Socrates which goal you mean" /><button type="submit">Continue</button></div>
    </form>
  );
}

function CredentialForm({ request, onResolve }: Readonly<{
  request: SocratesCredentialInputRequest;
  onResolve: (request: SocratesCredentialInputRequest, decision: "submitted" | "cancelled", value?: string) => void;
}>) {
  const [value, setValue] = useState("");
  return (
    <form className={styles.actionCard} onSubmit={(event) => { event.preventDefault(); if (value) onResolve(request, "submitted", value); }}>
      <KeyRound aria-hidden="true" />
      <span><strong>{request.serverLabel ?? request.serverId}</strong><small>Enter {request.envKey}. It is handed to this wait only and is not written to the trace.</small></span>
      <input type="password" value={value} onChange={(event) => setValue(event.target.value)} autoComplete="off" aria-label={request.envKey} />
      <button type="button" onClick={() => onResolve(request, "cancelled")}>Cancel</button>
      <button type="submit" data-primary="true" disabled={!value}>Submit</button>
    </form>
  );
}

function TerminalCard({ terminal, outputs, onInput, onStop }: Readonly<{
  terminal: SocratesTerminal;
  outputs: readonly SocratesTerminalOutput[];
  onInput: (terminalId: string, value: string) => void;
  onStop: (terminalId: string) => void;
}>) {
  const [value, setValue] = useState("");
  const output = outputs.map((item) => item.text).join("").slice(-12_000);
  return (
    <details className={styles.terminalCard} open={terminal.awaitingInput}>
      <summary><Terminal aria-hidden="true" /><strong>{terminal.name}</strong><small>{terminal.status}</small></summary>
      <p>{terminal.cwd}</p>
      <pre>{output || "Terminal output will stream here."}</pre>
      <form onSubmit={(event) => { event.preventDefault(); if (!value) return; onInput(terminal.id, value); setValue(""); }}>
        <input value={value} onChange={(event) => setValue(event.target.value)} placeholder={terminal.awaitingInput ? "Terminal input" : "Send input"} />
        <button type="submit">Send</button>
        <button type="button" onClick={() => onStop(terminal.id)}><Square aria-hidden="true" />Stop</button>
      </form>
    </details>
  );
}
