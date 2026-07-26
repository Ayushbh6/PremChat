"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowUpRight,
  Eye,
  EyeOff,
  LayoutDashboard,
  PanelRightClose,
  PanelRightOpen,
  Square,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ConversationTerminal, ConversationToolRun, Message, Project, V2LiveActivity, V2MessageAttachment } from "@socrates/contracts";
import { ChatComposer, type ChatComposerProps } from "@/components/chat/ChatComposer";
import { ChatTranscript, type LiveActivityStep } from "@/components/chat/ChatTranscript";
import { TerminalDockPanel } from "@/components/chat/TerminalPanel";
import type { PendingApproval, PendingCredentialInput } from "@/components/chat/ToolTimelineTypes";
import { toolRunToTimelineItem } from "@/components/chat/ToolTimelineTypes";
import { WorkspaceTopbar } from "@/components/chat/WorkspaceTopbar";
import { flowQueriesForGoal, flowQueryCountsByGoal } from "@/lib/v2/flowNavigation";
import { LivingSphere } from "./LivingSphere";
import { V2ViewLink } from "./V2ViewLink";
import { V2SpeechPackManager } from "./V2SpeechPackManager";
import { FlowWorkspaceNotes } from "./FlowWorkspaceNotes";
import { FlowWorkspaceInspector, type FlowInspectorView } from "./FlowWorkspaceInspector";
import { DeleteFlowItemDialog } from "./DeleteFlowItemDialog";
import { FlowLiveStage } from "./FlowLiveStage";
import { FlowNavigationSidebar } from "./FlowNavigationSidebar";
import styles from "./seamless.module.css";
import type {
  FlowContextSummary,
  FlowGoalView,
  FlowPresenceState,
  FlowVoiceOption,
} from "./types";

