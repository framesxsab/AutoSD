import { describe, it, expect } from "vitest";
import { chunkDocument } from "../../src/retrieval/chunker.js";
import { BM25Index } from "../../src/retrieval/bm25.js";
import { SnapshotIndex } from "../../src/retrieval/snapshot.js";
import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";

describe("coverage boost for 95% branch", () => {
  it("chunker overlap larger than chunk triggers start<0 guard", () => {
    const content = "a".repeat(500);
    const chunks = chunkDocument(
      { id: "d1", content },
      { chunkSize: 100, overlap: 150, minChunkSize: 1 },
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].start).toBe(0);
  });

  it("chunker handles minChunkSize skip and final chunk", () => {
    const content =
      "   \n".repeat(3) + "valid chunk content here that is sufficiently long for testing";
    const chunks = chunkDocument(
      { id: "d1", content },
      { chunkSize: 10, overlap: 2, minChunkSize: 20 },
    );
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[chunks.length - 1].content.length).toBeGreaterThan(0);
  });

  it("BM25 handles single doc and empty posting", async () => {
    const idx = new BM25Index();
    idx.addChunks([
      { id: "d1#0", documentId: "d1", content: "hello", start: 0, end: 5, hash: "h" },
    ]);
    expect(idx.search("hello")).toHaveLength(1);
    expect(idx.search("missing")).toHaveLength(0);
    idx.addChunks([
      { id: "d1#1", documentId: "d1", content: "hello again", start: 0, end: 11, hash: "h2" },
    ]);
    expect(idx.search("hello")).toHaveLength(2);
  });

  it("Snapshot loadFromFile malformed with neither format", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autosd-branch-"));
    const file = join(dir, "bad.json");
    await writeFile(file, JSON.stringify({ foo: "bar" }), "utf8");
    const idx = new SnapshotIndex();
    expect(await idx.loadFromFile(file)).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  it("Snapshot index with empty docs", async () => {
    const idx = new SnapshotIndex();
    const r = await idx.index([]);
    expect(r.manifest.documentCount).toBe(0);
    expect(r.manifest.chunkCount).toBe(0);
  });
});
