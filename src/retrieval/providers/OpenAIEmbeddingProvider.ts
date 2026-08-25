import type { EmbeddingProvider } from "../embedder.js";
import { truncate } from "../../utils/sanitize.js";

/**
 * OpenAIEmbeddingProvider — calls OpenAI embeddings API when key present.
 * Falls back to error if no key; pipeline should DI-swap to Mock/Local.
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
  ) {
    this.model = model;
    this.dimensions = dimensions;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async embed(text: string): Promise<number[]> {
    const res = await this.embedMany([text]);
    return res[0];
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    if (!this.isConfigured()) {
      throw new Error("OpenAIEmbeddingProvider: OPENAI_API_KEY not set");
    }
    const resp = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
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
