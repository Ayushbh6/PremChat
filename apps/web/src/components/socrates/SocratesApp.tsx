"use client";

import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import type { SocratesGoalExchange, SocratesMessageAttachment } from "@socrates/contracts";
import { selectSocratesPresentation, type SocratesClientView } from "@/lib/socrates/presentation";
import { useSocratesRuntime } from "@/lib/socrates/useSocratesRuntime";
import { FocusViewport } from "./FocusViewport";
import { GoalSidebar } from "./GoalSidebar";
import { LiveNotes } from "./LiveNotes";
import { LivingSphere } from "./LivingSphere";
import { SocratesComposer } from "./SocratesComposer";
import { SocratesHeader } from "./SocratesHeader";
import styles from "./socrates.module.css";

export function SocratesApp() {
  const runtime = useSocratesRuntime();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<SocratesClientView>({ displayMode: "current" });
  const [actionError, setActionError] = useState<string | null>(null);

  const exchanges = useMemo(() => [...new Map([
    ...Object.values(runtime.goalExchanges).flat(),
    ...(runtime.historySearch?.exchanges ?? []),
  ].map((exchange) => [exchange.taskId, exchange])).values()] as SocratesGoalExchange[], [runtime.goalExchanges, runtime.historySearch?.exchanges]);

  const presentation = useMemo(() => runtime.state ? selectSocratesPresentation({
    runtime: runtime.state,
    exchanges,
    view,
    socketStatus: runtime.connectionStatus,
    socketError: runtime.socketError,
  }) : null, [exchanges, runtime.connectionStatus, runtime.socketError, runtime.state, view]);

  if (runtime.isHydrating) {
    return (
      <main className={styles.routeState}>
        <div className={styles.oceanTexture} aria-hidden="true" />
        <LivingSphere state="routing" size="compact" statusLabel="Opening Socrates" />
      </main>
    );
  }

  if (!runtime.state || !presentation) {
    return (
      <main className={styles.routeState}>
        <div className={styles.oceanTexture} aria-hidden="true" />
        <LivingSphere state="error" size="compact" statusLabel="Socrates needs attention" />
        <p role="alert">{runtime.loadError ?? "Socrates could not be opened."}</p>
        <button type="button" onClick={() => void runtime.refresh()}><RefreshCw aria-hidden="true" />Try again</button>
      </main>
    );
  }

  const snapshot = runtime.state.snapshot;
  const currentGoal = snapshot.foregroundGoal
    ?? runtime.goals.find((goal) => goal.id === snapshot.state.foregroundGoalId);
  const currentCapsule = snapshot.latestCapsules.find((capsule) => capsule.goalId === currentGoal?.id);
  const taskLabel = snapshot.liveActivity?.label
    ?? (snapshot.pendingClarification ? "Choosing the right goal" : snapshot.activeTask ? "Working on the current task" : "Ready for your next thought");
  const active = ["working", "recovery", "awaiting_input"].includes(presentation.stage.kind);
  const visibleError = actionError ?? runtime.socketError ?? runtime.modelError;

  const guard = (action: () => void) => {
    setActionError(null);
    try {
      action();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "That action could not be sent.");
    }
  };

  const send = (content: string, attachments: readonly SocratesMessageAttachment[]) => {
    setView({ displayMode: "current" });
    guard(() => {
      if (snapshot.pendingClarification) runtime.respondToClarification(content);
      else runtime.sendMessage(content, attachments.map((attachment) => attachment.id));
    });
  };

  const retry = () => {
    const failed = presentation.displayedExchange;
    if (!failed) return void runtime.refresh();
    setView({ displayMode: "current" });
    guard(() => runtime.sendMessage(
      failed.userMessage.content,
      failed.userMessage.attachments?.map((attachment) => attachment.id) ?? [],
    ));
  };

  const openWork = () => {
    const disclosure = document.getElementById("socrates-work-disclosure") as HTMLDetailsElement | null;
    if (disclosure) {
      disclosure.open = true;
      disclosure.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  return (
    <main className={styles.socratesApp}>
      <div className={styles.oceanTexture} aria-hidden="true" />
      <SocratesHeader onOpenGoals={() => setSidebarOpen(true)} />
      <GoalSidebar
        key={sidebarOpen ? "open" : "closed"}
        open={sidebarOpen}
        goals={runtime.goals}
        foregroundGoalId={snapshot.state.foregroundGoalId}
        exchanges={runtime.goalExchanges}
        windows={runtime.exchangeWindows}
        loadingGoalIds={runtime.loadingGoalIds}
        hasEarlierGoals={Boolean(runtime.goalWindow?.hasEarlier)}
        loadingEarlierGoals={runtime.isLoadingEarlierGoals}
        searching={runtime.isSearching}
        onClose={() => setSidebarOpen(false)}
        onLoadEarlierGoals={() => void runtime.loadEarlierGoals()}
        onLoadExchanges={(goalId, earlier) => void runtime.loadGoalExchanges(goalId, earlier)}
        onSearch={(query) => void runtime.searchHistory(query)}
        onSelectExchange={(goalId, exchangeId) => {
          setView({ displayMode: "history", viewedGoalId: goalId, viewedExchangeId: exchangeId });
          setSidebarOpen(false);
        }}
        onGoalAction={(goalId, action) => {
          if (action === "switch") setView({ displayMode: "current" });
          guard(() => runtime.updateGoal(goalId, action));
        }}
      />
      {sidebarOpen ? <button type="button" className={styles.sidebarBackdrop} aria-label="Close goals sidebar" onClick={() => setSidebarOpen(false)} /> : null}
      <section className={styles.mainShell}>
        <FocusViewport
          exchange={presentation.displayedExchange}
          stage={presentation.stage}
          historical={!presentation.isDisplayingCurrent}
          work={presentation.liveWork}
          approvals={snapshot.pendingApprovals}
          credentials={Object.values(runtime.state.credentialRequests)}
          clarification={snapshot.pendingClarification}
          terminals={snapshot.activeTerminals}
          terminalOutputs={runtime.state.terminalOutputs}
          onReturnCurrent={() => setView({ displayMode: "current" })}
          onRetry={retry}
          onApproval={(approvalId, decision) => guard(() => runtime.decideApproval(approvalId, decision))}
          onCredential={(request, decision, value) => guard(() => runtime.resolveCredential(request, decision, value))}
          onClarification={(answer) => guard(() => runtime.respondToClarification(answer))}
          onTerminalInput={(terminalId, value) => guard(() => runtime.sendTerminalInput(terminalId, value))}
          onTerminalStop={(terminalId) => guard(() => runtime.stopTerminal(terminalId))}
        />
        <LiveNotes
          goal={currentGoal}
          capsule={currentCapsule}
          taskLabel={taskLabel}
          liveWork={presentation.liveWork}
          onOpenGoal={() => setSidebarOpen(true)}
          onOpenWork={openWork}
        />
      </section>
      <SocratesComposer
        connected={runtime.isConnected && Boolean(runtime.runtimeConfig)}
        sending={active}
        models={runtime.models}
        selectedModel={runtime.selectedModel}
        selectedThinking={runtime.selectedThinking}
        error={visibleError}
        onModelChange={runtime.selectModel}
        onThinkingChange={runtime.selectThinking}
        onUpload={runtime.uploadAttachments}
        onSend={send}
        onStop={runtime.cancelActiveTurn}
      />
    </main>
  );
}
