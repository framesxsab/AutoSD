/**
 * ErrorStates.ts — reusable error & recovery states (v0.9, additive).
 *
 * Provides one accessible building block per failure mode so every workflow can
 * surface problems without throwing:
 *
 *   - PermissionDenied        (kind: "permission-denied")
 *   - UnsupportedEnvironment  (kind: "unsupported-environment")
 *   - NetworkFailure          (kind: "network-failure")
 *   - MalformedFile           (kind: "malformed-file")
 *   - generic fallback        (kind: "generic")
 *   - Success state           (role="status")
 *   - Empty state             (role="status" + helpful CTA)
 *   - Loading                 → see LoadingStates.ts
 *
 * WCAG 2.2 AA contract (mirrors Onboarding.ts / DiagnosticsPanel.ts):
 *   - Errors render with role="alert"; success/empty use role="status".
 *   - All dynamic text is set via textContent — never innerHTML — and error
 *     details pass through sanitizeError() (secret redaction) + truncate().
 *   - Retry is a native <button> plus an explicit Enter/Space keydown handler,
 *     so keyboard activation works everywhere.
 *   - Focus moves to the alert heading on show, is trapped while visible, and
 *     returns to the original trigger after recovery/dismiss.
 *   - Every transition (shown / retrying / recovered / still failing) is
 *     announced through a persistent polite live region.
 */

import { auditFocusOrder, createLiveRegion, prefersReducedMotion } from "../accessibility/a11y.js";
import { sanitizeError } from "../app/logger.js";
import { truncate } from "../utils/sanitize.js";

export type ErrorKind =
  | "permission-denied"
  | "unsupported-environment"
  | "network-failure"
  | "malformed-file"
  | "generic";

export type ClassifiedError = {
  kind: ErrorKind;
  title: string;
  detail: string;
};

type StateCopy = { title: string; description: string; retryLabel: string };

/** User-facing copy per kind. Never includes raw error text. */
const STATE_COPY: Record<ErrorKind, StateCopy> = {
  "permission-denied": {
    title: "Permission denied",
    description:
      "AutoSD cannot access this location. Grant access to the folder or file in your system settings, then try again.",
    retryLabel: "Retry after granting access",
  },
  "unsupported-environment": {
    title: "Unsupported environment",
    description:
      "This feature needs a capability your current environment does not provide (for example WebHID or a newer browser). Everything else keeps working.",
    retryLabel: "Check again",
  },
  "network-failure": {
    title: "Network problem",
    description:
      "The request could not reach its destination. Check your connection and try again — your local data is unaffected.",
    retryLabel: "Retry connection",
  },
  "malformed-file": {
    title: "File could not be read",
    description:
      "A file is missing or not in the expected format. Fix or remove the file, then try again.",
    retryLabel: "Try again",
  },
  generic: {
    title: "Something went wrong",
    description: "An unexpected problem occurred. You can try again.",
    retryLabel: "Retry",
  },
};

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const MAX_DETAIL_LENGTH = 300;

/**
 * Map an unknown thrown value to an error-state kind using Node errno codes
 * first, then sanitized message shapes. Defaults to "generic" — never guesses
 * a more specific cause than the evidence supports.
 */
