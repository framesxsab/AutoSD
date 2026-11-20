import type { Chunk } from "./types.js";

export type BM25Options = {
  readonly k1?: number;
  readonly b?: number;
};

const DEFAULT_K1 = 1.2;
const DEFAULT_B = 0.75;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(t => t.length > 0);
}

export class BM25Index {
  private k1: number;
  private b: number;
  private chunks: Map<string, Chunk> = new Map();
  private docTermFreqs: Map<string, Map<string, number>> = new Map();
  private docLengths: Map<string, number> = new Map();
  private totalDocLength = 0;
  private avgLen = 0;
  private docFreq: Map<string, number> = new Map();
  private inverted: Map<string, Set<string>> = new Map();

  constructor(opts: BM25Options = {}) {
    this.k1 = opts.k1 ?? DEFAULT_K1;
    this.b = opts.b ?? DEFAULT_B;
  }

  addChunks(chunks: Chunk[]): void {
    for (const c of chunks) this.addChunk(c);
  }

  addChunk(chunk: Chunk): void {
    if (this.chunks.has(chunk.id)) {
      this.removeChunk(chunk.id);
    }
    const tokens = tokenize(chunk.content);
    this.chunks.set(chunk.id, chunk);
    this.docLengths.set(chunk.id, tokens.length);
    this.totalDocLength += tokens.length;

    const tfMap = new Map<string, number>();
    for (const t of tokens) {
      tfMap.set(t, (tfMap.get(t) ?? 0) + 1);
    }
    this.docTermFreqs.set(chunk.id, tfMap);

    for (const t of tfMap.keys()) {
      this.docFreq.set(t, (this.docFreq.get(t) ?? 0) + 1);
      let posting = this.inverted.get(t);
      if (!posting) {
        posting = new Set();
        this.inverted.set(t, posting);
      }
      posting.add(chunk.id);
    }
    this.avgLen = this.totalDocLength / this.docLengths.size;
  }

  removeChunk(chunkId: string): void {
    const tfMap = this.docTermFreqs.get(chunkId);
    if (!tfMap) return;
    this.chunks.delete(chunkId);
    const len = this.docLengths.get(chunkId) ?? 0;
    this.docLengths.delete(chunkId);
    this.totalDocLength -= len;
    for (const t of tfMap.keys()) {
      const df = (this.docFreq.get(t) ?? 1) - 1;
      if (df <= 0) {
        this.docFreq.delete(t);
        this.inverted.delete(t);
      } else {
        this.docFreq.set(t, df);
        this.inverted.get(t)?.delete(chunkId);
      }
    }
    this.docTermFreqs.delete(chunkId);
    this.avgLen = this.docLengths.size === 0 ? 0 : this.totalDocLength / this.docLengths.size;
  }

  size(): number {
    return this.chunks.size;
  }

  search(query: string, topK = 10): { chunk: Chunk; score: number }[] {
    const qTokens = tokenize(query);
    if (qTokens.length === 0 || this.chunks.size === 0) return [];

    const scores = new Map<string, number>();
    const N = this.chunks.size;

    for (const qt of qTokens) {
      const df = this.docFreq.get(qt);
      if (!df) continue;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      const posting = this.inverted.get(qt);
      if (!posting) continue;
      for (const chunkId of posting) {
        const tf = this.docTermFreqs.get(chunkId)?.get(qt) ?? 0;
        const dl = this.docLengths.get(chunkId) ?? 0;
        const norm = 1 - this.b + this.b * (dl / (this.avgLen || 1));
        const score = idf * ((tf * (this.k1 + 1)) / (tf + this.k1 * norm));
        scores.set(chunkId, (scores.get(chunkId) ?? 0) + score);
      }
    }

    return [...scores.entries()]
      .map(([id, score]) => ({ chunk: this.chunks.get(id)!, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  clear(): void {
    this.chunks.clear();
    this.docTermFreqs.clear();
    this.docLengths.clear();
    this.totalDocLength = 0;
    this.docFreq.clear();
    this.inverted.clear();
    this.avgLen = 0;
  }
}
