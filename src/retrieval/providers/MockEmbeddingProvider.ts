import type { EmbeddingProvider } from "../embedder.js";

/**
 * MockEmbeddingProvider — deterministic, no network, CI-required.
 * Uses a seeded hash → pseudo-random normalized vector. NOT fabricated:
 * vectors are reproducible and derived from content.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly id = "mock";
  readonly model = "mock-384";
  readonly dimensions = 384;

  private hashToVector(text: string): number[] {
    // FNV-1a seeded PRNG → normalized vector
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const vec: number[] = [];
    let seed = h >>> 0;
    for (let i = 0; i < this.dimensions; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      // Map to [-1, 1]
      vec.push((seed / 0xffffffff) * 2 - 1);
    }
    const mag = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    return vec.map(x => x / mag);
  }

  async embed(text: string): Promise<number[]> {
    return this.hashToVector(text);
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}
