import { describe, expect, it } from "vitest";
import { canSubmitChatComposer } from "./chatComposerSubmission";

const readyInput = {
  content: "Continue the goal",
  attachmentCount: 0,
  isSending: false,
  isUploading: false,
  voiceInputActive: false,
  isConnected: true,
  hasSelectedModel: true,
};

describe("ChatComposer submission eligibility", () => {
  it("allows text or attachment-only requests when the runtime is ready", () => {
    expect(canSubmitChatComposer(readyInput)).toBe(true);
    expect(canSubmitChatComposer({ ...readyInput, content: "", attachmentCount: 1 })).toBe(true);
  });

  it("keeps drafts unsent when runtime or model authority is unavailable", () => {
    expect(canSubmitChatComposer({ ...readyInput, isConnected: false })).toBe(false);
    expect(canSubmitChatComposer({ ...readyInput, hasSelectedModel: false })).toBe(false);
  });

  it("blocks duplicate, uploading, voice-active, and empty submissions", () => {
    expect(canSubmitChatComposer({ ...readyInput, isSending: true })).toBe(false);
    expect(canSubmitChatComposer({ ...readyInput, isUploading: true })).toBe(false);
    expect(canSubmitChatComposer({ ...readyInput, voiceInputActive: true })).toBe(false);
    expect(canSubmitChatComposer({ ...readyInput, content: "   " })).toBe(false);
  });
});
