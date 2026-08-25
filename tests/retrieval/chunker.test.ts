import { describe, it, expect } from "vitest";
import { chunkDocument, hashContent } from "../../src/retrieval/chunker.js";

describe("chunker", () => {
  it("hash is stable", () => {
    expect(hashContent("hello")).toBe(hashContent("hello"));
    expect(hashContent("hello")).not.toBe(hashContent("world"));
    expect(hashContent("hello").length).toBe(16);
  });

  it("short doc single chunk", () => {
    const chunks = chunkDocument({ id: "d1", content: "hello world" });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].id).toBe("d1#0");
    expect(chunks[0].start).toBe(0);
    expect(chunks[0].hash).toBeDefined();
  });

  it("empty content returns empty", () => {
    expect(chunkDocument({ id: "d1", content: "" })).toHaveLength(0);
  });

  it("splits long doc with overlap", () => {
    const content = "a".repeat(2000);
    const chunks = chunkDocument({ id: "d1", content }, { chunkSize: 500, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(3);
    // Overlap check: each chunk start < prev end
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].start).toBeLessThan(chunks[i - 1].end);
    }
  });

  it("respects sentence boundaries when available", () => {
    const content = "Sentence one. ".repeat(100) + "x".repeat(1000);
    const chunks = chunkDocument({ id: "d1", content }, { chunkSize: 800, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    // At least one chunk should end with sentence period
    expect(chunks.some(c => c.content.trimEnd().endsWith("."))).toBe(true);
  });

  it("respects minChunkSize trimming", () => {
    const content = "   \n   ".repeat(10) + "real content here";
    const chunks = chunkDocument(
      { id: "d1", content },
      { chunkSize: 50, overlap: 5, minChunkSize: 10 },
    );
    expect(chunks.every(c => c.content.trim().length >= 10 || c.end === content.length)).toBe(true);
  });

  it("handles newline boundaries", () => {
    const content = Array.from({ length: 20 }, (_, i) => `line ${i}\n`).join("") + "a".repeat(1000);
    const chunks = chunkDocument({ id: "d1", content }, { chunkSize: 200, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(2);
  });
});
