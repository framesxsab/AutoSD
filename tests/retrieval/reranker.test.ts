import { describe, it, expect } from "vitest";
import { EmbeddingReranker, LexicalReranker } from "../../src/retrieval/reranker.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";

function mkResult(id: string, content: string, score: number) {
  return {
    chunk: { id, documentId: id.split("#")[0], content, start: 0, end: content.length, hash: "h" },
    score,
    source: "hybrid" as const,
  };
}

describe("EmbeddingReranker", () => {
  it("reranks by cosine similarity", async () => {
    const provider = new MockEmbeddingProvider();
    const reranker = new EmbeddingReranker(provider);
    const results = [
      mkResult("d1#0", "braille display tactile device", 0.5),
      mkResult("d2#0", "cooking pasta recipe", 0.9),
    ];
    const ranked = await reranker.rerank("braille display", results, 2);
    expect(ranked).toHaveLength(2);
    // braille query should rank braille doc higher despite lower initial score
    expect(ranked[0].chunk.id).toBe("d1#0");
    expect(ranked[0].source).toBe("rerank");
    expect(ranked[0].details?.rerankScore).toBeDefined();
  });

  it("empty results returns empty", async () => {
    const r = new EmbeddingReranker(new MockEmbeddingProvider());
    expect(await r.rerank("q", [])).toEqual([]);
  });
});

describe("LexicalReranker", () => {
  it("boosts exact term matches", async () => {
    const r = new LexicalReranker();
    const results = [
      mkResult("d1#0", "haptic tactile braille", 1),
      mkResult("d2#0", "random text here", 1),
    ];
    const ranked = await r.rerank("haptic braille", results, 2);
    expect(ranked[0].chunk.id).toBe("d1#0");
    expect(ranked[0].details?.lexicalBoost).toBeGreaterThan(0);
  });

  it("empty query handled", async () => {
    const r = new LexicalReranker();
    const results = [mkResult("d1#0", "hello", 1)];
    const ranked = await r.rerank("", results, 1);
    expect(ranked[0].score).toBe(1);
  });

  it("empty results returns empty", async () => {
    const r = new LexicalReranker();
    expect(await r.rerank("q", [])).toEqual([]);
  });
});
