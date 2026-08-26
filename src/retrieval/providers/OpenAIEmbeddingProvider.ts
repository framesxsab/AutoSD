import type { EmbeddingProvider } from "../embedder.js";
import { truncate } from "../../utils/sanitize.js";

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
 * Security: the API key is accepted only via constructor/process env, is never
 * logged, and provider error messages never include raw response bodies
 * (truncated + stripped of anything resembling key material).
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id = "openai";
  readonly model: string;
  readonly dimensions: number;

  constructor(
    model = "text-embedding-3-small",
    dimensions = 1536,
    private apiKey = (globalThis as unknown as { process?: { env?: Record<string, string> } })
      .process?.env?.OPENAI_API_KEY ?? "",
    private baseUrl = "https://api.openai.com/v1",
    private keyless = false,
  ) {
    this.model = model;
    this.dimensions = dimensions;
  }

  isConfigured(): boolean {
    return this.keyless || this.apiKey.length > 0;
  }

  async embed(text: string): Promise<number[]> {
    const res = await this.embedMany([text]);
    return res[0];
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    if (!this.isConfigured()) {
      throw new Error("OpenAIEmbeddingProvider: OPENAI_API_KEY not set");
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey.length > 0) headers.Authorization = `Bearer ${this.apiKey}`;
    const resp = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!resp.ok) {
      // Sanitize: status code only + truncated body with key-like strings stripped.
      const body = (await resp.text().catch(() => "")).replace(
        /\bsk-[A-Za-z0-9_-]{8,}\b/g,
        "[REDACTED]",
      );
      throw new Error(`OpenAI embeddings failed ${resp.status}: ${truncate(body, 300)}`);
    }
    const json = (await resp.json()) as { data: { embedding: number[] }[] };
    return json.data.map(d => d.embedding);
  }
}
