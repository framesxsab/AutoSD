import type { Chunk, Document, RetrievalResult } from "./types.js";
import { chunkDocument } from "./chunker.js";
import { BM25Index } from "./bm25.js";
import type { EmbeddingProvider } from "./embedder.js";
import { cosineSimilarity } from "./embedder.js";
import type { Reranker } from "./reranker.js";

export type RetrievalMode = "hybrid" | "bm25" | "vector";

export type PipelineOptions = {
  readonly chunkSize?: number;
  readonly overlap?: number;
  readonly topK?: number;
  readonly bm25K1?: number;
  readonly bm25B?: number;
  readonly rrfK?: number;
  readonly vectorWeight?: number;
  readonly bm25Weight?: number;
  readonly mode?: RetrievalMode;
};

export type SearchOptions = {
  readonly topK?: number;
  readonly documentIds?: readonly string[];
  readonly mode?: RetrievalMode;
};

export class RetrievalPipeline {
  private chunks: Chunk[] = [];
  private chunkEmbeddings = new Map<string, number[]>();
  private bm25: BM25Index;
  private reranker?: Reranker;
  /** Bumped by clear(); lets in-flight ingests detect they are stale. */
  private generation = 0;
  private opts: {
    chunkSize: number;
    overlap: number;
    topK: number;
    bm25K1: number;
    bm25B: number;
    rrfK: number;
    vectorWeight: number;
    bm25Weight: number;
    mode: RetrievalMode;
  };

  constructor(
    private provider: EmbeddingProvider,
    opts: PipelineOptions = {},
    reranker?: Reranker,
  ) {
    this.opts = {
      chunkSize: opts.chunkSize ?? 800,
      overlap: opts.overlap ?? 120,
      topK: opts.topK ?? 5,
      bm25K1: opts.bm25K1 ?? 1.2,
      bm25B: opts.bm25B ?? 0.75,
      rrfK: opts.rrfK ?? 60,
      vectorWeight: opts.vectorWeight ?? 1,
      bm25Weight: opts.bm25Weight ?? 1,
      mode: opts.mode ?? "hybrid",
    };
    this.bm25 = new BM25Index({ k1: this.opts.bm25K1, b: this.opts.bm25B });
    this.reranker = reranker;
  }

  getChunks(): readonly Chunk[] {
    return this.chunks;
  }

  getBM25(): BM25Index {
    return this.bm25;
  }

  getMode(): RetrievalMode {
    return this.opts.mode;
  }

  setMode(mode: RetrievalMode): void {
    this.opts.mode = mode;
  }

  getReranker(): Reranker | undefined {
    return this.reranker;
  }

  setReranker(reranker: Reranker | undefined): void {
    this.reranker = reranker;
  }

  getOptions(): Readonly<Required<PipelineOptions>> {
    return { ...this.opts };
  }

  /**
   * Chunk + embed first, then commit synchronously. The commit step replaces
   * any existing chunks for the same document ids in one go, so overlapping
   * ingests can never leave duplicate chunks behind (last commit wins). If
   * clear() runs while embeddings are in flight, the stale batch is discarded
   * rather than resurrecting documents into a cleared index.
   */
  async ingest(docs: Document[]): Promise<Chunk[]> {
    const generation = this.generation;
    const latestByDoc = new Map<string, Document>();
    for (const doc of docs) latestByDoc.set(doc.id, doc);

    const newChunks: Chunk[] = [];
    for (const doc of latestByDoc.values()) {
      newChunks.push(
        ...chunkDocument(doc, { chunkSize: this.opts.chunkSize, overlap: this.opts.overlap }),
      );
    }

    const vectors: number[][] = [];
    if (newChunks.length > 0) {
      const batch =
        typeof this.provider.embedMany === "function"
          ? await this.provider.embedMany(newChunks.map(c => c.content))
          : await Promise.all(newChunks.map(c => this.provider.embed(c.content)));
      for (let i = 0; i < newChunks.length; i++) {
        vectors.push(batch[i] ?? (await this.provider.embed(newChunks[i].content)));
      }
    }

    if (generation !== this.generation) return this.chunks.slice();

    for (const docId of latestByDoc.keys()) this.removeDocument(docId);
    newChunks.forEach((c, i) => {
      this.chunks.push(c);
      this.bm25.addChunk(c);
      this.chunkEmbeddings.set(c.id, vectors[i]);
    });
    return this.chunks.slice();
  }

  clear(): void {
    this.generation++;
    this.chunks = [];
    this.chunkEmbeddings.clear();
    this.bm25.clear();
  }

  async addDocument(doc: Document): Promise<Chunk[]> {
    return this.ingest([doc]);
  }

