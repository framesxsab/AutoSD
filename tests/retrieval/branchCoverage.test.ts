import { describe, it, expect } from "vitest";
import { chunkDocument } from "../../src/retrieval/chunker.js";
import { BM25Index } from "../../src/retrieval/bm25.js";
import { RetrievalPipeline } from "../../src/retrieval/pipeline.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";
import { SnapshotIndex } from "../../src/retrieval/snapshot.js";
import { LocalEmbeddingProvider } from "../../src/retrieval/providers/LocalEmbeddingProvider.js";

describe("branch coverage boost", () => {
  it("chunker trims short chunk less than minChunkSize", () => {
    const content = "hi\n".repeat(5) + "a".repeat(1000);
    const chunks = chunkDocument(
      { id: "d1", content },
      { chunkSize: 100, overlap: 10, minChunkSize: 50 },
    );
    expect(chunks.length).toBeGreaterThan(0);
    // Force a whitespace-only chunk to be skipped
    const white = "   \n   \n   ";
    const c2 = chunkDocument(
      { id: "d2", content: white + "valid content here that is long enough" },
      { chunkSize: 20, overlap: 5, minChunkSize: 10 },
    );
    expect(c2.length).toBeGreaterThan(0);
  });

  it("BM25 recalcAvgLen empty after remove last", () => {
    const idx = new BM25Index();
    idx.addChunks([
      { id: "d1#0", documentId: "d1", content: "hello world", start: 0, end: 11, hash: "h" },
    ]);
    idx.removeChunk("d1#0");
    expect(idx.size()).toBe(0);
    expect(idx.search("hello")).toEqual([]);
    idx.clear();
    expect(idx.size()).toBe(0);
  });

  it("BM25 posting missing branch", () => {
    const idx = new BM25Index();
    idx.addChunks([
      { id: "d1#0", documentId: "d1", content: "alpha beta", start: 0, end: 10, hash: "h" },
    ]);
    // Query term not in vocab -> df missing -> continue
    expect(idx.search("zeta")).toEqual([]);
    // Add term, then remove, then search again -> inverted missing
    idx.removeChunk("d1#0");
    expect(idx.search("alpha")).toEqual([]);
  });

  it("pipeline handles empty vector search and hybrid with single source", async () => {
    const pipe = new RetrievalPipeline(new MockEmbeddingProvider(), { topK: 2 });
    expect(await pipe.search("anything")).toEqual([]);
    await pipe.ingest([{ id: "d1", content: "unique content" }]);
    const res = await pipe.search("unique");
    expect(res.length).toBe(1);
    pipe.clear();
    expect(pipe.getChunks()).toHaveLength(0);
  });

  it("snapshot nextVersion edge", async () => {
    const idx = new SnapshotIndex();
    // Cover snapshot snapshotHash empty and nextVersion undefined
    expect(idx.snapshotHash()).toBeDefined();
    await idx.index([{ id: "d1", content: "a" }]);
    expect(idx.getVersion()).toBe("1.0.0");
    await idx.index([{ id: "d1", content: "a" }]);
    expect(idx.getVersion()).toBe("1.0.1");
  });

  it("LocalEmbeddingProvider fallback detection", async () => {
    const p = new LocalEmbeddingProvider();
    const vec = await p.embed("hello");
    expect(vec.length).toBe(384);
    expect(p.isFallback()).toBe(true);
    const many = await p.embedMany(["a", "b"]);
    expect(many).toHaveLength(2);
  });
});
