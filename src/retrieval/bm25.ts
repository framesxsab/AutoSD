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
  private chunks: Chunk[] = [];
  private docTokens: Map<string, string[]> = new Map();
  private docLengths: Map<string, number> = new Map();
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
    const tokens = tokenize(chunk.content);
    this.chunks.push(chunk);
    this.docTokens.set(chunk.id, tokens);
    this.docLengths.set(chunk.id, tokens.length);

    const seen = new Set<string>();
    for (const t of tokens) {
      if (!seen.has(t)) {
        seen.add(t);
        this.docFreq.set(t, (this.docFreq.get(t) ?? 0) + 1);
        if (!this.inverted.has(t)) this.inverted.set(t, new Set());
        this.inverted.get(t)!.add(chunk.id);
      }
    }
    this.recalcAvgLen();
  }

  removeChunk(chunkId: string): void {
    this.chunks = this.chunks.filter(c => c.id !== chunkId);
    const tokens = this.docTokens.get(chunkId) ?? [];
    // Decrement df for tokens unique to this doc
    const seen = new Set(tokens);
    for (const t of seen) {
      const df = (this.docFreq.get(t) ?? 1) - 1;
      if (df <= 0) {
        this.docFreq.delete(t);
        this.inverted.delete(t);
      } else {
        this.docFreq.set(t, df);
        this.inverted.get(t)?.delete(chunkId);
      }
    }
    this.docTokens.delete(chunkId);
    this.docLengths.delete(chunkId);
    this.recalcAvgLen();
  }

  size(): number {
    return this.chunks.length;
  }

  search(query: string, topK = 10): { chunk: Chunk; score: number }[] {
    const qTokens = tokenize(query);
    if (qTokens.length === 0 || this.chunks.length === 0) return [];

    const scores = new Map<string, number>();
    const N = this.chunks.length;

    for (const qt of qTokens) {
      const df = this.docFreq.get(qt);
      if (!df) continue;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      const posting = this.inverted.get(qt);
      if (!posting) continue;
      for (const chunkId of posting) {
        const tf = this.docTokens.get(chunkId)!.filter(t => t === qt).length;
        const dl = this.docLengths.get(chunkId)!;
        const norm = 1 - this.b + this.b * (dl / (this.avgLen || 1));
        const score = idf * ((tf * (this.k1 + 1)) / (tf + this.k1 * norm));
        scores.set(chunkId, (scores.get(chunkId) ?? 0) + score);
      }
    }

    const chunkMap = new Map(this.chunks.map(c => [c.id, c]));
    return [...scores.entries()]
      .map(([id, score]) => ({ chunk: chunkMap.get(id)!, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  clear(): void {
    this.chunks = [];
    this.docTokens.clear();
    this.docLengths.clear();
    this.docFreq.clear();
    this.inverted.clear();
    this.avgLen = 0;
  }

  private recalcAvgLen(): void {
    if (this.docLengths.size === 0) {
      this.avgLen = 0;
      return;
    }
    let total = 0;
    for (const len of this.docLengths.values()) total += len;
    this.avgLen = total / this.docLengths.size;
  }
}
