/**
 * logger.ts — leveled logging with secret redaction.
 *
 * Production strategy:
 *  - Default minimum level: "warn" in production, "debug" otherwise
 *    (overridable via VITE_LOG_LEVEL through src/app/config.ts).
 *  - Every message and error is passed through redact() before output:
 *    API keys (sk-…), Bearer tokens, key=value/query secrets and any
 *    explicitly registered secret values are replaced with "[REDACTED]".
 *  - Errors are logged as { name, message } — stack traces are redacted and
 *    only attached when the logger level is debug (never in production).
 */

import { getConfig } from "./config.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACTED = "[REDACTED]";
/** Hard cap so a hostile error message cannot flood the console. */
const MAX_MESSAGE_LENGTH = 500;

/** Patterns that look like secrets regardless of context. */
const SECRET_PATTERNS: RegExp[] = [
  // OpenAI-style keys: sk-... (>=8 chars of key material)
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  // Authorization headers / bearer tokens
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // query/body params: api_key=…, key=…, token=…, password=…, secret=…
  /([?&"' ](?:api_?key|access_?token|refresh_?token|password|passwd|secret|client_secret)\s*[=:]\s*)[^&"',\s}]+/gi,
];

/**
 * Registered literal secret values (e.g. the runtime OpenAI key) so even
 * non-pattern-matching occurrences never reach the console.
 */
const registeredSecrets = new Set<string>();

/** Register a literal value that must never appear in logs. Never logged itself. */
export function registerSecret(value: string): void {
  if (typeof value === "string" && value.length >= 4) registeredSecrets.add(value);
}

export function clearRegisteredSecrets(): void {
  registeredSecrets.clear();
}

/** Redact known secret shapes + registered literals; truncate to a safe length. */
export function redact(input: unknown): string {
  let text: string;
  if (typeof input === "string") text = input;
  else if (input instanceof Error) text = `${input.name}: ${input.message}`;
  else {
    try {
      text = JSON.stringify(input) ?? String(input);
    } catch {
      text = String(input);
    }
  }
  for (const secret of registeredSecrets) {
    text = text.split(secret).join(REDACTED);
  }
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (_m, p1?: string) => `${p1 ?? ""}${REDACTED}`);
  }
  if (text.length > MAX_MESSAGE_LENGTH) text = `${text.slice(0, MAX_MESSAGE_LENGTH)}…[truncated]`;
  return text;
}

export type SanitizedError = {
  name: string;
  message: string;
  /** Present only at debug level; always redacted. */
  stack?: string;
};

/** Convert an unknown thrown value into a log-safe object (no raw stacks by default). */
export function sanitizeError(err: unknown, opts: { includeStack?: boolean } = {}): SanitizedError {
  const name = err instanceof Error ? err.name : typeof err === "object" ? "Object" : String(err);
  const message = redact(err instanceof Error ? err.message : safeStringify(err));
  const out: SanitizedError = { name, message };
  if (opts.includeStack && err instanceof Error && typeof err.stack === "string") {
    out.stack = redact(err.stack);
  }
  return out;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[unserializable]";
  }
}

export type Logger = {
  readonly level: LogLevel;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  /** Log an Error safely: redacted message, stack only at debug level. */
  exception: (err: unknown, context?: string) => void;
  child: (scope: string) => Logger;
};

function emit(level: LogLevel, minLevel: LogLevel, scope: string, args: unknown[]): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const prefix = scope.length > 0 ? `[autosd:${scope}]` : "[autosd]";
  const rendered = args.map(a => redact(a));
  if (level === "error") console.error(prefix, ...rendered);
  else if (level === "warn") console.warn(prefix, ...rendered);
  else if (level === "info") console.info(prefix, ...rendered);
  else console.debug(prefix, ...rendered);
}

/** Create a logger bound to the configured minimum level. */
export function createLogger(scope = "", levelOverride?: LogLevel): Logger {
  let level: LogLevel;
  try {
    level = levelOverride ?? getConfig().logLevel;
  } catch {
    level = "warn";
  }
  const make =
    (lvl: LogLevel) =>
    (...args: unknown[]) =>
      emit(lvl, level, scope, args);
  return {
    level,
    debug: make("debug"),
    info: make("info"),
    warn: make("warn"),
    error: make("error"),
    exception: (err: unknown, context?: string) => {
      const includeStack = LEVEL_ORDER[level] <= LEVEL_ORDER.debug;
      const safe = sanitizeError(err, { includeStack });
      emit("error", level, scope, context ? [context, safe] : [safe]);
    },
    child: (childScope: string) =>
      createLogger(scope.length > 0 ? `${scope}:${childScope}` : childScope, level),
  };
}

/** Application-wide default logger. */
export const logger: Logger = createLogger("");
