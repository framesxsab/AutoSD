/**
 * config.ts — validated application configuration.
 *
 * Security contract:
 *  - Reads ONLY non-secret, VITE_-prefixed variables (public by design) plus
 *    the current build mode. The env map is structurally filtered to VITE_*
 *    names, so a secret such as OPENAI_API_KEY can never be picked up here —
 *    it lives in the process environment only and never enters the client
 *    bundle (see docs/SECURITY_ARCHITECTURE.md §3.8).
 *  - Validation never throws: invalid values fall back to safe defaults and a
 *    warning is recorded (variable NAME only — never values).
 *  - OpenAI configuration resolves to exactly one of three modes:
 *      1. "none"             — no external AI; providers fall back to Mock.
 *      2. "browser-endpoint" — VITE_OPENAI_BASE_URL points at a PUBLIC,
 *                              pre-authorized endpoint (https in production,
 *                              no credential query params, no embedded key
 *                              material, not the official api.openai.com host,
 *                              which always requires a secret).
 *      3. "server-side"      — OPENAI_API_KEY exists in process.env (Node/CLI/
 *                              server context). Browsers never see the key;
 *                              they call your own server endpoint instead.
 *  - The resulting object is deeply frozen.
 */

/** Injected at build time by Vite `define` (see vite.config.ts). */
declare const __APP_VERSION__: string | undefined;

export type Environment = "development" | "production" | "test";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type EmbeddingProviderId = "mock" | "local" | "openai";

/**
 * How external OpenAI-compatible embeddings are wired (v1.0):
 *  - "none": no external AI configured → Mock provider everywhere.
 *  - "browser-endpoint": VITE_OPENAI_BASE_URL is a validated PUBLIC endpoint
 *    that accepts requests WITHOUT a client-side secret.
 *  - "server-side": OPENAI_API_KEY exists in process.env only; the browser
 *    never holds a key and talks to your own server endpoint instead.
 */
export type OpenAIConfigMode = "none" | "browser-endpoint" | "server-side";

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
  /** Resolved OpenAI wiring mode (none | browser-endpoint | server-side). */
  readonly openaiMode: OpenAIConfigMode;
  /** Corpus directory used for watcher + persistence defaults. */
  readonly corpusDir: string;
  /** OpenAI-compatible endpoint (non-secret; validated, credentials stripped). */
  readonly openaiBaseUrl: string;
  /** OpenAI embedding model id (non-secret). */
  readonly openaiModel: string;
};

type RawEnv = Record<string, string | boolean | undefined>;

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];
const PROVIDERS: readonly EmbeddingProviderId[] = ["mock", "local", "openai"];
const ENVIRONMENTS: readonly Environment[] = ["development", "production", "test"];
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

/**
 * Hosts that always require an API key. They can never serve as keyless
 * browser endpoints, so pointing VITE_OPENAI_BASE_URL at them does NOT
 * activate "browser-endpoint" mode.
 */
const KEY_REQUIRED_HOSTS: readonly string[] = ["api.openai.com"];

/** Query-parameter names that indicate credential material embedded in a URL. */
function hasCredentialQueryParam(search: string): boolean {
  if (!search) return false;
  const names = [...new URLSearchParams(search).keys()].map(k => k.toLowerCase());
  return names.some(
    n =>
      n.includes("apikey") ||
      n.includes("api_key") ||
      n.includes("api-key") ||
      n === "key" ||
      n.endsWith("-key") ||
      n.endsWith("_key") ||
      n === "token" ||
      n.endsWith("-token") ||
      n.endsWith("_token") ||
      n.includes("secret") ||
      n.includes("password") ||
      n.includes("passwd") ||
      n.includes("credential") ||
      n === "sig" ||
      n === "signature",
  );
}

/** OpenAI-style secret key material (`sk-…`) embedded anywhere in a URL string. */
const SECRET_IN_URL_PATTERN = /\bsk-[A-Za-z0-9_-]{8,}\b/;

/** Variable names that must never be prefixed with VITE_ (they would go public). */
const SECRET_VAR_NAME_PATTERN = /(API[-_]?KEY|APIKEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)/i;

type BaseUrlCheck = { ok: true; value: string; hadCredentials: boolean } | { ok: false };

