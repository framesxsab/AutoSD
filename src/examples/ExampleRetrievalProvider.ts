import type { EmbeddingProvider } from "../retrieval/embedder.js";

/**
 * ExampleRetrievalProvider — a minimal, complete EmbeddingProvider.
 *
 * Deterministic hashed bag-of-words vectors: no network, no model download,
 * safe for tests and CI. Copy this file as a starting point for your own
 * provider. See docs/RESEARCH_GUIDE.md for DI wiring:
 *
 *   di.register(EMBEDDING_TOKEN, () => new ExampleRetrievalProvider());
 *   const wf = new ResearchWorkflow({ di });
 */
export class ExampleRetrievalProvider implements EmbeddingProvider {
  readonly id = "example";
  readonly model = "example-hash-64";
  readonly dimensions = 64;

  async embed(text: string): Promise<number[]> {
    const vec = new Array<number>(this.dimensions).fill(0);
    const tokens = text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);

    for (const token of tokens) {
      // FNV-1a over the token, same family as MockEmbeddingProvider.
      let h = 2166136261;
      for (let i = 0; i < token.length; i++) {
        h ^= token.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      // Spread each token across a few buckets so texts sharing vocabulary
      // land near each other in cosine space.
      for (let bucket = 0; bucket < 4; bucket++) {
        h = (h * 1664525 + 1013904223) >>> 0;
        vec[h % this.dimensions] += 1;
      }
    }

    const mag = Math.sqrt(vec.reduce((sum, x) => sum + x * x, 0));
    return mag === 0 ? vec : vec.map(x => x / mag);
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}
