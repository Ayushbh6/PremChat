"use client";

import { FolderOpen, Settings, Shield, ShieldAlert, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FilesystemAccessMode, FilesystemAccessState } from "@socrates/contracts";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

const modeLabel: Record<FilesystemAccessMode, string> = {
  read_only: "Read only",
  selected: "Selected",
  full: "Full access",
};

interface AccessControlsProps {
  variant?: "default" | "seamless";
  onOpenSettings?: () => void;
}

export function AccessControls({ variant = "default", onOpenSettings }: AccessControlsProps) {
  const [access, setAccess] = useState<FilesystemAccessState | null>(null);
  const [isPathsOpen, setIsPathsOpen] = useState(false);
  const [isFullConfirmationOpen, setIsFullConfirmationOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAccess = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      setAccess(await api.getFilesystemAccess());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load filesystem access.");
    } finally {
      setIsBusy(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void api.getFilesystemAccess()
      .then((state) => {
        if (active) setAccess(state);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load filesystem access.");
      });
    return () => {
      active = false;
    };
  }, []);

  const updateMode = async (mode: FilesystemAccessMode) => {
    if (mode === access?.mode) return;
    if (mode === "full") {
      setIsFullConfirmationOpen(true);
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      setAccess(await api.updateFilesystemAccess({ mode }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update filesystem access.");
    } finally {
      setIsBusy(false);
    }
  };

  const confirmFullAccess = async () => {
    setIsBusy(true);
    setError(null);
    try {
      setAccess(await api.updateFilesystemAccess({ mode: "full" }));
      setIsFullConfirmationOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not enable Full access.");
    } finally {
      setIsBusy(false);
    }
  };

  const addPath = async () => {
    setIsBusy(true);
    setError(null);
    try {
      const selected = await api.pickWorkspaceFolder({ mode: "existing_folder" });
      const result = await api.addFilesystemRoot({ path: selected.path, label: selected.folderName });
      setAccess(result.access);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not add the selected path.";
      if (!message.toLowerCase().includes("cancel")) setError(message);
    } finally {
      setIsBusy(false);
    }
  };

  const removePath = async (rootId: string) => {
    setIsBusy(true);
    setError(null);
    try {
      const result = await api.removeFilesystemRoot(rootId);
      setAccess(result.access);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove the selected path.");
    } finally {
      setIsBusy(false);
    }
  };

  const setDefaultPath = async (rootId: string) => {
    setIsBusy(true);
    setError(null);
    try {
      const result = await api.updateFilesystemRoot(rootId, { isDefault: true });
      setAccess(result.access);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not change the working path.");
    } finally {
      setIsBusy(false);
    }
  };

  const activeRootCount = access?.roots.filter((root) => root.status === "active").length ?? 0;
  const full = access?.mode === "full";
  const seamless = variant === "seamless";
  const controlClassName = seamless
    ? "inline-flex h-9 items-center gap-2 rounded-full border border-transparent bg-transparent px-2.5 text-xs font-medium text-brand-text-light transition-colors hover:bg-white/45 hover:text-brand-text-dark focus-visible:bg-white/55 focus-visible:text-brand-text-dark focus-visible:outline-none"
    : "inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-brand-text-light shadow-sm hover:bg-gray-50 hover:text-brand-text-dark";

  return (
    <>
      <div className={seamless ? "flex shrink-0 items-center gap-0.5" : "ml-2 flex shrink-0 items-center gap-2"} aria-label="Filesystem access controls">
        <button
          type="button"
          className={`${controlClassName} ${error && !access ? "text-red-700" : ""}`}
          onClick={() => setIsPathsOpen(true)}
          aria-label={error && !access
            ? "Paths unavailable. Open to retry"
            : `Paths, ${activeRootCount} selected`}
          title={error && !access ? "Paths are unavailable — open to retry" : "Choose paths Socrates can use"}
        >
          {error && !access ? <ShieldAlert className="size-4" aria-hidden="true" /> : <FolderOpen className="size-4" aria-hidden="true" />}
          <span className="hidden sm:inline">Paths</span>
          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 font-mono text-[10px]">{error && !access ? "!" : activeRootCount}</span>
        </button>
        <label
          className={`inline-flex h-9 items-center gap-2 px-2.5 text-xs font-medium ${seamless ? "rounded-full transition-colors hover:bg-white/45" : "rounded-md border shadow-sm"} ${
            full
              ? seamless ? "border border-orange-200/70 bg-orange-50/55 text-orange-700" : "border-orange-300 bg-orange-50 text-orange-700"
              : seamless ? "border border-transparent bg-transparent text-brand-text-light" : "border-gray-200 bg-white text-brand-text-light"
          }`}
        >
          {full ? <ShieldAlert className="size-4" aria-hidden="true" /> : <Shield className="size-4" aria-hidden="true" />}
          <span className="hidden lg:inline">Access</span>
          {access ? (
            <select
              aria-label="Filesystem access mode"
              className="max-w-24 bg-transparent text-xs font-medium outline-none"
              value={access.mode}
              disabled={isBusy}
              onChange={(event) => void updateMode(event.target.value as FilesystemAccessMode)}
            >
              <option value="read_only">{modeLabel.read_only}</option>
              <option value="selected">{modeLabel.selected}</option>
              <option value="full">{modeLabel.full}</option>
            </select>
          ) : (
            <span role={error ? "status" : undefined}>{error ? "Unavailable" : "Loading…"}</span>
          )}
        </label>
        {onOpenSettings ? (
          <button
            type="button"
            onClick={onOpenSettings}
            className={seamless
              ? "inline-flex h-9 items-center gap-2 rounded-full border border-transparent bg-transparent px-2.5 text-xs font-medium text-brand-text-light transition-colors hover:bg-white/45 hover:text-brand-text-dark focus-visible:bg-white/55 focus-visible:text-brand-text-dark focus-visible:outline-none"
              : "inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-brand-text-light shadow-sm hover:bg-gray-50 hover:text-brand-text-dark"}
            title="Settings"
            aria-label="Settings"
          >
            <Settings className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Settings</span>
          </button>
        ) : (
          <Link
            href="/settings"
            className={seamless
              ? "inline-flex h-9 items-center gap-2 rounded-full border border-transparent bg-transparent px-2.5 text-xs font-medium text-brand-text-light transition-colors hover:bg-white/45 hover:text-brand-text-dark focus-visible:bg-white/55 focus-visible:text-brand-text-dark focus-visible:outline-none"
              : "inline-flex size-9 items-center justify-center rounded-md border border-gray-200 bg-white text-brand-text-light shadow-sm hover:bg-gray-50 hover:text-brand-text-dark"}
            title="Settings"
            aria-label="Settings"
          >
            <Settings className="size-4" aria-hidden="true" />
            {seamless ? <span className="hidden sm:inline">Settings</span> : null}
          </Link>
        )}
      </div>

      {isPathsOpen ? (
        <Modal
          title="Paths"
          description="Selected paths are the folders structured file tools can read and change. Choose one working path for relative paths and Terminal cwd."
          onClose={isBusy ? undefined : () => setIsPathsOpen(false)}
          footer={(
            <>
              <Button variant="outline" onClick={() => setIsPathsOpen(false)}>Done</Button>
              <Button onClick={() => void addPath()} disabled={isBusy}>Add path</Button>
            </>
          )}
        >
          <div className="space-y-3">
            {access?.roots.length ? access.roots.map((root) => (
              <div key={root.id} className="flex items-center gap-3 rounded-2xl border border-gray-200 px-4 py-3">
                <FolderOpen className="size-4 shrink-0 text-brand-text-light" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-brand-text-dark">{root.label}</p>
                    {root.isDefault ? <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-brand-teal-dark">Working path</span> : null}
                    {root.status === "missing" ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">Missing</span> : null}
                  </div>
                  <p className="truncate font-mono text-[11px] text-brand-text-light" title={root.path}>{root.path}</p>
                </div>
                {!root.isDefault && root.status === "active" ? (
                  <button type="button" className="text-xs font-medium text-brand-teal-dark hover:underline" onClick={() => void setDefaultPath(root.id)} disabled={isBusy}>
                    Use
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-md p-2 text-brand-text-light hover:bg-red-50 hover:text-red-700"
                  aria-label={`Remove ${root.label}`}
                  onClick={() => void removePath(root.id)}
                  disabled={isBusy}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
            )) : (
              <div className="rounded-2xl border border-dashed border-gray-300 px-5 py-8 text-center text-sm text-brand-text-light">
                No paths selected. Add a folder before using Selected access.
              </div>
            )}
            {error ? (
              <div className="flex items-center justify-between gap-3" role="alert">
                <p className="text-sm text-red-700">{error}</p>
                <Button variant="outline" onClick={() => void loadAccess()} disabled={isBusy}>Retry</Button>
              </div>
            ) : null}
            <p className="text-xs leading-5 text-brand-text-light">
              Terminal runs locally as your user. Selected paths checks its requested working directory, but it is not an operating-system sandbox.
            </p>
          </div>
        </Modal>
      ) : null}

      {isFullConfirmationOpen ? (
        <Modal
          title="Enable Full access?"
          description="Socrates will be able to use structured file tools at any path your local user can access. Terminal remains approval-controlled, and destructive, credential, and sensitive-path safeguards stay enabled."
          onClose={isBusy ? undefined : () => setIsFullConfirmationOpen(false)}
          footer={(
            <>
              <Button variant="outline" onClick={() => setIsFullConfirmationOpen(false)} disabled={isBusy}>Cancel</Button>
              <Button className="bg-orange-600 hover:bg-orange-700" onClick={() => void confirmFullAccess()} disabled={isBusy}>
                Enable Full access
              </Button>
            </>
          )}
        >
          <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm leading-6 text-orange-900">
            Full access expands filesystem scope. It does not bypass approvals or turn Terminal into a sandboxed process.
          </div>
        </Modal>
      ) : null}
    </>
  );
}
