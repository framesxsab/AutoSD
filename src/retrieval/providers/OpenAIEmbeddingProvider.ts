import type { EmbeddingProvider } from "../embedder.js";
import { truncate } from "../../utils/sanitize.js";
import { redact, registerSecret } from "../../app/logger.js";

export const DEFAULT_OPENAI_RATE_LIMIT_PER_MIN = 30;
export const DEFAULT_OPENAI_MAX_BATCH_SIZE = 64;
export const DEFAULT_OPENAI_MAX_INPUT_CHARS = 8_000;
export const DEFAULT_OPENAI_TIMEOUT_MS = 15_000;

/**
 * OpenAIEmbeddingProvider — calls an OpenAI-compatible embeddings endpoint.
 *
 * Two wiring modes:
 *  - Keyed (server-side): apiKey comes from constructor/process env
 *    (`OPENAI_API_KEY`, never import.meta.env). Authorization header sent.
 *  - Keyless (browser-endpoint): baseUrl points at a PUBLIC, pre-authorized
 *    gateway validated by config.ts; no secret exists client-side and no
 *    Authorization header is sent.
 * Falls back to error if unconfigured; pipeline should DI-swap to Mock/Local.
 *
 * Security:
 *  - The API key is stored in a true ECMAScript private field (`#apiKey`) so it
 *    cannot be read or enumerated from `window.__AUTOSD__` or provider instances.
 *  - Non-empty keys are registered with `registerSecret()` so even non-`sk-`
 *    tokens are redacted across logs, diagnostics, and error bodies.
 *  - Enforces a sliding-window rate limit, max batch size, max input length,
 *    and request timeout to prevent paid-API abuse / Denial of Wallet.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id = "openai";
  readonly model: string;
  readonly dimensions: number;
  #apiKey: string;
  private requestTimestamps: number[] = [];

  constructor(
    model = "text-embedding-3-small",
    dimensions = 1536,
    apiKey = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env
      ?.OPENAI_API_KEY ?? "",
    private baseUrl = "https://api.openai.com/v1",
    private keyless = false,
    private rateLimitPerMin = DEFAULT_OPENAI_RATE_LIMIT_PER_MIN,
    private maxBatchSize = DEFAULT_OPENAI_MAX_BATCH_SIZE,
  ) {
    this.model = model;
    this.dimensions = dimensions;
    this.#apiKey = apiKey;
    if (this.#apiKey.length >= 4) {
      registerSecret(this.#apiKey);
    }
  }

  isConfigured(): boolean {
    return this.keyless || this.#apiKey.length > 0;
  }

  private enforceRateLimit(): void {
    if (this.rateLimitPerMin <= 0) return;
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter(t => now - t < 60_000);
    if (this.requestTimestamps.length >= this.rateLimitPerMin) {
      throw new Error(
        `OpenAIEmbeddingProvider: rate limit exceeded (${this.rateLimitPerMin} requests/min)`,
      );
    }
    this.requestTimestamps.push(now);
  }

  async embed(text: string): Promise<number[]> {
    const res = await this.embedMany([text]);
    return res[0];
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    if (!this.isConfigured()) {
      throw new Error("OpenAIEmbeddingProvider: OPENAI_API_KEY not set");
    }
    if (texts.length === 0) return [];
    if (texts.length > this.maxBatchSize) {
      throw new Error(
        `OpenAIEmbeddingProvider: batch size ${texts.length} exceeds limit of ${this.maxBatchSize}`,
      );
    }
    this.enforceRateLimit();

    const boundedInputs = texts.map(t =>
      t.length > DEFAULT_OPENAI_MAX_INPUT_CHARS ? t.slice(0, DEFAULT_OPENAI_MAX_INPUT_CHARS) : t,
    );
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.#apiKey.length > 0) headers.Authorization = `Bearer ${this.#apiKey}`;

    const isSameOrigin =
      typeof window !== "undefined" &&
      typeof window.location?.origin === "string" &&
      window.location.origin.length > 0 &&
      this.baseUrl.startsWith(window.location.origin);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_OPENAI_TIMEOUT_MS);
    try {
      const resp = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers,
        ...(isSameOrigin ? { credentials: "same-origin" as const } : {}),
        body: JSON.stringify({ model: this.model, input: boundedInputs }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        // Sanitize: status code only + truncated body with registered & sk- secrets stripped.
        const rawBody = await resp.text().catch(() => "");
        const body = redact(rawBody).replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
        throw new Error(`OpenAI embeddings failed ${resp.status}: ${truncate(body, 300)}`);
      }
      const json = (await resp.json()) as { data: { embedding: number[] }[] };
      return json.data.map(d => d.embedding);
    } finally {
      clearTimeout(timer);
    }
  }
}
