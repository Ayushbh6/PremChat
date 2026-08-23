"use client";

import type {
  ModelOption,
  ModelThinkingOption,
  SocratesClientCommand,
  SocratesCredentialInputRequest,
  SocratesGoal,
  SocratesGoalExchange,
  SocratesGoalExchangeWindow,
  SocratesGlobalGoalWindow,
  SocratesRuntimeConfig,
  SocratesSearchGlobalHistoryResponse,
  SocratesServerEvent,
} from "@socrates/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { socratesApi } from "./api";
import { createSocratesRuntimeState, reduceSocratesEvent, type SocratesRuntimeState } from "./reducer";
import { createSocratesClientId, makeSocratesCommand, useSocratesSocket } from "./socket";

const MODEL_STORAGE_KEY = "socrates.composer.model";
const THINKING_STORAGE_PREFIX = "socrates.composer.thinking";

const modelKey = (model: Pick<ModelOption, "providerId" | "authMode" | "modelId">): string =>
  `${model.providerId}:${model.authMode ?? "api_key"}:${model.modelId}`;

const initialModel = (models: readonly ModelOption[], defaultModel: { providerId: string; authMode?: string; modelId: string } | null): ModelOption | undefined => {
  const stored = window.localStorage.getItem(MODEL_STORAGE_KEY);
  if (stored) {
    const match = models.find((model) => modelKey(model) === stored);
    if (match) return match;
  }
  if (defaultModel) {
    const match = models.find((model) =>
      model.providerId === defaultModel.providerId
      && model.modelId === defaultModel.modelId
      && (model.authMode ?? "api_key") === (defaultModel.authMode ?? "api_key"));
    if (match) return match;
  }
  return models.find((model) => model.isDefault) ?? models[0];
};

const thinkingFor = (model: ModelOption): ModelThinkingOption => {
  const stored = window.localStorage.getItem(`${THINKING_STORAGE_PREFIX}:${modelKey(model)}`);
  return model.thinkingOptions.find((option) => option.id === stored)
    ?? model.thinkingOptions.find((option) => option.id === model.defaultThinkingOptionId)
    ?? model.thinkingOptions[0]!;
};

