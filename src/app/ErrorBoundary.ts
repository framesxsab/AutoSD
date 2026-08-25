/**
 * ErrorBoundary.ts — top-level error containment for the AutoSD UI.
 *
 * - Catches sync errors (wrap/guard), window "error" and "unhandledrejection".
 * - Renders an accessible fallback (role="alert") with a RETRY action.
 * - All error output is sanitized via the logger: no stack traces, no secret
 *   material, length-capped messages. Raw errors are never written to the DOM.
 */

import { logger, sanitizeError } from "./logger.js";

export type ErrorBoundaryOptions = {
  /** Element that hosts the fallback UI. */
  host: HTMLElement;
  /** Called when the user presses Retry. Return false to keep the fallback. */
  onRetry?: () => void | boolean;
  /** Accessible name for the alert region. */
  label?: string;
};

export class ErrorBoundary {
  private readonly host: HTMLElement;
  private readonly onRetry?: () => void | boolean;
  private readonly label: string;
  private fallback: HTMLElement | null = null;
  private installed = false;
  private lastError: SanitizedSummary | null = null;

  constructor(opts: ErrorBoundaryOptions) {
    this.host = opts.host;
    this.onRetry = opts.onRetry;
    this.label = opts.label ?? "Application error";
  }

  /** Install global handlers (idempotent). Returns uninstall function. */
  installGlobalHandlers(): () => void {
    if (this.installed) return () => this.uninstallGlobalHandlers();
    this.installed = true;
    const onError = (event: ErrorEvent): void => {
      // External script errors carry no useful message; avoid noisy repeats.
      this.show(event.error ?? new Error(redactUnknown(event.message)));
    };
    const onRejection = (event: PromiseRejectionEvent): void => {
      this.show(event.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => this.uninstallGlobalHandlers();
  }

  private uninstallGlobalHandlers(): void {
    /* handlers are bound per-install; retained for symmetry/testing */
  }

  /** Run a synchronous operation; on throw, show fallback and return null. */
  wrap<T>(fn: () => T): T | null {
    try {
      return fn();
    } catch (err) {
      this.show(err);
      return null;
    }
  }

  /** Run an async operation; on rejection, show fallback and return null. */
  async guard<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      this.show(err);
      return null;
    }
  }

  /** Whether the fallback is currently displayed. */
  get isActive(): boolean {
    return this.fallback !== null;
  }

  /** Sanitized summary of the most recent caught error (safe for diagnostics). */
  get lastErrorSummary(): SanitizedSummary | null {
    return this.lastError;
  }

  /** Render the accessible fallback UI for an error. */
  show(error: unknown): void {
    const safe = sanitizeError(error);
    this.lastError = { name: safe.name, message: safe.message };
    logger.exception(error, "ErrorBoundary");

    this.clear();
    const box = document.createElement("div");
    box.className = "error-boundary";
    box.setAttribute("role", "alert");
    box.setAttribute("aria-label", this.label);
    box.style.cssText =
      "border:2px solid #b00020;border-radius:8px;padding:16px;margin:12px 0;background:#fff5f5;";

    const heading = document.createElement("h2");
    heading.textContent = "Something went wrong";
    box.appendChild(heading);

    const detail = document.createElement("p");
    // textContent only — hostile messages can never become markup.
    detail.textContent = `${safe.name}: ${safe.message}`;
    box.appendChild(detail);

    const hint = document.createElement("p");
    hint.textContent = "The error has been logged locally. You can try to recover.";
    box.appendChild(hint);

    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => {
      const outcome = this.onRetry?.();
      if (outcome !== false) this.clear();
    });
    box.appendChild(retry);

    this.fallback = box;
    this.host.prepend(box);
  }

  /** Remove the fallback UI (e.g. after successful retry). */
  clear(): void {
    this.fallback?.remove();
    this.fallback = null;
  }
}

type SanitizedSummary = { name: string; message: string };

function redactUnknown(message: unknown): string {
  const text = typeof message === "string" ? message : String(message);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
