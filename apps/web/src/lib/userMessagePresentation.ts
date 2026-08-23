export const LONG_USER_MESSAGE_COLLAPSE_THRESHOLD_PX = 98;

export interface LongUserMessagePresentationInput {
  enabled: boolean;
  contentHeight: number;
  isExpanded: boolean;
}

export interface LongUserMessagePresentation {
  isOverflowing: boolean;
  isCollapsed: boolean;
  showDisclosure: boolean;
}

export const resolveLongUserMessagePresentation = (
  input: LongUserMessagePresentationInput,
): LongUserMessagePresentation => {
  const isOverflowing = input.enabled
    && Number.isFinite(input.contentHeight)
    && input.contentHeight > LONG_USER_MESSAGE_COLLAPSE_THRESHOLD_PX;
  return {
    isOverflowing,
    isCollapsed: isOverflowing && !input.isExpanded,
    showDisclosure: isOverflowing,
  };
};
