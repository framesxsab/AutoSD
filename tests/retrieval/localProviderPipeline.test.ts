import { describe, it, expect, beforeEach, vi } from "vitest";
import { LocalEmbeddingProvider } from "../../src/retrieval/providers/LocalEmbeddingProvider.js";

// The transformers.js dependency is optional and absent in CI. Mocking it lets
// us exercise the real-pipeline branch of the wrapper (normalization, fallback
// on inference failure) that otherwise never executes outside ONNX installs.
const tf = vi.hoisted(() => ({
  extractor: null as null | ((text: string) => Promise<unknown>),
  failFactory: false,
}));

vi.mock("@xenova/transformers", () => ({
  pipeline: async () => {
    if (tf.failFactory) throw new Error("model download failed");
    if (!tf.extractor) throw new Error("no extractor configured");
    return tf.extractor;
  },
}));

describe("LocalEmbeddingProvider with a live (mocked) ONNX pipeline", () => {
  beforeEach(() => {
    tf.extractor = null;
    tf.failFactory = false;
  });

  it("normalizes pipeline output vectors to unit length", async () => {
    tf.extractor = async () => ({ data: [3, 4] });
    const p = new LocalEmbeddingProvider();
    const vec = await p.embed("hello");
    expect(vec[0]).toBeCloseTo(0.6, 12);
    expect(vec[1]).toBeCloseTo(0.8, 12);
    expect(p.isFallback()).toBe(false);
  });

  it("accepts raw array output without a .data wrapper", async () => {
    tf.extractor = async () => [9, 12];
    const p = new LocalEmbeddingProvider();
    const vec = await p.embed("raw");
    expect(vec[0]).toBeCloseTo(9 / 15, 12);
    expect(vec[1]).toBeCloseTo(12 / 15, 12);
  });

  it("returns zero vectors unchanged instead of dividing by zero magnitude", async () => {
    tf.extractor = async () => ({ data: [0, 0] });
    const p = new LocalEmbeddingProvider();
    await expect(p.embed("zeros")).resolves.toEqual([0, 0]);
  });

  it("falls back to the deterministic mock when pipeline output is empty", async () => {
    tf.extractor = async () => ({ data: [] });
    const p = new LocalEmbeddingProvider();
    const vec = await p.embed("empty");
    expect(vec).toHaveLength(384);
    // Pipeline is loaded and healthy; only this output was unusable.
    expect(p.isFallback()).toBe(false);
  });

  it("marks itself as fallen back when inference throws mid-flight", async () => {
    tf.extractor = async () => {
      throw new Error("onnx runtime boom");
    };
    const p = new LocalEmbeddingProvider();
    const vec = await p.embed("boom");
    expect(vec).toHaveLength(384);
    expect(p.isFallback()).toBe(true);
  });

  it("marks initFailed when the pipeline factory rejects", async () => {
    tf.failFactory = true;
    const p = new LocalEmbeddingProvider();
    const vec = await p.embed("no model");
    expect(vec).toHaveLength(384);
    expect(p.isFallback()).toBe(true);
  });

  it("embedMany routes every input through the live pipeline once warmed", async () => {
    tf.extractor = async (text: string) => ({ data: text === "a" ? [1, 0] : [0, 1] });
    const p = new LocalEmbeddingProvider();
    // First embed resolves the pipeline; concurrent cold-start calls fall back
    // to the mock because ensurePipeline() has not assigned this.pipe yet.
    await p.embed("warmup");
    const many = await p.embedMany(["a", "b"]);
    expect(many).toHaveLength(2);
    expect(many[0]).toEqual([1, 0]);
    expect(many[1]).toEqual([0, 1]);
  });
});