/**
 * Validate a candidate PUBLIC base URL for browser use:
 *  - must parse as an absolute http(s) URL;
 *  - https required in production (http tolerated outside production);
 *  - credential-bearing query params (api_key/token/…) → rejected;
 *  - embedded `sk-…` key material anywhere → rejected;
 *  - userinfo (`user:pass@host`) is stripped (kept for compatibility) but
 *    flagged so operators notice credentials were about to ship.
 */
function validatePublicBaseUrl(raw: string, isProduction: boolean): BaseUrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false };
  if (isProduction && url.protocol !== "https:") return { ok: false };
  if (SECRET_IN_URL_PATTERN.test(raw)) return { ok: false };
  if (hasCredentialQueryParam(url.search)) return { ok: false };
  const hadCredentials = url.username.length > 0 || url.password.length > 0;
  url.username = "";
  url.password = "";
  const path = url.pathname.replace(/\/+$/, "");
  return { ok: true, value: `${url.protocol}//${url.host}${path}`, hadCredentials };
}

function readRawEnv(): { env: RawEnv; mode?: string } {
  const env: RawEnv = {};
  // Browser/Vite: import.meta.env (guarded — may be absent in tests/node).
  // STRUCTURAL GUARD: only VITE_-prefixed names are copied, so non-public
  // variables (OPENAI_API_KEY included) can never reach config parsing.
  try {
    const meta = import.meta as unknown as { env?: RawEnv };
    if (meta && typeof meta === "object" && meta.env && typeof meta.env === "object") {
      for (const [k, v] of Object.entries(meta.env)) {
        if (k.startsWith("VITE_") && (typeof v === "string" || typeof v === "boolean")) env[k] = v;
      }
    }
  } catch {
    /* import.meta unavailable — ignore */
  }
  // Node/test fallback: process.env fills gaps ONLY if not already set
  // (same VITE_ filter applies).
  const proc = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
    .process;
  if (proc?.env) {
    for (const [k, v] of Object.entries(proc.env)) {
      if (k.startsWith("VITE_") && env[k] === undefined && typeof v === "string") env[k] = v;
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

  // Flag VITE_-prefixed variables whose NAME looks like a secret: anything
  // prefixed VITE_ is public by design, so this is always a misconfiguration.
  for (const k of Object.keys(env)) {
    if (k.startsWith("VITE_") && SECRET_VAR_NAME_PATTERN.test(k)) warnings.push(k);
  }

  const rawBaseUrl = pickString(env, ["VITE_OPENAI_BASE_URL"]);
  let openaiBaseUrl = DEFAULT_OPENAI_BASE_URL;
  let browserEndpointUsable = false;
  if (rawBaseUrl !== undefined) {
    const check = validatePublicBaseUrl(rawBaseUrl, isProduction);
    if (check.ok) {
      openaiBaseUrl = check.value;
      if (check.hadCredentials) warnings.push("VITE_OPENAI_BASE_URL");
      try {
        const host = new URL(openaiBaseUrl).hostname.toLowerCase();
        browserEndpointUsable = !KEY_REQUIRED_HOSTS.includes(host);
      } catch {
        browserEndpointUsable = false;
      }
    } else {
      warnings.push("VITE_OPENAI_BASE_URL");
    }
  }
  const openaiModel = pickString(env, ["VITE_OPENAI_MODEL"]) ?? "text-embedding-3-small";

  // Mode precedence: an explicitly configured, validated public endpoint wins
  // (it is the deployment's declared client-side wiring); otherwise a
  // process-level key enables server-side use; otherwise no external AI.
  const openaiMode: OpenAIConfigMode = browserEndpointUsable
    ? "browser-endpoint"
    : hasServerOpenAIKey()
      ? "server-side"
      : "none";

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
      openaiMode,
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
 * Runtime check for a server-side OpenAI key WITHOUT ever reading it into
 * client code. Returns true only when a process-level key exists
 * (Node/CLI/server context). In a static browser deployment this is always
 * false → config resolves to "none" → Mock provider is used.
 */
export function hasServerOpenAIKey(): boolean {
  const proc = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
    .process;
  const key = proc?.env?.OPENAI_API_KEY;
  return typeof key === "string" && key.length > 0;
}
