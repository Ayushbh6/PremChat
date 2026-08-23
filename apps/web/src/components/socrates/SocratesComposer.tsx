"use client";

import type { ModelOption, ModelThinkingOption, SocratesMessageAttachment } from "@socrates/contracts";
import { ChatComposer } from "@/components/chat/ChatComposer";
import styles from "./socrates.module.css";

type SocratesComposerProps = Readonly<{
  connected: boolean;
  sending: boolean;
  models: readonly ModelOption[];
  selectedModel: ModelOption | null;
  selectedThinking: ModelThinkingOption | null;
  error?: string | null;
  onModelChange: (model: ModelOption) => void;
  onThinkingChange: (option: ModelThinkingOption) => void;
  onUpload: (files: readonly File[]) => Promise<SocratesMessageAttachment[]>;
  onSend: (content: string, attachments: readonly SocratesMessageAttachment[]) => void;
  onStop: () => void;
}>;

export function SocratesComposer({
  connected,
  sending,
  models,
  selectedModel,
  selectedThinking,
  error,
  onModelChange,
  onThinkingChange,
  onUpload,
  onSend,
  onStop,
}: SocratesComposerProps) {
  return (
    <div className={styles.composerDock}>
      {error ? <p className={styles.composerError} role="alert">{error}</p> : null}
      <div className={styles.composerFrame}>
        <ChatComposer<SocratesMessageAttachment>
          isSending={sending}
          isConnected={connected}
          models={[...models]}
          selectedModel={selectedModel}
          selectedThinkingOption={selectedThinking}
          onModelChange={onModelChange}
          onThinkingChange={onThinkingChange}
          onUploadAttachments={async (files) => onUpload(files)}
          onSend={async (content, attachments) => onSend(content, attachments)}
          onStop={onStop}
        />
      </div>
    </div>
  );
}
