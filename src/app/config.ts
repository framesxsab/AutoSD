/**
 * config.ts — validated application configuration.
 *
 * Security contract:
 *  - Reads ONLY non-secret, VITE_-prefixed variables (public by design) plus
 *    the current build mode. Secrets such as OPENAI_API_KEY are intentionally
 *    NOT exposed here; they live in the process environment only and never
 *    enter the client bundle (see docs/SECURITY_ARCHITECTURE.md).
 *  - Validation never throws: invalid values fall back to safe defaults and a
 *    warning is recorded (variable NAME only — never values).
 *  - The resulting object is deeply frozen.
 */

/** Injected at build time by Vite `define` (see vite.config.ts). */
declare const __APP_VERSION__: string | undefined;

export type Environment = "development" | "production" | "test";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type EmbeddingProviderId = "mock" | "local" | "openai";

export type AppConfig = {
  /** App version (from package.json via build-time define). */
  readonly version: string;
  /** Runtime mode: development | production | test. */
  readonly environment: Environment;
  /** True when building/running for production. */
  readonly isProduction: boolean;
  /** Minimum console log level. */
  readonly logLevel: LogLevel;
  /** Which embedding provider bootstrap should register. */
  readonly embeddingProvider: EmbeddingProviderId;
  /** Corpus directory used for watcher + persistence defaults. */
  readonly corpusDir: string;
  /** OpenAI-compatible endpoint (non-secret). */
  readonly openaiBaseUrl: string;
  /** OpenAI embedding model id (non-secret). */
  readonly openaiModel: string;
};

type RawEnv = Record<string, string | boolean | undefined>;

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];
const PROVIDERS: readonly EmbeddingProviderId[] = ["mock", "local", "openai"];
const ENVIRONMENTS: readonly Environment[] = ["development", "production", "test"];

function readRawEnv(): { env: RawEnv; mode?: string } {
  const env: RawEnv = {};
  // Browser/Vite: import.meta.env (guarded — may be absent in tests/node).
  try {
    const meta = import.meta as unknown as { env?: RawEnv };
    if (meta && typeof meta === "object" && meta.env && typeof meta.env === "object") {
      for (const [k, v] of Object.entries(meta.env)) {
        if (typeof v === "string" || typeof v === "boolean") env[k] = v;
      }
    }
  } catch {
    /* import.meta unavailable — ignore */
  }
  // Node/test fallback: process.env fills gaps ONLY if not already set.
  const proc = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
    .process;
  if (proc?.env) {
    for (const [k, v] of Object.entries(proc.env)) {
      if (env[k] === undefined && typeof v === "string") env[k] = v;
    }
  }
  let mode: string | undefined;
  try {
    mode = (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE;
  } catch {
    /* ignore */
  }
  return { env, mode };
}

function pickString(env: RawEnv, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = env[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

function oneOf<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
): { value: T; invalid?: string } {
  if (raw === undefined) return { value: fallback };
  const hit = allowed.find(a => a.toLowerCase() === raw.toLowerCase());
  return hit ? { value: hit } : { value: fallback, invalid: raw };
}

export type ConfigResult = {
  config: AppConfig;
  /** Names of variables that were set but failed validation (names only). */
  warnings: string[];
};

let cached: ConfigResult | null = null;

/** Load + validate configuration. Never throws; falls back to safe defaults. */
export function loadConfig(): ConfigResult {
  if (cached) return cached;
  const warnings: string[] = [];
  const { env, mode } = readRawEnv();

  const envRes = oneOf<Environment>(
    pickString(env, ["VITE_MODE"]) ?? mode,
    ENVIRONMENTS,
    "production",
  );
  if (envRes.invalid) warnings.push("VITE_MODE");
  const isProduction = envRes.value === "production";

  const levelRaw = pickString(env, ["VITE_LOG_LEVEL"]);
  const defaultLevel: LogLevel = isProduction ? "warn" : "debug";
  const levelRes = oneOf<LogLevel>(levelRaw, LOG_LEVELS, defaultLevel);
  if (levelRes.invalid) warnings.push("VITE_LOG_LEVEL");

  const providerRes = oneOf<EmbeddingProviderId>(
    pickString(env, ["VITE_EMBEDDING_PROVIDER"]),
    PROVIDERS,
    "mock",
  );
  if (providerRes.invalid) warnings.push("VITE_EMBEDDING_PROVIDER");

  const corpusDir = pickString(env, ["VITE_CORPUS_DIR"]) ?? "corpus";

  const openaiBaseUrl = sanitizeBaseUrl(
    pickString(env, ["VITE_OPENAI_BASE_URL"]) ?? "https://api.openai.com/v1",
  );
  const openaiModel = pickString(env, ["VITE_OPENAI_MODEL"]) ?? "text-embedding-3-small";

  const version =
    typeof __APP_VERSION__ === "string" && __APP_VERSION__.length > 0
      ? __APP_VERSION__
      : "0.0.0-dev";

  cached = {
    config: Object.freeze({
      version,
      environment: envRes.value,
      isProduction,
      logLevel: levelRes.value,
      embeddingProvider: providerRes.value,
      corpusDir,
      openaiBaseUrl,
      openaiModel,
    }),
    warnings,
  };
  return cached;
}

/** Convenience accessor for the frozen config object. */
export function getConfig(): AppConfig {
  return loadConfig().config;
}

/** Test/di hook: clears the memoized config so the next loadConfig() re-reads env. */
export function resetConfigCache(): void {
  cached = null;
}

/**
 * Strip credentials from a base URL before storing it in config:
 * keeps scheme://host[:port]/path, drops userinfo (`user:pass@host`) entirely.
 */
function sanitizeBaseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    return "https://api.openai.com/v1";
  }
}

/**
 * Runtime check for an OpenAI key WITHOUT ever reading it into client code.
 * Returns true only when a process-level key exists (Node/CLI context).
 * In a static browser deployment this is always false → Mock provider is used.
 */
export function hasServerOpenAIKey(): boolean {
  const proc = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
    .process;
  const key = proc?.env?.OPENAI_API_KEY;
  return typeof key === "string" && key.length > 0;
}
