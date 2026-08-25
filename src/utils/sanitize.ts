/**
 * sanitize.ts — shared security helpers for untrusted strings.
 *
 * Untrusted inputs in AutoSD: corpus file contents and filenames (they become
 * document/chunk ids), session JSON on disk, provider error bodies.
 * Rule of thumb: prefer textContent / setAttribute (never parse HTML built
 * from untrusted data). When string HTML is unavoidable, escape EVERY
 * interpolated value with escapeHtml().
 */

/** Escape a value for safe interpolation into HTML text or double/single-quoted attributes. */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escape an untrusted value for use inside a CSS attribute selector.
 * Uses CSS.escape when available; falls back to backslash-escaping quotes
 * and backslashes so querySelector can never be broken out of.
 */
export function escapeSelector(value: unknown): string {
  const text = String(value);
  const cssEscape = (globalThis as unknown as { CSS?: { escape?: (v: string) => string } }).CSS
    ?.escape;
  if (typeof cssEscape === "function") return cssEscape(text);
  return text.replace(/(["\\])/g, "\\$1");
}

/** Hard cap for embedding untrusted text into logs/errors/UI previews. */
export function truncate(value: unknown, max = 300): string {
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}…[truncated]` : text;
}

/**
 * Safe JSON.parse: returns null instead of throwing on malformed input,
 * optional structural guard, and never executes anything (no reviver).
 */
export function safeJsonParse<T>(raw: string, guard?: (value: unknown) => value is T): T | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (guard && !guard(parsed)) return null;
    return parsed as T;
  } catch {
    return null;
  }
}