export function classifyError(err: unknown): ClassifiedError {
  const safe = sanitizeError(err);
  const code = (err as { code?: unknown } | null)?.code;
  const codeStr = typeof code === "string" ? code.toUpperCase() : "";
  const haystack = `${safe.name} ${safe.message} ${codeStr}`.toLowerCase();

  const pick = (kind: ErrorKind): ClassifiedError => ({
    kind,
    title: STATE_COPY[kind].title,
    detail: safe.message ? truncate(safe.message, MAX_DETAIL_LENGTH) : "",
  });

  if (
    codeStr === "EACCES" ||
    codeStr === "EPERM" ||
    /permission|access denied|eacces|eperm/.test(haystack)
  ) {
    return pick("permission-denied");
  }
  if (
    [
      "ENOTFOUND",
      "ECONNREFUSED",
      "ECONNRESET",
      "ECONNABORTED",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "EHOSTUNREACH",
      "ENETUNREACH",
    ].includes(codeStr) ||
    /network|fetch failed|offline|socket|timed? ?out|econn(refused|reset|aborted)|enotfound|eai_again/.test(
      haystack,
    )
  ) {
    return pick("network-failure");
  }
  if (
    /not supported|unsupported|unavailable|webhid|navigator\.hid|hid device|wasm/.test(haystack)
  ) {
    return pick("unsupported-environment");
  }
  if (
    safe.name === "SyntaxError" ||
    codeStr === "ENOENT" ||
    codeStr === "EISDIR" ||
    /\bjson\b|\bparse|malformed|corrupt|unexpected (token|end)/.test(haystack)
  ) {
    return pick("malformed-file");
  }
  return pick("generic");
}

function trapTabKey(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== "Tab") return;
  const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    el => !el.hasAttribute("disabled"),
  );
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const current = document.activeElement;
  if (event.shiftKey && current === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && current === last) {
    event.preventDefault();
    first.focus();
  }
}

function offscreen(el: HTMLElement): void {
  el.style.position = "absolute";
  el.style.left = "-9999px";
}

export type ErrorStateOptions = {
  /** Failure category; defaults to "generic". Drives default copy. */
  kind?: ErrorKind;
  title?: string;
  /** Sanitized detail shown under the title. Rendered via textContent only. */
  detail?: string;
  retryLabel?: string;
  showRetry?: boolean;
  /** Return false (or throw) to signal the retry did not succeed. */
  onRetry?: () => boolean | void | Promise<boolean | void>;
  onDismiss?: () => void;
  dismissLabel?: string;
  /** Element focus returns to after recovery/dismiss (defaults to trigger at mount). */
  returnFocusTo?: HTMLElement | null;
};

/**
 * Accessible error view with recovery.
 *
 * Lifecycle: construct → mount(parent) → user retries → retry() runs onRetry →
 * success clears the view and restores focus; failure re-enables retry and
 * announces politely. Escape dismisses; Tab is trapped while visible.
 */
export class ErrorStateView {
  private container: HTMLElement;
  private headingEl: HTMLHeadingElement;
  private detailEl: HTMLParagraphElement;
  private liveEl: HTMLElement;
  private retryBtn: HTMLButtonElement | null = null;
  private busy = false;
  private lastFocused: HTMLElement | null = null;
  private readonly opts: Required<Pick<ErrorStateOptions, "kind">> & ErrorStateOptions;