  removeDocument(documentId: string): void {
    const toRemove = this.chunks.filter(c => c.documentId === documentId);
    for (const c of toRemove) {
      this.bm25.removeChunk(c.id);
      this.chunkEmbeddings.delete(c.id);
    }
    this.chunks = this.chunks.filter(c => c.documentId !== documentId);
  }

  private async vectorSearch(
    query: string,
    topK: number,
    docFilter?: Set<string>,
  ): Promise<RetrievalResult[]> {
    const candidates = docFilter
      ? this.chunks.filter(c => docFilter.has(c.documentId))
      : this.chunks;
    if (candidates.length === 0) return [];
    const qVec = await this.provider.embed(query);
    const scored: RetrievalResult[] = [];
    for (const c of candidates) {
      const vec = this.chunkEmbeddings.get(c.id);
      if (!vec) continue;
      const score = cosineSimilarity(qVec, vec);
      scored.push({ chunk: c, score, source: "vector" as const });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  private searchBm25Filtered(
    query: string,
    limit: number,
    docFilter?: Set<string>,
  ): { chunk: Chunk; score: number }[] {
    if (!docFilter) return this.bm25.search(query, limit);
    if (docFilter.size === 0 || this.chunks.length === 0) return [];
    return this.bm25
      .search(query, this.chunks.length)
      .filter(r => docFilter.has(r.chunk.documentId))
      .slice(0, limit);
  }

  private hybridMerge(
    bm25Results: { chunk: Chunk; score: number }[],
    vectorResults: RetrievalResult[],
    topK: number,
  ): RetrievalResult[] {
    // Reciprocal Rank Fusion
    const rrf = new Map<
      string,
      {
        chunk: Chunk;
        rrfScore: number;
        bm25Rank?: number;
        vectorRank?: number;
        bm25Score?: number;
        vectorScore?: number;
      }
    >();
    const k = this.opts.rrfK;

    bm25Results.forEach((r, idx) => {
      const rank = idx + 1;
      const prev = rrf.get(r.chunk.id) ?? { chunk: r.chunk, rrfScore: 0 };
      prev.rrfScore += this.opts.bm25Weight * (1 / (k + rank));
      prev.bm25Rank = rank;
      prev.bm25Score = r.score;
      rrf.set(r.chunk.id, prev);
    });

    vectorResults.forEach((r, idx) => {
      const rank = idx + 1;
      const prev = rrf.get(r.chunk.id) ?? { chunk: r.chunk, rrfScore: 0 };
      prev.rrfScore += this.opts.vectorWeight * (1 / (k + rank));
      prev.vectorRank = rank;
      prev.vectorScore = r.score;
      rrf.set(r.chunk.id, prev);
    });

    return [...rrf.values()]
      .map(v => ({
        chunk: v.chunk,
        score: v.rrfScore,
        source: "hybrid" as const,
        details: {
          bm25Rank: v.bm25Rank,
          vectorRank: v.vectorRank,
          bm25Score: v.bm25Score,
          vectorScore: v.vectorScore,
        },
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async search(query: string, topKOrOpts?: number | SearchOptions): Promise<RetrievalResult[]> {
    const searchOpts: SearchOptions =
      typeof topKOrOpts === "number" ? { topK: topKOrOpts } : (topKOrOpts ?? {});
    const k = searchOpts.topK ?? this.opts.topK;
    const mode = searchOpts.mode ?? this.opts.mode;
    const docFilter = searchOpts.documentIds ? new Set(searchOpts.documentIds) : undefined;
    if (docFilter && docFilter.size === 0) return [];

    const candidateLimit = this.reranker ? k * 2 : k;

    if (mode === "bm25") {
      const bm25Results: RetrievalResult[] = this.searchBm25Filtered(
        query,
        candidateLimit,
        docFilter,
      ).map((r, idx) => ({
        chunk: r.chunk,
        score: r.score,
        source: "bm25" as const,
        details: { bm25Rank: idx + 1, bm25Score: r.score },
      }));
      return this.reranker
        ? await this.reranker.rerank(query, bm25Results, k)
        : bm25Results.slice(0, k);
    }
    if (mode === "vector") {
      const vectorResults = await this.vectorSearch(query, candidateLimit, docFilter);
      return this.reranker
        ? await this.reranker.rerank(query, vectorResults, k)
        : vectorResults.slice(0, k);
    }
    const bm25Results = this.searchBm25Filtered(query, k * 2, docFilter);
    const vectorResults = await this.vectorSearch(query, k * 2, docFilter);
    let merged = this.hybridMerge(bm25Results, vectorResults, k * 2);
    if (this.reranker) {
      merged = await this.reranker.rerank(query, merged, k);
    } else {
      merged = merged.slice(0, k);
    }
    return merged;
  }
}