export interface FlowWorkspaceProps {
  projectId: string;
  projectName: string;
  projects: Project[];
  messages?: Message[];
  activeTurnId?: string;
  liveActivity?: V2LiveActivity;
  goals?: FlowGoalView[];
  selectedGoalId?: string;
  goalIdByMessageId?: Readonly<Record<string, string | undefined>>;
  currentTaskLabel?: string;
  presenceState?: FlowPresenceState;
  statusLabel?: string;
  errorMessage?: string;
  contextSummary?: FlowContextSummary;
  approvals?: PendingApproval[];
  toolRuns?: ConversationToolRun[];
  terminalActivity?: ConversationTerminal[];
  credentialRequests?: PendingCredentialInput[];
  voiceOptions?: FlowVoiceOption[];
  selectedVoiceOptionId?: string;
  voiceStatusLabel?: string;
  hasEarlierMessages?: boolean;
  isLoadingEarlierMessages?: boolean;
  earlierMessagesError?: string;
  hasEarlierGoals?: boolean;
  isLoadingEarlierGoals?: boolean;
  earlierGoalsError?: string;
  composer: ChatComposerProps<V2MessageAttachment>;
  onReadAloud?: (itemId: string) => void;
  activeReadAloudMessageId?: string | undefined;
  readAloudStatus?: "synthesizing" | "speaking" | undefined;
  onApprovalDecision?: (approvalId: string, decision: "approved" | "rejected") => void;
  onCredentialResolve?: (request: PendingCredentialInput, decision: "submitted" | "cancelled", value?: string) => void;
  onVoiceOptionChange?: (optionId: string) => void;
  onTerminalInput?: (terminalId: string, input: { data?: string; text?: string; key?: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Enter" | "Escape" | "Ctrl-C"; submit?: boolean }) => void;
  onTerminalResize?: (terminalId: string, size: { cols: number; rows: number }) => void;
  onTerminalStop?: (terminalId: string) => void;
  onTerminalRename?: (terminalId: string, name: string) => void;
  onLoadEarlierMessages?: () => void;
  onLoadEarlierGoals?: () => void;
  onSelectGoal?: (goalId: string) => void;
  onFocusAction?: (goalId: string, action: "switch" | "pause" | "finish" | "reopen" | "archive" | "pin" | "unpin") => void;
  onDeleteGoal?: (goalId: string) => Promise<void>;
  onDeleteExchange?: (turnId: string) => Promise<void>;
  onOpenInClassic?: (goalId: string) => void;
}

export function FlowWorkspace({
  projectId,
  projectName,
  projects,
  messages = [],
  activeTurnId,
  liveActivity,
  goals = [],
  selectedGoalId,
  goalIdByMessageId = {},
  currentTaskLabel = "Ready for your next thought",
  presenceState = "offline",
  statusLabel = "Seamless runtime disconnected",
  errorMessage,
  contextSummary,
  approvals = [],
  toolRuns = [],
  terminalActivity = [],
  credentialRequests = [],
  voiceOptions = [],
  selectedVoiceOptionId,
  voiceStatusLabel,
  hasEarlierMessages = false,
  isLoadingEarlierMessages = false,
  earlierMessagesError,
  hasEarlierGoals = false,
  isLoadingEarlierGoals = false,
  earlierGoalsError,
  composer,
  onReadAloud,
  activeReadAloudMessageId,
  readAloudStatus,
  onApprovalDecision,
  onCredentialResolve,
  onVoiceOptionChange,
  onTerminalInput,
  onTerminalResize,
  onTerminalStop,
  onTerminalRename,
  onLoadEarlierMessages,
  onLoadEarlierGoals,
  onSelectGoal,
  onFocusAction,
  onDeleteGoal,
  onDeleteExchange,
  onOpenInClassic,
}: FlowWorkspaceProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isInspectorPinned, setIsInspectorPinned] = useState(false);
  const [inspectorView, setInspectorView] = useState<FlowInspectorView>("context");
  const [isSpeechPacksOpen, setIsSpeechPacksOpen] = useState(false);
  const [selectedExchangeKey, setSelectedExchangeKey] = useState<string | null>(null);
  const [isTerminalDockOpen, setIsTerminalDockOpen] = useState(false);
  const [activeTerminalId, setActiveTerminalId] = useState<string | undefined>();
  const [terminalDockHeight, setTerminalDockHeight] = useState(320);
  const [isMobileView, setIsMobileView] = useState(false);
  const [goalToDelete, setGoalToDelete] = useState<string | null>(null);
  const [turnToDelete, setTurnToDelete] = useState<string | null>(null);
  const speechPackDialogRef = useRef<HTMLDivElement>(null);
  const speechPackCloseRef = useRef<HTMLButtonElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const displayedExchangeKeyRef = useRef<string | undefined>(undefined);
  const shouldFollowCurrentRef = useRef(true);
  const reduceMotion = useReducedMotion();
  const queries = useMemo(() => flowQueriesForGoal({
    messages,
    goalIdByMessageId,
    goalId: selectedGoalId,
    activeTurnId,
  }), [activeTurnId, goalIdByMessageId, messages, selectedGoalId]);
  const queryCounts = useMemo(
    () => flowQueryCountsByGoal(messages, goalIdByMessageId),
    [goalIdByMessageId, messages],
  );
  const currentQuery = useMemo(
    () => queries.find((query) => query.isCurrent) ?? queries.at(-1),
    [queries],
  );
  const displayedQuery = useMemo(
    () => queries.find((query) => query.id === selectedExchangeKey) ?? currentQuery,
    [currentQuery, queries, selectedExchangeKey],
  );
  const displayedExchange = displayedQuery?.exchange;
  const displayedMessages = useMemo(() => displayedExchange?.messages ?? [], [displayedExchange]);
  const displayedIsCurrent = Boolean(displayedQuery?.isCurrent);
  const activeGoal = useMemo(
    () => goals.find((goal) => goal.id === selectedGoalId),
    [goals, selectedGoalId],
  );
  const pausedGoalCount = useMemo(
    () => goals.filter((goal) => goal.status === "parked" || goal.status === "blocked").length,
    [goals],
  );
  const settledLiveTurns = useMemo<Record<string, LiveActivityStep[]>>(() => {
    const settled: Record<string, LiveActivityStep[]> = {};
    for (const message of messages) {
      if (message.role !== "assistant" || message.status !== "completed" || !message.turnId) continue;
      const runs = toolRuns.filter((tool) => tool.turnId === message.turnId);
      if (runs.length === 0 && !message.reasoning?.trim()) continue;
      settled[message.turnId] = [{
        key: `flow-settled-${message.turnId}`,
        turnId: message.turnId,
        kind: "agent",
        stepIndex: 0,
        reasoning: message.reasoning ?? "",
        answer: "",
        tools: runs.map(toolRunToTimelineItem),
      }];
    }
    return settled;
  }, [messages, toolRuns]);
  const isLiveDisplayed = Boolean(
    activeTurnId
    && displayedExchange?.turnId === activeTurnId
    && displayedExchange.assistantMessage?.status !== "completed",
  );
  const contentVersion = useMemo(() => {
    const last = displayedMessages.at(-1);
    const toolVersion = toolRuns.map((tool) => `${tool.toolCallId}:${tool.status}:${tool.resultPreview?.length ?? 0}`).join("|");
    return `${last?.id ?? "none"}:${last?.content.length ?? 0}:${last?.reasoning?.length ?? 0}:${toolVersion}`;
  }, [displayedMessages, toolRuns]);

  const openInspector = (view: FlowInspectorView) => {
    setInspectorView(view);
    setIsInspectorOpen(true);
  };

  useEffect(() => {
    if (!isSpeechPacksOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    speechPackCloseRef.current?.focus();
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsSpeechPacksOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = speechPackDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), select:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", handleDialogKeys);
    return () => {
      window.removeEventListener("keydown", handleDialogKeys);
      document.body.style.overflow = previousBodyOverflow;
      previouslyFocused?.focus();
    };
  }, [isSpeechPacksOpen]);

  useEffect(() => {
    if (!isInspectorOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSpeechPacksOpen) setIsInspectorOpen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isInspectorOpen, isSpeechPacksOpen]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobileView(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!terminalActivity.some((terminal) => terminal.awaitingInput || terminal.status === "awaiting_input")) return;
    const timeout = window.setTimeout(() => setIsTerminalDockOpen(true), 0);
    return () => window.clearTimeout(timeout);
  }, [terminalActivity]);

