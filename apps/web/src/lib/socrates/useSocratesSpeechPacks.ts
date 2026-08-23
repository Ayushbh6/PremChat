"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SOCRATES_SPEECH_PACK_IDS,
  socratesSpeechPacksApi,
  type SocratesSpeechPack,
  type SocratesSpeechPackId,
} from "./speechPacksApi";

export type SocratesSpeechPackAction = "installing" | "removing";

type PackErrors = Partial<Record<SocratesSpeechPackId, string>>;
type PackActions = Partial<Record<SocratesSpeechPackId, SocratesSpeechPackAction>>;

const emptyPacks = (): SocratesSpeechPack[] =>
  SOCRATES_SPEECH_PACK_IDS.map((id) => ({ id, installed: false, verified: false, path: "" }));

const orderedPacks = (packs: SocratesSpeechPack[]): SocratesSpeechPack[] => {
  const byId = new Map(packs.map((pack) => [pack.id, pack]));
  return SOCRATES_SPEECH_PACK_IDS.flatMap((id) => {
    const pack = byId.get(id);
    return pack ? [pack] : [];
  });
};

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim() ? error.message : fallback;

export function useSocratesSpeechPacks() {
  const [packs, setPacks] = useState<SocratesSpeechPack[]>(emptyPacks);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actions, setActions] = useState<PackActions>({});
  const [packErrors, setPackErrors] = useState<PackErrors>({});

  const updatePack = useCallback((updated: SocratesSpeechPack) => {
    setPacks((current) => orderedPacks([
      ...current.filter((pack) => pack.id !== updated.id),
      updated,
    ]));
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setPacks(orderedPacks(await socratesSpeechPacksApi.list(signal)));
    } catch (error) {
      if (signal?.aborted) return;
      setLoadError(errorMessage(error, "Could not load the local voice packs."));
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const runAction = useCallback(async (
    packId: SocratesSpeechPackId,
    action: SocratesSpeechPackAction,
  ) => {
    setActions((current) => ({ ...current, [packId]: action }));
    setPackErrors((current) => ({ ...current, [packId]: undefined }));
    try {
      const pack = action === "installing"
        ? await socratesSpeechPacksApi.install(packId)
        : await socratesSpeechPacksApi.remove(packId);
      updatePack(pack);
    } catch (error) {
      setPackErrors((current) => ({
        ...current,
        [packId]: errorMessage(
          error,
          action === "installing" ? "This voice pack could not be installed." : "This voice pack could not be removed.",
        ),
      }));
    } finally {
      setActions((current) => {
        const next = { ...current };
        delete next[packId];
        return next;
      });
    }
  }, [updatePack]);

  const installedCount = useMemo(
    () => packs.filter((pack) => pack.installed && pack.verified).length,
    [packs],
  );

  return {
    packs,
    isLoading,
    loadError,
    actions,
    packErrors,
    installedCount,
    isBusy: Object.keys(actions).length > 0,
    refresh: () => refresh(),
    install: (packId: SocratesSpeechPackId) => runAction(packId, "installing"),
    remove: (packId: SocratesSpeechPackId) => runAction(packId, "removing"),
    clearPackError: (packId: SocratesSpeechPackId) => {
      setPackErrors((current) => ({ ...current, [packId]: undefined }));
    },
  };
}