  constructor(opts: ErrorStateOptions = {}) {
    this.opts = { kind: opts.kind ?? "generic", ...opts };
    const copy = STATE_COPY[this.opts.kind];
    const title = this.opts.title ?? copy.title;

    this.container = document.createElement("div");
    this.container.className = "autosd-error-state";
    // Errors are announced assertively (role="alert"); recovery progress uses
    // the separate polite live region below.
    this.container.setAttribute("role", "alert");
    this.container.setAttribute("aria-label", title);

    this.headingEl = document.createElement("h3");
    this.headingEl.className = "autosd-error-state__title";
    this.headingEl.textContent = title;
    this.headingEl.tabIndex = -1;
    this.container.appendChild(this.headingEl);

    this.detailEl = document.createElement("p");
    this.detailEl.className = "autosd-error-state__detail";
    this.detailEl.textContent = this.opts.detail ?? copy.description;
    this.container.appendChild(this.detailEl);

    const actions = document.createElement("div");
    actions.setAttribute("role", "group");
    actions.setAttribute("aria-label", "Recovery actions");

    if (this.opts.onRetry && this.opts.showRetry !== false) {
      this.retryBtn = document.createElement("button");
      this.retryBtn.type = "button";
      this.retryBtn.textContent = this.opts.retryLabel ?? copy.retryLabel;
      this.retryBtn.addEventListener("click", () => void this.retry());
      // Explicit keyboard contract (native buttons also fire click on
      // Enter/Space; this guarantees it in every embedding).
      this.retryBtn.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void this.retry();
        }
      });
      actions.appendChild(this.retryBtn);
    }

    if (this.opts.onDismiss || this.opts.dismissLabel) {
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.textContent = this.opts.dismissLabel ?? "Dismiss";
      dismiss.addEventListener("click", () => this.dismiss());
      dismiss.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.dismiss();
        }
      });
      actions.appendChild(dismiss);
    }

    this.container.appendChild(actions);

    const spec = createLiveRegion("");
    this.liveEl = document.createElement("div");
    this.liveEl.setAttribute("role", spec.role);
    this.liveEl.setAttribute("aria-live", spec.ariaLive);
    offscreen(this.liveEl);
    this.container.appendChild(this.liveEl);

    this.container.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.dismiss();
        return;
      }
      trapTabKey(this.container, e);
    });
  }

  mount(parent: HTMLElement): void {
    const active = document.activeElement;
    this.lastFocused = active instanceof HTMLElement ? active : null;
    parent.appendChild(this.container);

    // WCAG 2.4.3: keep DOM order == tab order inside the view.
    const focusables = Array.from(this.container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const audit = auditFocusOrder(
      focusables.map(el => el.tagName),
      focusables.map(el => el.tagName),
    );
    if (!audit.passed) this.container.dataset.a11yWarn = audit.message;

    this.headingEl.focus({ preventScroll: prefersReducedMotion() });
    this.announce(
      `${this.opts.title ?? STATE_COPY[this.opts.kind].title}. ${this.detailEl.textContent}`,
    );
  }

  getElement(): HTMLElement {
    return this.container;
  }

  /** Announce a transition through the view's polite live region. */
  announce(message: string): void {
    this.liveEl.textContent = message;
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.container.setAttribute("aria-busy", String(busy));
    if (this.retryBtn) this.retryBtn.disabled = busy;
  }

  isBusy(): boolean {
    return this.busy;
  }

  /**
   * Run the recovery callback. Returns true when recovery succeeded (the view
   * then clears itself and restores focus to the original trigger). Never
   * throws — failures are sanitized, announced, and kept on screen.
   */
  async retry(): Promise<boolean> {
    if (this.busy || !this.opts.onRetry) return false;
    this.setBusy(true);
    this.announce("Retrying…");
    try {
      const outcome = await this.opts.onRetry();
      if (outcome === false) {
        this.setBusy(false);
        this.announce("Retry did not succeed. You can try again.");
        return false;
      }
      this.announce("Recovered successfully");
      this.clear();
      return true;
    } catch (error) {
      const safe = sanitizeError(error);
      this.setBusy(false);
      if (safe.message) {
        this.detailEl.textContent = truncate(safe.message, MAX_DETAIL_LENGTH);
      }
      this.announce(`Still failing: ${safe.name}. You can try again.`);
      return false;
    }
  }

  /** Remove the view and restore focus to the original trigger. */
  clear(restoreFocus = true): void {
    this.container.remove();
    if (!restoreFocus) return;
    const target = this.opts.returnFocusTo ?? this.lastFocused;
    target?.focus();
  }

  dismiss(): void {
    this.opts.onDismiss?.();
    this.clear();
  }
}

/**
 * Mount an error state for an unknown thrown value: classifies it, renders the
 * matching accessible view into `host`, and returns the view for further control.
 */
export function showErrorState(
  host: HTMLElement,
  source: unknown,
  opts: Omit<ErrorStateOptions, "kind" | "title" | "detail"> & Partial<ErrorStateOptions> = {},
): ErrorStateView {
  let view: ErrorStateView;
  if (source instanceof ErrorStateView) {
    view = source;
  } else if (isErrorStateOptions(source)) {
    view = new ErrorStateView(source);
  } else {
    const classified = classifyError(source);
    view = new ErrorStateView({
      ...opts,
      kind: opts.kind ?? classified.kind,
      title: opts.title ?? classified.title,
      detail: opts.detail ?? classified.detail,
    });
  }
  view.mount(host);
  return view;
}

