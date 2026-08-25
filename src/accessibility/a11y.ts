/**
 * Accessibility — WCAG 2.2 AA guarantees (additive, preserved since v0.3.0).
 * Provides helpers for focus management, live regions, contrast, and target size.
 */

export const WCAG = {
  targetLevel: "AA" as const,
  version: "2.2" as const,
  minContrastAA: 4.5,
  minContrastLargeAA: 3.0,
  minTargetSizePx: 24, // WCAG 2.5.8
} as const;

export type A11yAuditResult = {
  rule: string;
  level: "A" | "AA" | "AAA";
  passed: boolean;
  message: string;
};

export function contrastRatio(lumA: number, lumB: number): number {
  const L1 = Math.max(lumA, lumB);
  const L2 = Math.min(lumA, lumB);
  return (L1 + 0.05) / (L2 + 0.05);
}

export function passesContrast(
  foregroundLum: number,
  backgroundLum: number,
  isLargeText = false,
): boolean {
  const ratio = contrastRatio(foregroundLum, backgroundLum);
  return ratio >= (isLargeText ? WCAG.minContrastLargeAA : WCAG.minContrastAA);
}

export function auditFocusOrder(idsInDomOrder: string[], idsInTabOrder: string[]): A11yAuditResult {
  const passed = idsInDomOrder.join(",") === idsInTabOrder.join(",");
  return {
    rule: "2.4.3 Focus Order",
    level: "A",
    passed,
    message: passed ? "Focus order matches DOM order" : "Focus order diverges from DOM order",
  };
}

export function auditTargetSize(widthPx: number, heightPx: number): A11yAuditResult {
  const passed = widthPx >= WCAG.minTargetSizePx && heightPx >= WCAG.minTargetSizePx;
  return {
    rule: "2.5.8 Target Size (Minimum)",
    level: "AA",
    passed,
    message: passed
      ? `Target ${widthPx}x${heightPx} meets minimum`
      : `Target ${widthPx}x${heightPx} below ${WCAG.minTargetSizePx}px`,
  };
}

export function createLiveRegion(message: string): {
  role: string;
  ariaLive: "polite" | "assertive";
  message: string;
} {
  return { role: "status", ariaLive: "polite", message };
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
