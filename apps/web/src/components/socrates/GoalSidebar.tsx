"use client";

import { Archive, ArrowLeft, Check, Circle, History, Pin, PinOff, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { SocratesGoal, SocratesGoalExchange, SocratesGoalExchangeWindow } from "@socrates/contracts";
import styles from "./socrates.module.css";

type GoalSidebarProps = Readonly<{
  open: boolean;
  goals: readonly SocratesGoal[];
  foregroundGoalId?: string;
  exchanges: Readonly<Record<string, readonly SocratesGoalExchange[]>>;
  windows: Readonly<Record<string, SocratesGoalExchangeWindow>>;
  loadingGoalIds: ReadonlySet<string>;
  hasEarlierGoals: boolean;
  loadingEarlierGoals: boolean;
  searching: boolean;
  onClose: () => void;
  onLoadEarlierGoals: () => void;
  onLoadExchanges: (goalId: string, earlier?: boolean) => void;
  onSearch: (query: string) => void;
  onSelectExchange: (goalId: string, exchangeId: string) => void;
  onGoalAction: (goalId: string, action: "switch" | "pin" | "unpin" | "archive") => void;
}>;

export function GoalSidebar({
  open,
  goals,
  foregroundGoalId,
  exchanges,
  windows,
  loadingGoalIds,
  hasEarlierGoals,
  loadingEarlierGoals,
  searching,
  onClose,
  onLoadEarlierGoals,
  onLoadExchanges,
  onSearch,
  onSelectExchange,
  onGoalAction,
}: GoalSidebarProps) {
  const [query, setQuery] = useState("");
  const [selectedGoalId, setSelectedGoalId] = useState<string>();

  useEffect(() => {
    const timer = window.setTimeout(() => onSearch(query), 220);
    return () => window.clearTimeout(timer);
  }, [onSearch, query]);

  const orderedGoals = useMemo(() => [...goals].sort((left, right) => {
    if (left.id === foregroundGoalId) return -1;
    if (right.id === foregroundGoalId) return 1;
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    return right.lastActiveAt.localeCompare(left.lastActiveAt);
  }), [foregroundGoalId, goals]);

  const selectedGoal = orderedGoals.find((goal) => goal.id === selectedGoalId);
  const selectedExchanges = selectedGoalId ? exchanges[selectedGoalId] ?? [] : [];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleGoals = normalizedQuery
    ? orderedGoals.filter((goal) => goal.title.toLocaleLowerCase().includes(normalizedQuery)
      || (exchanges[goal.id] ?? []).some((exchange) => exchange.userMessage.content.toLocaleLowerCase().includes(normalizedQuery)))
    : orderedGoals;
  const visibleExchanges = normalizedQuery
    ? selectedExchanges.filter((exchange) => exchange.userMessage.content.toLocaleLowerCase().includes(normalizedQuery))
    : selectedExchanges;

  const openGoal = (goalId: string) => {
    setSelectedGoalId(goalId);
    setQuery("");
    if (!exchanges[goalId]) onLoadExchanges(goalId);
  };

  const showGoals = () => {
    setSelectedGoalId(undefined);
    setQuery("");
  };

  return (
    <aside
      className={styles.goalSidebar}
      data-open={open || undefined}
      data-navigation-level={selectedGoal ? "exchanges" : "goals"}
      aria-label={selectedGoal ? `Exchanges in ${selectedGoal.title}` : "Goals"}
      aria-hidden={!open}
      inert={!open ? true : undefined}
    >
      <div className={styles.sidebarHeader}>
        <div className={styles.sidebarHeading}>
          {selectedGoal ? (
            <button type="button" onClick={showGoals} aria-label="Back to goals"><ArrowLeft aria-hidden="true" /></button>
          ) : null}
          <div>
            <span>Memory of work</span>
            <h2>{selectedGoal ? "Exchanges" : "Goals"}</h2>
            {selectedGoal ? <p title={selectedGoal.title}>{selectedGoal.title}</p> : null}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close goals sidebar"><X aria-hidden="true" /></button>
      </div>
      <label className={styles.goalSearch}>
        <Search aria-hidden="true" />
        <span className={styles.srOnly}>{selectedGoal ? "Search exact exchanges" : "Search goals and exact exchanges"}</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={selectedGoal ? "Search queries" : "Search goals"}
        />
        {searching ? <i aria-label="Searching" /> : null}
      </label>
      <div className={styles.sidebarPages}>
        {selectedGoal ? (
          <div className={styles.exchangePage}>
            {loadingGoalIds.has(selectedGoal.id) && selectedExchanges.length === 0 ? <p>Loading exact exchanges…</p> : null}
            {visibleExchanges.map((exchange) => (
              <button
                key={exchange.taskId}
                type="button"
                onClick={() => onSelectExchange(selectedGoal.id, exchange.taskId)}
                title={exchange.userMessage.content}
              >
                <History aria-hidden="true" />
                <span>
                  <strong>{exchange.userMessage.content || "Attachment request"}</strong>
                  <small>{formatExchangeMeta(exchange)}</small>
                </span>
              </button>
            ))}
            {windows[selectedGoal.id]?.hasEarlier ? (
              <button type="button" className={styles.loadMore} disabled={loadingGoalIds.has(selectedGoal.id)} onClick={() => onLoadExchanges(selectedGoal.id, true)}>
                Earlier exchanges
              </button>
            ) : null}
            {!loadingGoalIds.has(selectedGoal.id) && visibleExchanges.length === 0 ? (
              <p>{query ? "No matching queries." : "This goal has no exchanges yet."}</p>
            ) : null}
          </div>
        ) : (
          <div className={styles.goalList}>
            {visibleGoals.length ? visibleGoals.map((goal) => {
              const isCurrent = goal.id === foregroundGoalId;
              const exchangeCount = exchanges[goal.id]?.length;
              return (
                <section key={goal.id} className={styles.goalListItem} data-current={isCurrent || undefined}>
                  <button type="button" className={styles.goalSelect} onClick={() => openGoal(goal.id)}>
                    {goal.status === "completed" ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
                    <span>
                      <strong>{goal.title}</strong>
                      <small>{isCurrent ? "Current goal" : goal.status.replaceAll("_", " ")}</small>
                    </span>
                    {exchangeCount !== undefined ? <b aria-label={`${exchangeCount} loaded exchanges`}>{exchangeCount}</b> : null}
                  </button>
                  <div className={styles.goalActions}>
                    {!isCurrent && !["completed", "archived", "discarded"].includes(goal.status) ? (
                      <button type="button" onClick={() => onGoalAction(goal.id, "switch")} title="Continue this goal">Continue</button>
                    ) : null}
                    <button type="button" onClick={() => onGoalAction(goal.id, goal.pinned ? "unpin" : "pin")} aria-label={`${goal.pinned ? "Unpin" : "Pin"} ${goal.title}`}>
                      {goal.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
                    </button>
                    {!isCurrent ? (
                      <button type="button" onClick={() => onGoalAction(goal.id, "archive")} aria-label={`Archive ${goal.title}`}>
                        <Archive aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                </section>
              );
            }) : <p className={styles.sidebarEmpty}>{query ? "No matching goals or queries." : "Your first request will create the first goal."}</p>}
            {hasEarlierGoals ? (
              <button type="button" className={styles.earlierGoals} disabled={loadingEarlierGoals} onClick={onLoadEarlierGoals}>
                {loadingEarlierGoals ? "Loading…" : "Load earlier goals"}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
}

const formatExchangeMeta = (exchange: SocratesGoalExchange): string => {
  const date = new Date(exchange.updatedAt);
  const timestamp = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${exchange.status.replaceAll("_", " ")}${timestamp ? ` · ${timestamp}` : ""}`;
};