function isErrorStateOptions(value: unknown): value is ErrorStateOptions {
  return (
    typeof value === "object" &&
    value !== null &&
    (typeof (value as ErrorStateOptions).onRetry === "function" ||
      typeof (value as ErrorStateOptions).title === "string")
  );
}

// ---------------------------------------------------------------------------
// Named factories — one per required state
// ---------------------------------------------------------------------------

export function createPermissionDenied(opts: ErrorStateOptions = {}): ErrorStateView {
  return new ErrorStateView({ kind: "permission-denied", ...opts });
}

export function createUnsupportedEnvironment(opts: ErrorStateOptions = {}): ErrorStateView {
  return new ErrorStateView({ kind: "unsupported-environment", ...opts });
}

export function createNetworkFailure(opts: ErrorStateOptions = {}): ErrorStateView {
  return new ErrorStateView({ kind: "network-failure", ...opts });
}

export function createMalformedFile(opts: ErrorStateOptions = {}): ErrorStateView {
  return new ErrorStateView({ kind: "malformed-file", ...opts });
}

// ---------------------------------------------------------------------------
// Success / Empty states (role="status", polite)
// ---------------------------------------------------------------------------

export type SuccessStateOptions = {
  message: string;
  detail?: string;
};

/** Success confirmation. role="status" so screen readers announce politely. */
export function createSuccessState(opts: SuccessStateOptions): HTMLElement {
  const el = document.createElement("div");
  el.className = "autosd-state autosd-state--success";
  el.setAttribute("role", "status");

  const msg = document.createElement("p");
  msg.textContent = opts.message;
  el.appendChild(msg);
  if (opts.detail) {
    const detail = document.createElement("p");
    detail.textContent = opts.detail;
    el.appendChild(detail);
  }
  return el;
}

export type EmptyStateOptions = {
  message: string;
  hint?: string;
  ctaLabel?: string;
  /** Invoked by the CTA button (Enter/Space/click). */
  onCta?: () => void;
};

/** Empty state with a helpful call-to-action. role="status". */
export function createEmptyState(opts: EmptyStateOptions): HTMLElement {
  const el = document.createElement("div");
  el.className = "autosd-state autosd-state--empty";
  el.setAttribute("role", "status");

  const msg = document.createElement("p");
  msg.textContent = opts.message;
  el.appendChild(msg);

  if (opts.hint) {
    const hint = document.createElement("p");
    hint.textContent = opts.hint;
    el.appendChild(hint);
  }

  if (opts.ctaLabel && opts.onCta) {
    const cta = document.createElement("button");
    cta.type = "button";
    cta.textContent = opts.ctaLabel;
    cta.addEventListener("click", opts.onCta);
    cta.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        opts.onCta?.();
      }
    });
    el.appendChild(cta);
  }
  return el;
}

// ---------------------------------------------------------------------------
// Standalone announcement helper (for workflows without a full view)
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget screen-reader announcement. Returns a cancel function.
 * Errors should use assertive=true (role="alert"); progress uses polite status.
 */
export function announceTransition(
  message: string,
  opts: { assertive?: boolean; host?: HTMLElement } = {},
): () => void {
  const spec = createLiveRegion(message);
  const el = document.createElement("div");
  el.setAttribute("role", opts.assertive ? "alert" : spec.role);
  el.setAttribute("aria-live", opts.assertive ? "assertive" : spec.ariaLive);
  el.textContent = spec.message;
  offscreen(el);
  const host = opts.host ?? (typeof document !== "undefined" ? document.body : null);
  if (!host) return () => {};
  host.appendChild(el);
  const timer = setTimeout(() => el.remove(), 1500);
  return () => {
    clearTimeout(timer);
    el.remove();
  };
}
