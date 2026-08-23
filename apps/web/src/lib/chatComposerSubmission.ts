export const canSubmitChatComposer = (input: {
  content: string;
  attachmentCount: number;
  isSending: boolean;
  isUploading: boolean;
  voiceInputActive: boolean;
  isConnected: boolean;
  hasSelectedModel: boolean;
}): boolean => (
  (input.content.trim().length > 0 || input.attachmentCount > 0)
  && !input.isSending
  && !input.isUploading
  && !input.voiceInputActive
  && input.isConnected
  && input.hasSelectedModel
);
