import type { RetrievalResult } from "./types.js";
import { cosineSimilarity } from "./embedder.js";
import type { EmbeddingProvider } from "./embedder.js";

export interface Reranker {
  rerank(query: string, results: RetrievalResult[], topK?: number): Promise<RetrievalResult[]>;
}

/**
 * EmbeddingReranker — reranks using cosine similarity of query vs chunk embeddings.
 * Requires provider; falls back to original order if embeddings missing.
 */
export class EmbeddingReranker implements Reranker {
  constructor(private provider: EmbeddingProvider) {}

  async rerank(query: string, results: RetrievalResult[], topK = 10): Promise<RetrievalResult[]> {
    if (results.length === 0) return [];
    const queryVec = await this.provider.embed(query);

    // We need chunk embeddings; if results already have hybrid scores, we recompute
    // vector similarity from scratch using provider as ground truth for rerank.
    const scored = await Promise.all(
      results.map(async r => {
        const chunkVec = await this.provider.embed(r.chunk.content);
        const sim = cosineSimilarity(queryVec, chunkVec);
        return {
          ...r,
          score: sim,
          source: "rerank" as const,
          details: { ...r.details, rerankScore: sim },
        };
      }),
    );

    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}

/**
 * LexicalReranker — cheap reranker that upweights exact term matches.
 * Useful when no embedding provider is desired for rerank stage.
 */
export class LexicalReranker implements Reranker {
  async rerank(query: string, results: RetrievalResult[], topK = 10): Promise<RetrievalResult[]> {
    const qTerms = query.toLowerCase().split(/\W+/).filter(Boolean);
    const scored = results.map(r => {
      const content = r.chunk.content.toLowerCase();
      let hits = 0;
      for (const t of qTerms) if (content.includes(t)) hits++;
      const boost = qTerms.length === 0 ? 0 : hits / qTerms.length;
      return {
        ...r,
        score: r.score * (1 + boost),
        source: "rerank" as const,
        details: { ...r.details, lexicalBoost: boost },
      };
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}
