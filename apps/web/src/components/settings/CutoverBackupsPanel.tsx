"use client";

import { Archive, FolderOpen, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { SocratesBackup } from "@socrates/contracts";
import { socratesApi } from "@/lib/socrates/api";

export function CutoverBackupsPanel() {
  const [backups, setBackups] = useState<SocratesBackup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBackups((await socratesApi.listBackups()).backups);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not inspect cutover archives.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5" aria-labelledby="cutover-backups-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Archive className="size-5 text-teal-700" aria-hidden="true" />
            <h2 id="cutover-backups-title" className="font-semibold">Previous installation archive</h2>
          </div>
          <p className="mt-1 text-sm text-brand-text-light">Verified whole-state archives retained by the global Socrates cutover.</p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-lg p-2 text-brand-text-light hover:bg-gray-50" aria-label="Refresh archive inventory">
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>
      {error ? <p className="mt-4 text-sm text-red-700" role="alert">{error}</p> : null}
      {!loading && !error && backups.length === 0 ? <p className="mt-4 text-sm text-brand-text-light">No cutover archive exists on this installation.</p> : null}
      <div className="mt-4 space-y-3">
        {backups.map((backup) => (
          <div key={backup.id} className="flex flex-col gap-3 rounded-lg bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm">
              <p className="font-medium">{new Date(backup.createdAt).toLocaleString()}</p>
              <p className="mt-1 text-xs text-brand-text-light">{formatBytes(backup.sizeBytes)} · integrity {backup.integrity}</p>
            </div>
            <button
              type="button"
              onClick={() => void socratesApi.revealBackup(backup.id).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not reveal the archive."))}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium hover:bg-gray-100"
            >
              <FolderOpen className="size-4" aria-hidden="true" />Reveal in Finder/Explorer
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1_024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1_024;
  let unit = 0;
  while (value >= 1_024 && unit < units.length - 1) { value /= 1_024; unit += 1; }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`;
};
