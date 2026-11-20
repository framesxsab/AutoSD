import { describe, it, expect, afterEach } from "vitest";
import { LexicalHashEmbeddingProvider } from "../../src/retrieval/providers/LexicalHashEmbeddingProvider.js";
import { cosineSimilarity } from "../../src/retrieval/embedder.js";
import { loadConfig, resetConfigCache } from "../../src/app/config.js";
import { resolveEmbeddingProvider } from "../../src/app/bootstrap.js";
import * as providerPublicApi from "../../src/retrieval/providers/index.js";

describe("LexicalHashEmbeddingProvider", () => {
  afterEach(() => {
    resetConfigCache();
    delete process.env.VITE_EMBEDDING_PROVIDER;
  });

  it("produces deterministic 384-d unit vectors and handles empty text without NaN", async () => {
    const provider = new LexicalHashEmbeddingProvider();
    expect(provider.id).toBe("lexical-hash");
    expect(provider.model).toBe("lexical-hash-384");
    expect(provider.dimensions).toBe(384);
    expect(providerPublicApi.LexicalHashEmbeddingProvider).toBe(LexicalHashEmbeddingProvider);

    const a = await provider.embed("refreshable braille display piezoelectric pins");
    const b = await provider.embed("refreshable braille display piezoelectric pins");
    expect(a).toHaveLength(384);
    expect(a).toEqual(b);

    const mag = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    expect(mag).toBeCloseTo(1, 5);

    const empty = await provider.embed("   ");
    expect(empty).toHaveLength(384);
    expect(empty.every(x => x === 0)).toBe(true);
    expect(empty.some(Number.isNaN)).toBe(false);

    const batch = await provider.embedMany(["braille", "tactile"]);
    expect(batch).toHaveLength(2);
  });

  it("carries genuine lexical signal (related text > unrelated text)", async () => {
    const provider = new LexicalHashEmbeddingProvider();
    const [q, rel, unrel] = await provider.embedMany([
      "refreshable braille display piezoelectric pins",
      "piezoelectric actuators raise braille display pins",
      "italian pasta recipe boiling salted water",
    ]);

    const relSim = cosineSimilarity(q, rel);
    const unrelSim = cosineSimilarity(q, unrel);
    expect(relSim).toBeGreaterThan(unrelSim);
    expect(relSim).toBeGreaterThan(0.3);
  });

  it("is typo-resilient via character 3-grams", async () => {
    const provider = new LexicalHashEmbeddingProvider();
    const [clean, typo, distractor] = await provider.embedMany([
      "refreshable braille display",
      "refreshble braile displai",
      "quantum chromodynamics lattice gauge",
    ]);

    const typoSim = cosineSimilarity(clean, typo);
    const distSim = cosineSimilarity(clean, distractor);
    expect(typoSim).toBeGreaterThan(distSim);
    expect(typoSim).toBeGreaterThan(0.3);
  });

  it("resolves via config and bootstrapApp when VITE_EMBEDDING_PROVIDER=lexical", () => {
    process.env.VITE_EMBEDDING_PROVIDER = "lexical";
    resetConfigCache();
    const { config, warnings } = loadConfig();
    expect(warnings).toEqual([]);
    expect(config.embeddingProvider).toBe("lexical");

    const resolved = resolveEmbeddingProvider();
    expect(resolved.id).toBe("lexical-hash");
  });
});
