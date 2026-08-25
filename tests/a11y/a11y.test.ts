import { describe, it, expect } from "vitest";
import {
  passesContrast,
  auditFocusOrder,
  auditTargetSize,
  createLiveRegion,
  WCAG,
} from "../../src/accessibility/a11y.js";

describe("a11y WCAG 2.2 AA", () => {
  it("passesContrast at AA threshold", () => {
    expect(passesContrast(1, 0)).toBe(true);
    expect(passesContrast(0.1, 0.1)).toBe(false);
  });
  it("auditFocusOrder detects divergence", () => {
    expect(auditFocusOrder(["a", "b"], ["a", "b"]).passed).toBe(true);
    expect(auditFocusOrder(["a", "b"], ["b", "a"]).passed).toBe(false);
  });
  it("auditTargetSize enforces 24px minimum", () => {
    expect(auditTargetSize(24, 24).passed).toBe(true);
    expect(auditTargetSize(20, 20).passed).toBe(false);
    expect(WCAG.minTargetSizePx).toBe(24);
  });
  it("createLiveRegion returns polite status", () => {
    const r = createLiveRegion("hello");
    expect(r.ariaLive).toBe("polite");
    expect(r.role).toBe("status");
  });
});
