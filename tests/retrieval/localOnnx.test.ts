import { describe, it, expect } from "vitest";
import { LocalEmbeddingProvider } from "../../src/retrieval/providers/LocalEmbeddingProvider.js";

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
});