  useEffect(() => {
    const container = transcriptRef.current;
    if (!container || !displayedExchange) return;
    if (displayedExchangeKeyRef.current === displayedExchange.key) return;
    displayedExchangeKeyRef.current = displayedExchange.key;
    shouldFollowCurrentRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      container.scrollTo({ top: 0, behavior: "instant" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [displayedExchange]);

  useEffect(() => {
    const container = transcriptRef.current;
    if (!container || !displayedIsCurrent || !composer.isSending || !shouldFollowCurrentRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      container.scrollTo({ top: container.scrollHeight, behavior: reduceMotion ? "instant" : "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [composer.isSending, contentVersion, displayedIsCurrent, reduceMotion]);

  const sendFromComposer = async (...args: Parameters<typeof composer.onSend>) => {
    // An older exchange is only a viewing state. New input always continues
    // after the live Flow tail and never creates an implicit history branch.
    if (selectedExchangeKey) {
      setSelectedExchangeKey(null);
      shouldFollowCurrentRef.current = true;
    }
    await composer.onSend(...args);
  };

  return (
    <main className={styles.flowPage}>
      <div className={styles.oceanNoise} aria-hidden="true" />

      <FlowNavigationSidebar
        projects={projects}
        currentProjectId={projectId}
        goals={goals}
        selectedGoalId={selectedGoalId}
        queries={queries}
        selectedQueryId={displayedQuery?.id}
        isCollapsed={isSidebarCollapsed}
        onCollapse={() => setIsSidebarCollapsed(true)}
        onExpand={() => setIsSidebarCollapsed(false)}
        hasEarlier={hasEarlierMessages}
        isLoadingEarlier={isLoadingEarlierMessages}
        earlierError={earlierMessagesError}
        hasEarlierGoals={hasEarlierGoals}
        isLoadingEarlierGoals={isLoadingEarlierGoals}
        earlierGoalsError={earlierGoalsError}
        queryCounts={queryCounts}
        onSelectGoal={(goalId) => {
          setSelectedExchangeKey(null);
          onSelectGoal?.(goalId);
        }}
        onSelectQuery={(queryId) => {
          setSelectedExchangeKey(queryId === currentQuery?.id ? null : queryId);
          setIsSidebarCollapsed(true);
        }}
        onReturnToCurrent={() => {
          setSelectedExchangeKey(null);
          setIsSidebarCollapsed(true);
        }}
        onLoadEarlier={onLoadEarlierMessages}
        onLoadEarlierGoals={onLoadEarlierGoals}
      />

      <section className={styles.flowShell} data-inspector={isInspectorOpen ? "open" : "closed"}>
        <WorkspaceTopbar isSidebarCollapsed={isSidebarCollapsed}>
          <V2ViewLink
            view="classic"
            href={`/projects/${encodeURIComponent(projectId)}`}
            className="mr-4 inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-brand-text-light shadow-sm hover:bg-gray-50 hover:text-brand-text-dark"
            title="Project dashboard"
            aria-label="Project dashboard"
          >
            <LayoutDashboard className="size-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </V2ViewLink>
          <h1 className="min-w-0 truncate text-sm font-medium text-brand-text-dark">{projectName}</h1>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-brand-text-light shadow-sm hover:bg-gray-50 hover:text-brand-text-dark"
              onClick={() => isInspectorOpen ? setIsInspectorOpen(false) : openInspector("context")}
              aria-controls="v2-goal-inspector"
              aria-expanded={isInspectorOpen}
              aria-label={isInspectorOpen ? "Hide working notes" : "Working notes"}
            >
              {isInspectorOpen ? <PanelRightClose aria-hidden="true" /> : <PanelRightOpen aria-hidden="true" />}
              <span className="hidden sm:inline">{isInspectorOpen ? "Hide notes" : "Working notes"}</span>
            </button>
            {terminalActivity.length > 0 && (
              <button
                type="button"
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-brand-text-light shadow-sm hover:bg-gray-50 hover:text-brand-text-dark"
                onClick={() => setIsTerminalDockOpen((current) => !current)}
                aria-pressed={isTerminalDockOpen}
              >
                {isTerminalDockOpen ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                <span className="hidden sm:inline">Terminal</span>
                <span className="rounded-full bg-teal-50 px-1.5 py-0.5 font-mono text-[10px] text-brand-teal-dark">
                  {terminalActivity.length}
                </span>
              </button>
            )}
            <button
              type="button"
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-brand-text-light shadow-sm hover:bg-gray-50 hover:text-brand-text-dark disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!activeGoal || !onOpenInClassic}
              aria-label="Open in Classic View"
              onClick={() => {
                if (activeGoal) onOpenInClassic?.(activeGoal.id);
              }}
            >
              <span className="hidden sm:inline">Classic View</span>
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </button>
          </div>
        </WorkspaceTopbar>

        <div className={styles.flowBody}>
          <section
            className={styles.flowCanvas}
            aria-label="Seamless conversation"
            onPointerDown={() => {
              if (isInspectorOpen && !isInspectorPinned) setIsInspectorOpen(false);
            }}
          >
            <div
              className={styles.flowConversation}
              data-presence={presenceState}
              data-has-exchange={displayedMessages.length > 0 || undefined}
            >
              <AnimatePresence initial={false}>
                {!isLiveDisplayed ? (
                  <motion.div
                    key="resting-orb"
                    className={styles.orbBackdrop}
                    initial={reduceMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <LivingSphere
                      state={presenceState}
                      size="full"
                      statusLabel={statusLabel}
                      showStatus={false}
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>
              <FlowWorkspaceNotes
                projectId={projectId}
                activeGoal={activeGoal}
                currentTaskLabel={displayedExchange?.label ?? currentTaskLabel}
                contextSummary={contextSummary}
                pausedGoalCount={pausedGoalCount}
                compact={messages.length > 0}
                onOpenContext={() => openInspector("context")}
                onOpenFocuses={() => openInspector("focuses")}
              />

              {displayedMessages.length > 0 && (
                <div className={styles.timelineFrame}>
                  <ChatTranscript
                    messages={displayedMessages}
                    toolRuns={toolRuns}
                    liveSteps={isLiveDisplayed && activeTurnId ? [{
                      key: `flow-active-${activeTurnId}`,
                      turnId: activeTurnId,
                      kind: "agent",
                      stepIndex: 0,
                      reasoning: "",
                      answer: "",
                      tools: [],
                    }] : []}
                    settledLiveTurns={settledLiveTurns}
                    approvals={approvals}
                    credentialRequests={credentialRequests}
                    isStreaming={false}
                    scrollContainerRef={transcriptRef}
                    scrollContainerClassName={styles.timelineScroller}
                    contentClassName={styles.sharedTranscriptContent}
                    collapseLongUserMessages
                    beforeMessages={!displayedIsCurrent ? (
                      <div className={styles.historyNotice}>
                        <span>Earlier query</span>
                        <button type="button" onClick={() => setSelectedExchangeKey(null)}>Return to current</button>
                      </div>
                    ) : undefined}
                    renderAfterMessage={(message) => (
                      <>
                        <AnimatePresence initial={false}>
                          {message.role === "user" && isLiveDisplayed && activeTurnId && message.turnId === activeTurnId ? (
                            <FlowLiveStage
                              key={`live-${activeTurnId}`}
                              activity={liveActivity}
                              presenceState={presenceState}
                              turnId={activeTurnId}
                              toolRuns={toolRuns.filter((tool) => tool.turnId === activeTurnId)}
                              approvals={approvals.filter((approval) => !approval.toolCallId || toolRuns.some(
                                (tool) => tool.turnId === activeTurnId && tool.toolCallId === approval.toolCallId,
                              ))}
                              credentialRequests={credentialRequests.filter((request) => request.turnId === activeTurnId)}
                              onApprovalDecision={onApprovalDecision}
                              onCredentialInput={onCredentialResolve}
                            />
                          ) : null}
                        </AnimatePresence>
                        {message.role === "assistant" && message.status === "completed" && message.content.trim() ? (
                          <div className={styles.messageActions}>
                            {onReadAloud && (
                              <button
                                type="button"
                                className={styles.readAloudControl}
                                onClick={() => onReadAloud(message.id)}
                                disabled={Boolean(activeReadAloudMessageId && activeReadAloudMessageId !== message.id)}
                                data-active={activeReadAloudMessageId === message.id || undefined}
                                aria-label={activeReadAloudMessageId === message.id ? "Stop reading response" : "Read response aloud"}
                                title={activeReadAloudMessageId === message.id
                                  ? readAloudStatus === "synthesizing" ? "Preparing speech — click to stop" : "Stop reading"
                                  : "Read aloud"}
                              >
                                {activeReadAloudMessageId === message.id ? <Square aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
                              </button>
                            )}
                            {onDeleteExchange && message.turnId && (
                              <button
                                type="button"
                                className={styles.readAloudControl}
                                onClick={() => setTurnToDelete(message.turnId ?? null)}
                                aria-label="Delete exchange"
                                title="Delete exchange"
                              >
                                <Trash2 aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        ) : null}
                      </>
                    )}
                    onApprovalDecision={onApprovalDecision}
                    onCredentialInput={onCredentialResolve}
                    onScroll={(event) => {
                      const container = event.currentTarget;
                      shouldFollowCurrentRef.current = container.scrollHeight - container.scrollTop - container.clientHeight <= 96;
                    }}
                  />
                </div>
              )}
            </div>

            <div className={styles.composerDock}>
              {errorMessage ? (
                <p role="alert" className="mx-auto mb-2 w-full max-w-3xl rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
                  {errorMessage}
                </p>
              ) : null}
              <div className={styles.sharedComposerFrame}>
                <ChatComposer {...composer} onSend={sendFromComposer} />
              </div>
            </div>
            <TerminalDockPanel
              terminals={terminalActivity}
              isOpen={isTerminalDockOpen}
              isMobile={isMobileView}
              activeTerminalId={activeTerminalId}
              onActiveTerminalIdChange={setActiveTerminalId}
              onClose={() => setIsTerminalDockOpen(false)}
              onStop={(terminalId) => onTerminalStop?.(terminalId)}
              onRename={(terminalId, name) => onTerminalRename?.(terminalId, name)}
              onInput={(terminalId, input) => onTerminalInput?.(terminalId, input)}
              onResize={(terminalId, size) => onTerminalResize?.(terminalId, size)}
              dockHeight={terminalDockHeight}
              onResizeDock={setTerminalDockHeight}
            />
          </section>

          <AnimatePresence initial={false}>
            {isInspectorOpen && (
              <motion.div
                className={styles.inspectorMotionShell}
                initial={reduceMotion ? false : { opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 20 }}
                transition={{ duration: 0.24, ease: "easeOut" }}
              >
                <FlowWorkspaceInspector
                  view={inspectorView}
                  isPinned={isInspectorPinned}
                  activeGoal={activeGoal}
                  currentTaskLabel={currentTaskLabel}
                  goals={goals}
                  contextSummary={contextSummary}
                  voiceOptions={voiceOptions}
                  selectedVoiceOptionId={selectedVoiceOptionId}
                  voiceStatusLabel={voiceStatusLabel}
                  onViewChange={setInspectorView}
                  onPinnedChange={setIsInspectorPinned}
                  onClose={() => setIsInspectorOpen(false)}
                  onVoiceOptionChange={onVoiceOptionChange}
                  onOpenVoiceSettings={() => setIsSpeechPacksOpen(true)}
                  onFocusAction={onFocusAction}
                  onDeleteGoal={onDeleteGoal ? setGoalToDelete : undefined}
                  onOpenInClassic={onOpenInClassic}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      <AnimatePresence>
        {isSpeechPacksOpen && (
          <motion.div
            className={styles.speechPackOverlay}
            role="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              type="button"
              className={styles.speechPackScrim}
              aria-label="Close offline voice packs"
              onClick={() => setIsSpeechPacksOpen(false)}
            />
            <motion.div
              ref={speechPackDialogRef}
              className={styles.speechPackDialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="v2-voice-packs-title"
              initial={reduceMotion ? false : { opacity: 0, y: 18, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.99 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <div className={styles.speechPackDialogBar}>
                <span>Voice settings</span>
                <button
                  ref={speechPackCloseRef}
                  type="button"
                  onClick={() => setIsSpeechPacksOpen(false)}
                  aria-label="Close offline voice packs"
                >
                  <X aria-hidden="true" />
                </button>
              </div>
              <V2SpeechPackManager headingId="v2-voice-packs-title" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {goalToDelete && onDeleteGoal && (
        <DeleteFlowItemDialog
          kind="focus"
          onCancel={() => setGoalToDelete(null)}
          onDelete={async () => {
            await onDeleteGoal(goalToDelete);
            setGoalToDelete(null);
          }}
        />
      )}
      {turnToDelete && onDeleteExchange && (
        <DeleteFlowItemDialog
          kind="exchange"
          onCancel={() => setTurnToDelete(null)}
          onDelete={async () => {
            await onDeleteExchange(turnToDelete);
            setTurnToDelete(null);
          }}
        />
      )}
    </main>
  );
}
