"use client";

import Link from "next/link";
import { ArrowLeft, Brain, Settings } from "lucide-react";
import { McpServersPanel } from "@/components/mcp/McpServersPanel";
import { ProviderCredentialsPanel } from "@/components/settings/ProviderCredentialsPanel";
import { WorkerModelSettingsPanel } from "@/components/settings/WorkerModelSettingsPanel";
import { VoiceSpeechSettingsPanel } from "@/components/settings/VoiceSpeechSettingsPanel";
import { CutoverBackupsPanel } from "@/components/settings/CutoverBackupsPanel";

export default function SettingsPage() {
  return (
    <main className="flex h-screen overflow-hidden bg-brand-bg text-brand-text-dark">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex-none border-b border-gray-200 bg-white/95 px-4 py-3 sm:px-6">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <Link href="/chat" className="inline-flex items-center gap-2 text-sm text-brand-text-light transition-colors hover:text-brand-text-dark">
                <ArrowLeft className="size-4" />
                Back to Socrates
              </Link>
              <div className="mt-2 flex min-w-0 items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                  <Settings className="size-5" />
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-xl font-semibold text-brand-text-dark sm:text-2xl">Settings</h1>
                  <p className="mt-0.5 hidden text-sm text-brand-text-light sm:block">
                    Manage provider access, helper models, voice, embedding prerequisites, and updates.
                  </p>
                </div>
              </div>
            </div>
            <Link
              href="/memory"
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium text-brand-text-dark transition-colors hover:bg-gray-50"
            >
              <Brain className="size-4 text-teal-700" aria-hidden="true" />
              Memory Agent
            </Link>
          </div>
        </header>

        <section className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="mx-auto w-full max-w-7xl space-y-6 pb-4">
            <ProviderCredentialsPanel showUpdater />
            <McpServersPanel
              scope="global"
              title="Global MCP servers"
              description="Bundled and user-added global MCP servers available to Main Socrates when semantically relevant."
              variant="section"
            />
            <WorkerModelSettingsPanel />
            <VoiceSpeechSettingsPanel />
            <CutoverBackupsPanel />
          </div>
        </section>

        <footer className="flex-none border-t border-gray-200 bg-white px-4 py-3 sm:px-6">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-end text-xs text-brand-text-light">
            <span className="truncate text-right">Settings</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