export function useSocratesRuntime() {
  const [state, setState] = useState<SocratesRuntimeState | null>(null);
  const [isHydrating, setIsHydrating] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [socketError, setSocketError] = useState<string | null>(null);
  const [goals, setGoals] = useState<SocratesGoal[]>([]);
  const [goalWindow, setGoalWindow] = useState<SocratesGlobalGoalWindow | null>(null);
  const [isLoadingEarlierGoals, setIsLoadingEarlierGoals] = useState(false);
  const [goalExchanges, setGoalExchanges] = useState<Record<string, SocratesGoalExchange[]>>({});
  const [exchangeWindows, setExchangeWindows] = useState<Record<string, SocratesGoalExchangeWindow>>({});
  const [loadingGoalIds, setLoadingGoalIds] = useState<ReadonlySet<string>>(new Set());
  const [historySearch, setHistorySearch] = useState<SocratesSearchGlobalHistoryResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelOption | null>(null);
  const [selectedThinking, setSelectedThinking] = useState<ModelThinkingOption | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);

  const loadModels = useCallback(async () => {
    setModelError(null);
    try {
      const response = await api.listModels();
      setModels(response.models);
      const model = initialModel(response.models, response.defaultModel);
      setSelectedModel(model ?? null);
      setSelectedThinking(model ? thinkingFor(model) : null);
    } catch (reason) {
      setModelError(reason instanceof Error ? reason.message : "Models could not be loaded.");
    }
  }, []);

  const hydrate = useCallback(async () => {
    setIsHydrating(true);
    setLoadError(null);
    try {
      const snapshot = await socratesApi.bootstrap();
      setState(createSocratesRuntimeState(snapshot));
      setGoals(snapshot.goals);
      setGoalWindow(snapshot.globalGoalWindow ?? null);
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "Socrates could not be opened.");
    } finally {
      setIsHydrating(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const snapshot = await socratesApi.getState();
      setState((current) => current
        ? { ...current, snapshot, credentialRequests: Object.fromEntries(snapshot.pendingCredentialRequests.map((request) => [request.id, request])) }
        : createSocratesRuntimeState(snapshot));
      setGoals((current) => mergeById(current, snapshot.goals));
      setGoalWindow(snapshot.globalGoalWindow ?? null);
      const foregroundGoalId = snapshot.state.foregroundGoalId;
      if (foregroundGoalId) {
        const page = await socratesApi.listGoalExchanges(foregroundGoalId);
        setGoalExchanges((current) => ({
          ...current,
          [foregroundGoalId]: mergeExchanges(page.exchanges, [], "replace"),
        }));
        setExchangeWindows((current) => ({ ...current, [foregroundGoalId]: page.exchangeWindow }));
      }
    } catch (reason) {
      setSocketError(reason instanceof Error ? reason.message : "Socrates state could not be refreshed.");
    }
  }, []);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([hydrate(), loadModels()]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hydrate, loadModels]);

  const handleEvent = useCallback((event: SocratesServerEvent) => {
    setState((current) => current ? reduceSocratesEvent(current, event) : current);
    if (
      event.type === "socrates.message.completed"
      || event.type === "socrates.goal.routed"
      || event.type === "socrates.goal.transitioned"
      || (event.type === "socrates.turn.updated" && ["completed", "failed", "cancelled"].includes(event.payload.turn.status))
    ) {
      window.setTimeout(() => void refreshRef.current(), 60);
    }
  }, []);

  const socket = useSocratesSocket({
    enabled: Boolean(state),
    afterSequence: state?.snapshot.lastEventSequence ?? 0,
    onEvent: handleEvent,
    onError: setSocketError,
  });

  const sendCommand = useCallback((type: SocratesClientCommand["type"], payload: unknown, scope: { goalId?: string; turnId?: string } = {}) => {
    socket.send(makeSocratesCommand(type, payload, scope));
  }, [socket]);

  const runtimeConfig = useMemo<SocratesRuntimeConfig | null>(() => selectedModel && selectedThinking ? {
    providerId: selectedModel.providerId,
    authMode: selectedModel.authMode,
    modelId: selectedModel.modelId,
    thinkingEnabled: selectedThinking.enabled,
    ...(selectedThinking.effort ? { thinkingEffort: selectedThinking.effort } : {}),
    approvalMode: "manual",
    sandboxMode: "workspace_write",
    ...(selectedModel.contextWindowTokens ? { contextWindowTokens: selectedModel.contextWindowTokens } : {}),
  } : null, [selectedModel, selectedThinking]);

  const selectModel = useCallback((model: ModelOption) => {
    setSelectedModel(model);
    window.localStorage.setItem(MODEL_STORAGE_KEY, modelKey(model));
    setSelectedThinking(thinkingFor(model));
  }, []);

  const selectThinking = useCallback((option: ModelThinkingOption) => {
    if (!selectedModel) return;
    setSelectedThinking(option);
    window.localStorage.setItem(`${THINKING_STORAGE_PREFIX}:${modelKey(selectedModel)}`, option.id);
  }, [selectedModel]);

  const loadGoalExchanges = useCallback(async (goalId: string, earlier = false) => {
    if (loadingGoalIds.has(goalId)) return;
    const currentWindow = exchangeWindows[goalId];
    setLoadingGoalIds((current) => new Set(current).add(goalId));
    try {
      const page = await socratesApi.listGoalExchanges(goalId, earlier ? currentWindow?.beforeOrdinal : undefined);
      setGoalExchanges((current) => ({
        ...current,
        [goalId]: earlier
          ? mergeExchanges(page.exchanges, current[goalId] ?? [], "prepend")
          : mergeExchanges(page.exchanges, [], "replace"),
      }));
      setExchangeWindows((current) => ({ ...current, [goalId]: page.exchangeWindow }));
    } finally {
      setLoadingGoalIds((current) => {
        const next = new Set(current);
        next.delete(goalId);
        return next;
      });
    }
  }, [exchangeWindows, loadingGoalIds]);

  useEffect(() => {
    const goalId = state?.snapshot.state.foregroundGoalId;
    if (!goalId || goalExchanges[goalId]) return;
    const timer = window.setTimeout(() => void loadGoalExchanges(goalId), 0);
    return () => window.clearTimeout(timer);
  }, [goalExchanges, loadGoalExchanges, state?.snapshot.state.foregroundGoalId]);

  const loadEarlierGoals = useCallback(async () => {
    if (!goalWindow?.hasEarlier || !goalWindow.beforeCursor || isLoadingEarlierGoals) return;
    setIsLoadingEarlierGoals(true);
    try {
      const page = await socratesApi.listGoals(goalWindow.beforeCursor);
      setGoals((current) => mergeById(current, page.goals));
      setGoalWindow(page.goalWindow);
    } finally {
      setIsLoadingEarlierGoals(false);
    }
  }, [goalWindow, isLoadingEarlierGoals]);

  const searchHistory = useCallback(async (query: string) => {
    if (!query.trim()) {
      setHistorySearch(null);
      return;
    }
    setIsSearching(true);
    try {
      const result = await socratesApi.searchHistory(query.trim());
      setHistorySearch(result);
      setGoals((current) => mergeById(current, result.goals));
      setGoalExchanges((current) => result.exchanges.reduce((next, exchange) => ({
        ...next,
        [exchange.goalId]: mergeExchanges([exchange], next[exchange.goalId] ?? [], "prepend"),
      }), current));
    } finally {
      setIsSearching(false);
    }
  }, []);

  const foregroundGoalId = state?.snapshot.state.foregroundGoalId;
  const sendMessage = useCallback((content: string, attachmentIds: readonly string[] = []) => {
    if (!runtimeConfig) throw new Error("Choose a model before sending.");
    sendCommand("socrates.message.send", {
      clientMessageId: createSocratesClientId("socrates_message"),
      content,
      ...(attachmentIds.length ? { attachmentIds } : {}),
      ...(foregroundGoalId
        ? { foregroundGoalIdAtCompose: foregroundGoalId }
        : {}),
      runtimeConfig,
    });
  }, [foregroundGoalId, runtimeConfig, sendCommand]);

  const respondToClarification = useCallback((answer: string) => {
    const routing = state?.snapshot.pendingClarification;
    if (!routing) throw new Error("There is no pending focus clarification.");
    sendCommand("socrates.routing.clarification.respond", {
      routingRunId: routing.id,
      answerMessageId: createSocratesClientId("socrates_message"),
      answer,
    }, { turnId: routing.turnId });
  }, [sendCommand, state?.snapshot.pendingClarification]);

  const updateGoal = useCallback((goalId: string, action: "switch" | "pause" | "finish" | "reopen" | "archive" | "pin" | "unpin") => {
    sendCommand("socrates.goal.update", { goalId, action }, { goalId });
  }, [sendCommand]);

  const decideApproval = useCallback((approvalId: string, decision: "approved" | "rejected") => {
    sendCommand("socrates.approval.decide", { approvalId, decision });
  }, [sendCommand]);

  const resolveCredential = useCallback((request: SocratesCredentialInputRequest, decision: "submitted" | "cancelled", value?: string) => {
    sendCommand("socrates.credential.input.submit", {
      credentialRequestId: request.id,
      turnId: request.turnId,
      decision,
      ...(value !== undefined ? { value } : {}),
    }, { goalId: request.goalId, turnId: request.turnId });
  }, [sendCommand]);

  const cancelActiveTurn = useCallback(() => {
    const turnId = state?.snapshot.activeTurn?.id;
    if (turnId) sendCommand("socrates.turn.cancel", { turnId, reason: "Cancelled by the user." }, { turnId });
  }, [sendCommand, state?.snapshot.activeTurn?.id]);

  const sendTerminalInput = useCallback((terminalId: string, text: string) => {
    sendCommand("socrates.terminal.input", { terminalId, text, submit: true });
  }, [sendCommand]);

  const stopTerminal = useCallback((terminalId: string) => {
    sendCommand("socrates.terminal.stop", { terminalId, reason: "Stopped by the user." });
  }, [sendCommand]);

  return {
    state,
    isHydrating,
    loadError,
    socketError,
    clearError: () => setSocketError(null),
    refresh,
    connectionStatus: socket.status,
    isConnected: socket.isConnected,
    goals,
    goalWindow,
    isLoadingEarlierGoals,
    loadEarlierGoals,
    goalExchanges,
    exchangeWindows,
    loadingGoalIds,
    loadGoalExchanges,
    historySearch,
    isSearching,
    searchHistory,
    models,
    selectedModel,
    selectedThinking,
    modelError,
    selectModel,
    selectThinking,
    runtimeConfig,
    sendMessage,
    respondToClarification,
    updateGoal,
    decideApproval,
    resolveCredential,
    cancelActiveTurn,
    sendTerminalInput,
    stopTerminal,
    uploadAttachments: socratesApi.uploadAttachments,
    deleteGoal: socratesApi.deleteGoal,
    deleteExchange: socratesApi.deleteExchange,
  };
}

const mergeById = <T extends { id: string }>(left: readonly T[], right: readonly T[]): T[] =>
  [...new Map([...left, ...right].map((item) => [item.id, item])).values()];

const mergeExchanges = (
  incoming: readonly SocratesGoalExchange[],
  current: readonly SocratesGoalExchange[],
  mode: "prepend" | "replace",
): SocratesGoalExchange[] => {
  if (mode === "replace") return [...incoming].sort((a, b) => a.ordinal - b.ordinal);
  return [...new Map([...incoming, ...current].map((exchange) => [exchange.taskId, exchange])).values()]
    .sort((a, b) => a.ordinal - b.ordinal);
};
