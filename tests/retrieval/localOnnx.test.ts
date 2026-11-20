import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_LOCAL_ONNX_MODEL,
  LocalEmbeddingProvider,
} from "../../src/retrieval/providers/LocalEmbeddingProvider.js";
import {
  buildCorpusFixture,
  createLocalQualityConfigs,
  runQualityEval,
} from "../../src/retrieval/eval/runner.js";

describe("LocalEmbeddingProvider ONNX verification", () => {
  it("falls back to Mock when ONNX unavailable (CI offline) — verifies fallback path", async () => {
    const p = new LocalEmbeddingProvider();
    const vec = await p.embed("hello world for onnx test");
    expect(vec.length).toBe(384);
    const mag = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    expect(mag).toBeCloseTo(1, 5);
    expect(p.isFallback()).toBe(true);
  });

  it("verifies real ONNX provider when available, otherwise skips cleanly", async () => {
    let hasOnnx = false;
    try {
      const mod = await import("@xenova/transformers" as string);
      hasOnnx = !!(mod as unknown as { pipeline?: unknown }).pipeline;
    } catch {
      hasOnnx = false;
    }
    if (!hasOnnx) {
      // CI offline — skip cleanly, verify fallback still works
      const p = new LocalEmbeddingProvider();
      const vec = await p.embed("fallback check");
      expect(vec.length).toBe(384);
      return;
    }
    const p = new LocalEmbeddingProvider();
    const vec = await p.embed("test onnx dimensions");
    expect(vec.length).toBe(384);
    const mag = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    expect(mag).toBeCloseTo(1, 4);
    const many = await p.embedMany(["a", "b", "c"]);
    expect(many).toHaveLength(3);
    for (const v of many) expect(v.length).toBe(384);
  });

  it("extracts Float32Array ONNX tensors with mean pooling, deduplicates concurrent init, and reports onnx backend", async () => {
    const extractor = vi.fn(
      async (text: string, opts?: { pooling?: string; normalize?: boolean }) => {
        expect(opts).toEqual({ pooling: "mean", normalize: true });
        const data = new Float32Array(384);
        // Signal-bearing deterministic Float32Array fixture
        data[0] = text.includes("braille") ? 3 : 0;
        data[1] = text.includes("tactile") ? 4 : 1;
        return { data };
      },
    );
    const pipeline = vi.fn(async (task: string, model: string) => {
      expect(task).toBe("feature-extraction");
      expect(model).toBe(DEFAULT_LOCAL_ONNX_MODEL);
      return extractor;
    });
    const loader = vi.fn(async () => ({ pipeline }));

    const provider = new LocalEmbeddingProvider({ loader });
    expect(provider.getBackend()).toBe("uninitialized");

    const vectors = await provider.embedMany(["braille tactile", "other text", "braille"]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(pipeline).toHaveBeenCalledTimes(1);
    expect(provider.isFallback()).toBe(false);
    expect(provider.getBackend()).toBe("onnx");
    expect(vectors).toHaveLength(3);
    for (const v of vectors) {
      expect(v).toHaveLength(384);
      const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      expect(mag).toBeCloseTo(1, 5);
    }
    // 3-4-5 right triangle normalized => [0.6, 0.8, 0, ...]
    expect(vectors[0][0]).toBeCloseTo(0.6, 5);
    expect(vectors[0][1]).toBeCloseTo(0.8, 5);
  });

  it("falls back cleanly if ONNX extractor throws at runtime and plugs into createLocalQualityConfigs", async () => {
    const throwingProvider = new LocalEmbeddingProvider({
      loader: async () => ({
        pipeline: async () => async () => {
          throw new Error("simulated ONNX runtime error");
        },
      }),
    });
    const vec = await throwingProvider.embed("resilience check");
    expect(vec).toHaveLength(384);
    expect(throwingProvider.isFallback()).toBe(true);
    expect(throwingProvider.getBackend()).toBe("fallback");

    // Verify M3 opt-in local quality configs run cleanly through runQualityEval
    const corpus = buildCorpusFixture(
      "mini-local",
      [
        { id: "d1", path: "d1.md", content: "refreshable braille piezoelectric pins" },
        { id: "d2", path: "d2.md", content: "screen reader landmarks and aria live regions" },
      ],
      "q1\tlexical\tbraille pins\n",
      "q1\td1\t2\n",
    );
    const report = await runQualityEval({
      corpora: [corpus],
      configs: createLocalQualityConfigs(
        () =>
          new LocalEmbeddingProvider({
            loader: async () => ({
              pipeline: async () => async text => {
                const data = new Float32Array(8);
                data[0] = text.includes("braille") ? 1 : 0;
                data[1] = text.includes("screen") ? 1 : 0;
                return { data };
              },
            }),
          }),
      ),
    });
    expect(report.macroOverall["vector:local"]?.recallAt1).toBe(1);
    expect(report.macroOverall["hybrid:local"]?.ndcgAt10).toBe(1);
    expect(report.macroOverall["hybrid:local+rerank"]?.mrrAt10).toBe(1);
  });
});
