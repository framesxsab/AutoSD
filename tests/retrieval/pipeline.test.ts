import { describe, it, expect } from "vitest";
import { RetrievalPipeline } from "../../src/retrieval/pipeline.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";
import { LexicalReranker } from "../../src/retrieval/reranker.js";

describe("RetrievalPipeline", () => {
  it("ingest and search hybrid", async () => {
    const pipe = new RetrievalPipeline(new MockEmbeddingProvider(), { topK: 3 });
    await pipe.ingest([
      { id: "d1", content: "braille display for blind users haptic tactile" },
      { id: "d2", content: "cooking pasta recipe ingredients" },
      { id: "d3", content: "haptic feedback device tactile display" },
    ]);
    expect(pipe.getChunks().length).toBeGreaterThanOrEqual(3);
    const res = await pipe.search("braille tactile", 2);
    expect(res).toHaveLength(2);
    expect(res.every(r => r.source === "hybrid")).toBe(true);
    // braille query should prefer d1/d3 over d2
    expect(res.map(r => r.chunk.documentId)).not.toContain("d2");
  });

  it("hybrid merge RRF: same doc in both lists gets boosted", async () => {
    const pipe = new RetrievalPipeline(new MockEmbeddingProvider(), { topK: 2, rrfK: 60 });
    await pipe.ingest([{ id: "d1", content: "alpha beta gamma" }]);
    const res = await pipe.search("alpha beta");
    expect(res[0].chunk.documentId).toBe("d1");
    expect(res[0].details).toBeDefined();
  });

  it("vectorWeight/bm25Weight tuning", async () => {
    const p1 = new RetrievalPipeline(new MockEmbeddingProvider(), {
      topK: 2,
      vectorWeight: 0,
      bm25Weight: 1,
    });
    await p1.ingest([{ id: "d1", content: "unique_term_xyz" }]);
    const r1 = await p1.search("unique_term_xyz");
    expect(r1.length).toBe(1);
  });

  it("clear resets", async () => {
    const pipe = new RetrievalPipeline(new MockEmbeddingProvider());
    await pipe.ingest([{ id: "d1", content: "hello" }]);
    pipe.clear();
    expect(pipe.getChunks()).toHaveLength(0);
    expect(await pipe.search("hello")).toHaveLength(0);
  });

  it("addDocument/removeDocument incremental", async () => {
    const pipe = new RetrievalPipeline(new MockEmbeddingProvider());
    await pipe.addDocument({ id: "d1", content: "first document" });
    await pipe.addDocument({ id: "d2", content: "second document" });
    expect(pipe.getChunks().length).toBe(2);
    pipe.removeDocument("d1");
    expect(pipe.getChunks().every(c => c.documentId !== "d1")).toBe(true);
    const res = await pipe.search("second");
    expect(res[0].chunk.documentId).toBe("d2");
  });

  it("reranker integration", async () => {
    const pipe = new RetrievalPipeline(
      new MockEmbeddingProvider(),
      { topK: 2 },
      new LexicalReranker(),
    );
    await pipe.ingest([
      { id: "d1", content: "apple banana" },
      { id: "d2", content: "orange grape" },
    ]);
    const res = await pipe.search("apple");
    expect(res[0].source).toBe("rerank");
  });

  it("custom bm25 params", async () => {
    const pipe = new RetrievalPipeline(new MockEmbeddingProvider(), { bm25K1: 2, bm25B: 0.5 });
    await pipe.ingest([{ id: "d1", content: "hello hello world" }]);
    expect((await pipe.search("hello")).length).toBe(1);
  });

  it("empty search returns empty", async () => {
    const pipe = new RetrievalPipeline(new MockEmbeddingProvider());
    expect(await pipe.search("anything")).toEqual([]);
  });
});
