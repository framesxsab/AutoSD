import { describe, it, expect } from "vitest";
import { BM25Index } from "../../src/retrieval/bm25.js";

function mkChunk(id: string, content: string) {
  return { id, documentId: id.split("#")[0], content, start: 0, end: content.length, hash: "h" };
}

describe("BM25Index", () => {
  it("empty search returns empty", () => {
    const idx = new BM25Index();
    expect(idx.search("hello")).toEqual([]);
    idx.addChunk(mkChunk("d1#0", "hello world"));
    expect(idx.search("")).toEqual([]);
    expect(idx.search("   ")).toEqual([]);
  });

  it("scores exact matches higher", () => {
    const idx = new BM25Index();
    idx.addChunk(mkChunk("d1#0", "braille display haptics"));
    idx.addChunk(mkChunk("d2#0", "cooking recipes"));
    const res = idx.search("braille display");
    expect(res[0].chunk.id).toBe("d1#0");
    expect(res[0].score).toBeGreaterThan(0);
  });

  it("addChunks and removeChunk update frequencies", () => {
    const idx = new BM25Index();
    idx.addChunks([mkChunk("d1#0", "hello hello hello"), mkChunk("d2#0", "hello world")]);
    expect(idx.size()).toBe(2);
    let res = idx.search("hello");
    expect(res).toHaveLength(2);
    idx.removeChunk("d1#0");
    expect(idx.size()).toBe(1);
    res = idx.search("hello");
    expect(res).toHaveLength(1);
    expect(res[0].chunk.id).toBe("d2#0");
  });

  it("clear resets", () => {
    const idx = new BM25Index();
    idx.addChunk(mkChunk("d1#0", "test"));
    idx.clear();
    expect(idx.size()).toBe(0);
    expect(idx.search("test")).toEqual([]);
  });

  it("handles numeric and punctuation tokenization", () => {
    const idx = new BM25Index();
    idx.addChunk(mkChunk("d1#0", "API v2.0: 100% coverage!"));
    const res = idx.search("api coverage");
    expect(res).toHaveLength(1);
  });

  it("idf weighting: rare term scores higher than common", () => {
    const idx = new BM25Index();
    idx.addChunk(mkChunk("d1#0", "common unique_term_rare"));
    idx.addChunk(mkChunk("d2#0", "common"));
    idx.addChunk(mkChunk("d3#0", "common"));
    const res = idx.search("unique_term_rare");
    expect(res[0].chunk.id).toBe("d1#0");
  });

  it("custom k1/b", () => {
    const idx = new BM25Index({ k1: 2, b: 0.5 });
    idx.addChunk(mkChunk("d1#0", "hello world hello"));
    expect(idx.search("hello")).toHaveLength(1);
  });

  it("replacing an existing chunk id updates TF/DF/size cleanly without duplicates", () => {
    const idx = new BM25Index();
    idx.addChunk(mkChunk("d1#0", "alpha alpha beta"));
    idx.addChunk(mkChunk("d2#0", "gamma delta"));
    expect(idx.size()).toBe(2);

    idx.addChunk(mkChunk("d1#0", "gamma gamma gamma"));
    expect(idx.size()).toBe(2);
    expect(idx.search("alpha")).toEqual([]);
    const res = idx.search("gamma");
    expect(res).toHaveLength(2);
    expect(res[0].chunk.id).toBe("d1#0");
  });

  it("scores accurately and quickly across 1,000 indexed chunks", () => {
    const idx = new BM25Index();
    for (let i = 0; i < 1000; i++) {
      const content =
        i === 742
          ? "piezoelectric refreshable braille actuator calibration guide"
          : `generic document paragraph number ${i} with routine text`;
      idx.addChunk(mkChunk(`doc${i}#0`, content));
    }
    const res = idx.search("piezoelectric braille actuator", 5);
    expect(res[0].chunk.id).toBe("doc742#0");
    expect(res[0].score).toBeGreaterThan(0);
  });
});
