import { describe, it, expect } from "vitest";
import { cosineSimilarity, normalizeVector } from "../../src/retrieval/embedder.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";
import { LocalEmbeddingProvider } from "../../src/retrieval/providers/LocalEmbeddingProvider.js";
import { OpenAIEmbeddingProvider } from "../../src/retrieval/providers/OpenAIEmbeddingProvider.js";

describe("embedder utils", () => {
  it("cosineSimilarity handles zero vector", () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("normalizeVector handles zero", () => {
    expect(normalizeVector([0, 0])).toEqual([0, 0]);
    const v = normalizeVector([3, 4]);
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
  });
});

describe("MockEmbeddingProvider", () => {
  it("deterministic and normalized", async () => {
    const p = new MockEmbeddingProvider();
    const a = await p.embed("hello");
    const b = await p.embed("hello");
    expect(a).toEqual(b);
    expect(a.length).toBe(384);
    const mag = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    expect(mag).toBeCloseTo(1, 5);
    const c = await p.embed("world");
    expect(a).not.toEqual(c);
    const many = await p.embedMany(["a", "b"]);
    expect(many).toHaveLength(2);
  });
});

describe("LocalEmbeddingProvider", () => {
  it("distinct from mock but deterministic", async () => {
    const local = new LocalEmbeddingProvider();
    const mock = new MockEmbeddingProvider();
    const lv = await local.embed("hello");
    const mv = await mock.embed("hello");
    expect(lv).not.toEqual(mv);
    expect(lv.length).toBe(384);
    expect(await local.embed("hello")).toEqual(lv);
  });
});

describe("OpenAIEmbeddingProvider", () => {
  it("throws when not configured", async () => {
    const p = new OpenAIEmbeddingProvider("text-embedding-3-small", 1536, "");
    expect(p.isConfigured()).toBe(false);
    await expect(p.embed("hi")).rejects.toThrow("OPENAI_API_KEY");
  });

  it("isConfigured true with key", () => {
    const p = new OpenAIEmbeddingProvider("text-embedding-3-small", 1536, "sk-test");
    expect(p.isConfigured()).toBe(true);
    expect(p.model).toBe("text-embedding-3-small");
    expect(p.dimensions).toBe(1536);
  });
});
