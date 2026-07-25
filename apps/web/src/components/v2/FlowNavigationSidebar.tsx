"use client"

import type { Project } from "@socrates/contracts"
import { ArrowLeft, Check, Circle, PanelLeftClose, PanelLeftOpen, RotateCcw } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import type { FlowQueryNavigationItem } from "@/lib/v2/flowNavigation"
import type { FlowGoalView } from "./types"

type NavigationLevel = "projects" | "goals" | "queries"

interface FlowNavigationSidebarProps {
  projects: Project[]
  currentProjectId: string
  goals: FlowGoalView[]
  selectedGoalId?: string
  queries: FlowQueryNavigationItem[]
  selectedQueryId?: string
  isCollapsed: boolean
  hasEarlier?: boolean
  isLoadingEarlier?: boolean
  earlierError?: string
  queryCounts: ReadonlyMap<string, number>
  onCollapse: () => void
  onExpand: () => void
  onSelectGoal: (goalId: string) => void
  onSelectQuery: (queryId: string) => void
  onReturnToCurrent: () => void
  onLoadEarlier?: () => void
}

export function FlowNavigationSidebar({
  projects,
  currentProjectId,
  goals,
  selectedGoalId,
  queries,
  selectedQueryId,
  isCollapsed,
  hasEarlier,
  isLoadingEarlier,
  earlierError,
  queryCounts,
  onCollapse,
  onExpand,
  onSelectGoal,
  onSelectQuery,
  onReturnToCurrent,
  onLoadEarlier,
}: FlowNavigationSidebarProps) {
  const [navigation, setNavigation] = useState<{ projectId: string; level: NavigationLevel }>(() => ({
    projectId: currentProjectId,
    level: "queries",
  }))
  const level = navigation.projectId === currentProjectId ? navigation.level : "queries"
  const selectedGoal = goals.find((goal) => goal.id === selectedGoalId)
  const currentQuery = queries.find((query) => query.isCurrent)
  const selectedQueryIsCurrent = selectedQueryId === currentQuery?.id

  if (isCollapsed) {
    return (
      <button
        type="button"
        aria-label="Open Flow navigation"
        className="fixed left-4 top-3 z-40 flex size-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-brand-text-light shadow-sm transition hover:border-gray-300 hover:text-brand-text-dark"
        onClick={onExpand}
      >
        <PanelLeftOpen size={18} aria-hidden="true" />
      </button>
    )
  }

  const moveBack = () => setNavigation({
    projectId: currentProjectId,
    level: level === "queries" ? "goals" : "projects",
  })

  return (
    <>
      <button
        type="button"
        aria-label="Close Flow navigation"
        className="fixed inset-0 z-40 bg-slate-900/10 backdrop-blur-[1px] md:hidden"
        onClick={onCollapse}
      />
      <aside
        className="fixed inset-y-0 left-0 z-50 flex h-dvh max-h-dvh w-[min(20rem,calc(100vw-2rem))] flex-col overflow-hidden border-r border-gray-200 bg-brand-bg px-4 py-5 shadow-[1.5rem_0_4rem_rgba(45,55,72,0.12)] md:w-80 md:min-w-80 md:max-w-80"
        data-flow-navigation-level={level}
        aria-label="Flow navigation"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {level !== "projects" ? (
              <button
                type="button"
                aria-label={level === "queries" ? "Show goals" : "Show projects"}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-brand-text-light transition hover:bg-white hover:text-brand-text-dark"
                onClick={moveBack}
              >
                <ArrowLeft size={17} aria-hidden="true" />
              </button>
            ) : null}
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold uppercase tracking-wide text-brand-text-light">
                {level === "queries" ? "Queries" : level === "goals" ? "Goals" : "Projects"}
              </h2>
              {level === "queries" && selectedGoal ? (
                <p className="mt-0.5 truncate text-[11px] text-brand-text-light">{selectedGoal.title}</p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Flow navigation"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-brand-text-light transition hover:bg-white hover:text-brand-text-dark"
            onClick={onCollapse}
          >
            <PanelLeftClose size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3" data-flow-navigation-scroll>
          {level === "projects" ? (
            <div className="space-y-1">
              {projects.map((project) => (
                project.id === currentProjectId ? (
                  <button
                    key={project.id}
                    type="button"
                    aria-current="page"
                    className="block w-full truncate rounded-xl bg-white/80 px-3 py-2.5 text-left text-sm font-medium text-brand-text-dark transition hover:text-brand-teal-dark"
                    onClick={() => setNavigation({ projectId: currentProjectId, level: "goals" })}
                  >
                    {project.name}
                  </button>
                ) : (
                  <Link
                    key={project.id}
                    href={`/seamless/projects/${encodeURIComponent(project.id)}`}
                    className="block truncate rounded-xl px-3 py-2.5 text-sm font-medium text-brand-text-dark transition hover:bg-white/65 hover:text-brand-teal-dark"
                  >
                    {project.name}
                  </Link>
                )
              ))}
            </div>
          ) : level === "goals" ? (
            <div className="space-y-1">
              {goals.map((goal) => {
                const selected = goal.id === selectedGoalId
                const count = queryCounts.get(goal.id) ?? 0
                return (
                  <button
                    key={goal.id}
                    type="button"
                    className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-xl px-3 py-2.5 text-left transition ${
                      selected ? "bg-white/80 text-brand-text-dark" : "text-brand-text-light hover:bg-white/60 hover:text-brand-text-dark"
                    }`}
                    aria-current={selected ? "page" : undefined}
                    onClick={() => {
                      onSelectGoal(goal.id)
                      setNavigation({ projectId: currentProjectId, level: "queries" })
                    }}
                  >
                    {goal.status === "completed" ? (
                      <Check className="mt-0.5 size-3.5 text-brand-teal-dark" aria-hidden="true" />
                    ) : (
                      <Circle className={`mt-0.5 size-3.5 ${selected ? "fill-teal-50 text-brand-teal-dark" : "text-gray-300"}`} aria-hidden="true" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{goal.title}</span>
                      <span className="mt-0.5 block text-[10px] capitalize text-brand-text-light">{goal.status.replaceAll("_", " ")}</span>
                    </span>
                    <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] tabular-nums text-brand-text-light">{count}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="relative space-y-1 before:absolute before:bottom-2 before:left-[0.3125rem] before:top-2 before:w-px before:bg-gray-200">
              {queries.length > 0 ? [...queries].reverse().map((query) => {
                const selected = query.id === selectedQueryId
                return (
                  <button
                    key={query.id}
                    type="button"
                    onClick={() => onSelectQuery(query.id)}
                    aria-current={selected ? "step" : undefined}
                    className={`relative block w-full rounded-lg py-2 pl-5 pr-2 text-left text-xs leading-5 transition ${
                      selected ? "bg-white/80 font-medium text-brand-text-dark" : "text-brand-text-light hover:bg-white/55 hover:text-brand-text-dark"
                    }`}
                  >
                    <span aria-hidden="true" className={`absolute left-0 top-3.5 size-2.5 rounded-full border-2 ${selected ? "border-brand-teal-dark bg-brand-bg" : "border-gray-300 bg-brand-bg"}`} />
                    <span className="line-clamp-2">{query.label}</span>
                    {query.isCurrent ? <span className="mt-0.5 block text-[10px] font-normal text-brand-teal-dark">Current</span> : null}
                  </button>
                )
              }) : (
                <p className="pl-5 text-xs leading-5 text-brand-text-light">This goal has no queries yet.</p>
              )}
            </div>
          )}
        </div>

        {level === "queries" && ((!selectedQueryIsCurrent && currentQuery) || (hasEarlier && onLoadEarlier) || earlierError) ? (
          <div className="shrink-0 border-t border-gray-200/80 px-2 pt-3">
            {!selectedQueryIsCurrent && currentQuery ? (
              <button type="button" onClick={onReturnToCurrent} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs text-brand-text-light transition hover:bg-white/80 hover:text-brand-text-dark">
                <RotateCcw size={13} aria-hidden="true" />
                Return to current
              </button>
            ) : null}
            {hasEarlier && onLoadEarlier ? (
              <button type="button" onClick={onLoadEarlier} disabled={isLoadingEarlier} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-brand-text-light transition hover:bg-white/70 hover:text-brand-text-dark disabled:cursor-wait disabled:opacity-60">
                {isLoadingEarlier ? "Loading…" : "Load earlier queries"}
              </button>
            ) : null}
            {earlierError ? <p className="mt-2 text-xs text-red-600" role="alert">{earlierError}</p> : null}
          </div>
        ) : null}
      </aside>
    </>
  )
}
