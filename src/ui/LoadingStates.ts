/**
 * LoadingStates.ts — loading spinner & skeleton states (v0.9, additive).
 *
 * WCAG 2.2 AA contract:
 *   - Container is role="status" with aria-busy="true" and an accessible name,
 *     so screen readers announce the pending state politely.
 *   - Decorative spinner/skeleton shapes are aria-hidden; meaning comes from
 *     the visible text + accessible name.
 *   - Motion respects prefersReducedMotion() (JS class hook) AND the CSS
 *     media query (runtime OS changes) — animations are disabled, text stays.
 *
 * Style injection follows the AppNav pattern: one <style> element, injected
 * once, flagged via dataset.
 */

import { createLiveRegion, prefersReducedMotion } from "../accessibility/a11y.js";

export type LoadingMode = "spinner" | "skeleton";

export type LoadingOptions = {
  /** Visual style. Default "spinner". */
  mode?: LoadingMode;
  /** Accessible name, e.g. "Loading sessions". Default "Loading". */
  label?: string;
  /** Visible status text (also announced by the live region). */
  message?: string;
  /** Row count for skeleton mode. Default 3. */
  skeletonRows?: number;
};

let stylesInjected = false;

function injectLoadingStyles(): void {
  if (stylesInjected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.dataset.autosdLoading = "";
  style.textContent = [
    ".autosd-loading{display:flex;align-items:center;gap:8px;padding:8px 0;color:inherit;}",
    ".autosd-loading__spinner{flex:none;width:20px;height:20px;border-radius:50%;border:3px solid rgba(0,95,204,0.25);border-top-color:#005fcc;animation:autosd-spin 900ms linear infinite;}",
    ".autosd-loading__text{font-size:0.95em;}",
    ".autosd-skeleton{flex:1;min-width:0;}",
    ".autosd-skeleton__row{height:14px;border-radius:4px;margin:10px 0;background:#e6eaef;background-image:linear-gradient(90deg,transparent,rgba(255,255,255,0.7),transparent);background-repeat:no-repeat;background-size:200px 100%;animation:autosd-shimmer 1.2s ease-in-out infinite;}",
    ".autosd-skeleton__row:last-child{margin-bottom:0;}",
    "@keyframes autosd-spin{to{transform:rotate(360deg)}}",
    "@keyframes autosd-shimmer{from{background-position:-200px 0}to{background-position:calc(200px + 100%) 0}}",
    // Reduced motion: JS hook class + media query both kill animation.
    ".autosd-loading.autosd-reduced-motion .autosd-loading__spinner,.autosd-loading.autosd-reduced-motion .autosd-skeleton__row{animation:none;}",
    "@media (prefers-reduced-motion: reduce){.autosd-loading__spinner,.autosd-skeleton__row{animation:none;}}",
  ].join("\n");
  document.head.appendChild(style);
  stylesInjected = true;
}

/**
 * Accessible loading indicator. Mount while work is in flight, unmount when done.
 */
export class LoadingIndicator {
  private container: HTMLElement;
  private textEl: HTMLSpanElement;

  constructor(opts: LoadingOptions = {}) {
    injectLoadingStyles();
    const mode = opts.mode ?? "spinner";
    const rows = opts.skeletonRows ?? 3;
    const label = opts.label ?? "Loading";

    this.container = document.createElement("div");
    this.container.className = "autosd-loading";
    const spec = createLiveRegion("");
    this.container.setAttribute("role", spec.role);
    this.container.setAttribute("aria-live", spec.ariaLive);
    this.container.setAttribute("aria-busy", "true");
    this.container.setAttribute("aria-label", label);
    if (prefersReducedMotion()) this.container.classList.add("autosd-reduced-motion");

    if (mode === "spinner") {
      const spinner = document.createElement("span");
      spinner.className = "autosd-loading__spinner";
      spinner.setAttribute("aria-hidden", "true");
      this.container.appendChild(spinner);
    } else {
      const skeleton = document.createElement("div");
      skeleton.className = "autosd-skeleton";
      skeleton.setAttribute("aria-hidden", "true");
      for (let i = 0; i < rows; i++) {
        const row = document.createElement("div");
        row.className = "autosd-skeleton__row";
        skeleton.appendChild(row);
      }
      this.container.appendChild(skeleton);
    }

    this.textEl = document.createElement("span");
    this.textEl.className = "autosd-loading__text";
    this.textEl.textContent = opts.message ?? `${label}…`;
    this.container.appendChild(this.textEl);
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.container);
  }

  unmount(): void {
    this.container.remove();
  }

  getElement(): HTMLElement {
    return this.container;
  }

  /** Update visible status text; role="status" announces the change politely. */
  setMessage(message: string): void {
    this.textEl.textContent = message;
  }

  setBusy(busy: boolean): void {
    this.container.setAttribute("aria-busy", String(busy));
  }
}

/** Standalone spinner element (thin wrapper around LoadingIndicator). */
export function createSpinner(opts: Omit<LoadingOptions, "mode"> = {}): HTMLElement {
  return new LoadingIndicator({ ...opts, mode: "spinner" }).getElement();
}

/** Standalone skeleton block (thin wrapper around LoadingIndicator). */
export function createSkeleton(
  opts: Omit<LoadingOptions, "mode"> & { skeletonRows?: number } = {},
): HTMLElement {
  return new LoadingIndicator({ ...opts, mode: "skeleton" }).getElement();
}

/**
 * Run an async operation with a mounted loading indicator.
 * The indicator is always removed afterwards; errors propagate to the caller
 * so they can be surfaced through ErrorStates.ts (never swallowed here).
 */
export async function withLoading<T>(
  op: () => Promise<T>,
  host: HTMLElement,
  opts: LoadingOptions = {},
): Promise<T> {
  const indicator = new LoadingIndicator(opts);
  indicator.mount(host);
  try {
    return await op();
  } finally {
    indicator.unmount();
  }
}
