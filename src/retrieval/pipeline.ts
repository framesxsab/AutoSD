import type { Chunk, Document, RetrievalResult } from "./types.js";
import { chunkDocument } from "./chunker.js";
import { BM25Index } from "./bm25.js";
import type { EmbeddingProvider } from "./embedder.js";
import { cosineSimilarity } from "./embedder.js";
import type { Reranker } from "./reranker.js";

export type PipelineOptions = {
  readonly chunkSize?: number;
  readonly overlap?: number;
  readonly topK?: number;
  readonly bm25K1?: number;
  readonly bm25B?: number;
  readonly rrfK?: number;
  readonly vectorWeight?: number;
  readonly bm25Weight?: number;
};

export class RetrievalPipeline {
  private chunks: Chunk[] = [];
  private chunkEmbeddings = new Map<string, number[]>();
  private bm25: BM25Index;
  private reranker?: Reranker;
  private opts: Required<PipelineOptions>;

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

  async ingest(docs: Document[]): Promise<Chunk[]> {
    for (const doc of docs) {
      const docChunks = chunkDocument(doc, {
        chunkSize: this.opts.chunkSize,
        overlap: this.opts.overlap,
      });
      for (const c of docChunks) {
        this.chunks.push(c);
        this.bm25.addChunk(c);
        const vec = await this.provider.embed(c.content);
        this.chunkEmbeddings.set(c.id, vec);
      }
    }
    return this.chunks.slice();
  }

  clear(): void {
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

  private async vectorSearch(query: string, topK: number): Promise<RetrievalResult[]> {
    if (this.chunks.length === 0) return [];
    const qVec = await this.provider.embed(query);
    const scored: RetrievalResult[] = this.chunks.map(c => {
      const vec = this.chunkEmbeddings.get(c.id)!;
      const score = cosineSimilarity(qVec, vec);
      return { chunk: c, score, source: "vector" as const };
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
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

  async search(query: string, topK?: number): Promise<RetrievalResult[]> {
    const k = topK ?? this.opts.topK;
    const bm25Results = this.bm25.search(query, k * 2);
    const vectorResults = await this.vectorSearch(query, k * 2);
    let merged = this.hybridMerge(bm25Results, vectorResults, k * 2);
    if (this.reranker) {
      merged = await this.reranker.rerank(query, merged, k);
    } else {
      merged = merged.slice(0, k);
    }
    return merged;
  }
}
