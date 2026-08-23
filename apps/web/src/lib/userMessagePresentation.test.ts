import { describe, expect, it } from "vitest";
import {
  LONG_USER_MESSAGE_COLLAPSE_THRESHOLD_PX,
  resolveLongUserMessagePresentation,
} from "./userMessagePresentation";

describe("long user message presentation", () => {
  it("does not offer Show more at the collapse threshold", () => {
    expect(resolveLongUserMessagePresentation({
      enabled: true,
      contentHeight: LONG_USER_MESSAGE_COLLAPSE_THRESHOLD_PX,
      isExpanded: false,
    })).toEqual({
      isOverflowing: false,
      isCollapsed: false,
      showDisclosure: false,
    });
  });

  it("collapses and offers Show more above the threshold", () => {
    expect(resolveLongUserMessagePresentation({
      enabled: true,
      contentHeight: LONG_USER_MESSAGE_COLLAPSE_THRESHOLD_PX + 1,
      isExpanded: false,
    })).toEqual({
      isOverflowing: true,
      isCollapsed: true,
      showDisclosure: true,
    });
  });

  it("keeps the disclosure while expanded and bypasses it when disabled", () => {
    expect(resolveLongUserMessagePresentation({
      enabled: true,
      contentHeight: 500,
      isExpanded: true,
    })).toEqual({
      isOverflowing: true,
      isCollapsed: false,
      showDisclosure: true,
    });
    expect(resolveLongUserMessagePresentation({
      enabled: false,
      contentHeight: 500,
      isExpanded: false,
    }).showDisclosure).toBe(false);
  });
});
