import { normalizeVector } from "../embedder.js";
import type { EmbeddingProvider } from "../embedder.js";

function fnv1a32(input: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

const FNV_OFFSET = 2166136261;
const SIGN_SEED = (FNV_OFFSET ^ 0x9e3779b9) >>> 0;

/**
 * LexicalHashEmbeddingProvider — deterministic, offline, signal-bearing
 * feature-hash embedder (word tokens + padded character 3-grams).
 */
export class LexicalHashEmbeddingProvider implements EmbeddingProvider {
  readonly id = "lexical-hash";
  readonly model = "lexical-hash-384";
  readonly dimensions: number;

  constructor(dimensions = 384) {
    this.dimensions = dimensions;
  }

  private featurize(text: string): number[] {
    const tokens = text
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter(Boolean);

    const counts = new Map<string, number>();
    for (const t of tokens) {
      const wordKey = `w:${t}`;
      counts.set(wordKey, (counts.get(wordKey) ?? 0) + 1);

      const padded = `^${t}$`;
      if (padded.length >= 3) {
        for (let i = 0; i <= padded.length - 3; i++) {
          const gramKey = `g:${padded.slice(i, i + 3)}`;
          counts.set(gramKey, (counts.get(gramKey) ?? 0) + 0.5);
        }
      }
    }

    const vec = new Array<number>(this.dimensions).fill(0);
    for (const [feat, count] of counts) {
      const weight = count > 0 ? 1 + Math.log(count) : count;
      const bucket = (fnv1a32(feat, FNV_OFFSET) >>> 0) % this.dimensions;
      const sign = (fnv1a32(feat, SIGN_SEED) & 1) === 0 ? 1 : -1;
      vec[bucket] += sign * weight;
    }

    return normalizeVector(vec);
  }

  async embed(text: string): Promise<number[]> {
    return this.featurize(text);
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}
