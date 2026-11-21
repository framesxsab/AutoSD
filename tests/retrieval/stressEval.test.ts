import { describe, it, expect } from "vitest";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { LexicalHashEmbeddingProvider } from "../../src/retrieval/providers/LexicalHashEmbeddingProvider.js";
import {
  buildStressMarkdown,
  runAdversarialEval,
  runScaleBenchmark,
} from "../../src/retrieval/eval/stress.js";

describe("Scale/latency benchmark & adversarial/abstention evaluation harness", () => {
  it("ResearchWorkflow abstains cleanly on out-of-domain queries when abstainOnLowEvidence is enabled", async () => {
    const wf = new ResearchWorkflow({
      provider: new LexicalHashEmbeddingProvider(),
      reranker: true,
      abstainOnLowEvidence: true,
      minVectorScore: 0.2,
    });
    await wf.ingest([
      {
        id: "braille-doc",
        path: "braille.md",
        content: "Refreshable braille displays actuate piezoelectric tactile pins at 60 Hz.",
      },
    ]);

    const ood = await wf.run({
      id: "q-ood",
      question: "sourdough starter hydration fermentation temperature",
    });
    expect(ood.abstained).toBe(true);
    expect(ood.citations).toEqual([]);
    expect(ood.confidence).toBe(0);
    expect(ood.answer).toContain("Insufficient evidence");

    const inDomain = await wf.run({
      id: "q-in",
      question: "piezoelectric tactile pins refreshable braille",
    });
    expect(inDomain.abstained).toBe(false);
    expect(inDomain.citations.length).toBeGreaterThan(0);
    expect(inDomain.confidence).toBeGreaterThan(0);
  });

  it("runScaleBenchmark measures multi-chunk ingest, latency percentiles, heap delta, and top-1 hit rate", async () => {
    const report = await runScaleBenchmark({ docCount: 36, paragraphsPerDoc: 3, queryCount: 12 });
    expect(report.documentCount).toBe(36);
    expect(report.queryCount).toBe(12);
    expect(report.results).toHaveLength(3);

    for (const r of report.results) {
      expect(r.chunkCount).toBeGreaterThanOrEqual(36);
      expect(r.ingestMs).toBeGreaterThanOrEqual(0);
      expect(r.latency.queryCount).toBe(12);
      expect(r.latency.p50Ms).toBeLessThanOrEqual(r.latency.p95Ms);
      expect(r.latency.p95Ms).toBeLessThanOrEqual(r.latency.p99Ms);
      expect(r.latency.p99Ms).toBeLessThanOrEqual(r.latency.maxMs);
      expect(r.top1HitRate).toBeGreaterThanOrEqual(0.8);
    }
  });

  it("runAdversarialEval measures unanswerable abstention, OCR noise resilience, and multi-hop dual-doc recall", async () => {
    const adv = await runAdversarialEval();
    expect(adv.abstention.queryCount).toBe(8);
    expect(adv.abstention.guardedAbstentionRate).toBe(1);
    expect(adv.abstention.guardedFalseCitationRate).toBe(0);
    expect(adv.abstention.guardedMaxConfidence).toBe(0);

    expect(adv.ocrNoise.queryCount).toBe(6);
    expect(adv.ocrNoise.recallAt5).toBeGreaterThanOrEqual(0.8);
    expect(adv.ocrNoise.mrrAt10).toBeGreaterThanOrEqual(0.7);

    expect(adv.multiHop.queryCount).toBe(6);
    expect(adv.multiHop.dualDocRecallAt5).toBeGreaterThanOrEqual(0.8);
    expect(adv.multiHop.singleDocRecallAt5).toBe(1);

    const scale = await runScaleBenchmark({ docCount: 12, paragraphsPerDoc: 2, queryCount: 6 });
    const md = buildStressMarkdown(scale, adv);
    expect(md).toContain("Scale & Latency Benchmark");
    expect(md).toContain("Adversarial & Abstention Suite");
    expect(md).toContain("hybrid:lexical-hash+rerank");
  });
});
