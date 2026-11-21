/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cosineSimilarity, toFloat32Vector } from "../../src/retrieval/embedder.js";
import { RetrievalPipeline } from "../../src/retrieval/pipeline.js";
import { LexicalHashEmbeddingProvider } from "../../src/retrieval/providers/LexicalHashEmbeddingProvider.js";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { collectDiagnostics, formatDiagnosticsReport } from "../../src/app/diagnostics.js";
import { DiagnosticsPanel } from "../../src/ui/DiagnosticsPanel.js";

describe("Float32Array vector storage & local retrieval telemetry", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("stores chunk vectors as Float32Array with exact 4-byte-per-dimension accounting and accurate cosine similarity", async () => {
    const a = toFloat32Vector([3, 4, 0]);
    const b = toFloat32Vector([6, 8, 0]);
    expect(a).toBeInstanceOf(Float32Array);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);

    const provider = new LexicalHashEmbeddingProvider();
    const pipe = new RetrievalPipeline(provider, { topK: 5, mode: "hybrid" });
    await pipe.ingest([
      { id: "d1", content: "Piezoelectric braille pins actuate across 40 cells." },
      { id: "d2", content: "WCAG 2.2 AA enforces focus visibility and live regions." },
    ]);

    const stats = pipe.getVectorStats();
    expect(stats.storage).toBe("float32");
    expect(stats.count).toBe(2);
    expect(stats.dimensions).toBe(provider.dimensions);
    expect(stats.bytes).toBe(2 * provider.dimensions * 4);

    pipe.removeDocument("d1");
    expect(pipe.getVectorStats().count).toBe(1);
    expect(pipe.getVectorStats().bytes).toBe(provider.dimensions * 4);

    pipe.clear();
    expect(pipe.getVectorStats()).toEqual({
      count: 0,
      dimensions: 0,
      bytes: 0,
      storage: "float32",
    });
  });

  it("tracks local-only retrieval telemetry (latency, abstentions, zero-hit) and renders it in DiagnosticsPanel without leaking query text", async () => {
    const wf = new ResearchWorkflow({
      provider: new LexicalHashEmbeddingProvider(),
      reranker: true,
      abstainOnLowEvidence: true,
    });
    await wf.ingest([
      {
        id: "t-doc",
        path: "t.md",
        content: "Refreshable braille displays raise tactile dots using piezoelectric actuators.",
      },
    ]);

    // 1. In-domain hit
    const secretMarker = "PRIVATE_QUERY_MARKER_991";
    const hit = await wf.run({
      id: "q1",
      question: `piezoelectric tactile actuators ${secretMarker}`,
    });
    expect(hit.abstained).toBe(false);

    // 2. Out-of-domain abstention
    const ood = await wf.run({
      id: "q2",
      question: "sourdough starter hydration fermentation temperature",
    });
    expect(ood.abstained).toBe(true);

    // 3. Zero-hit BM25 query without abstention
    const zeroHit = await wf.run({
      id: "q3",
      question: "xylophone zeppelin nonmatching",
      mode: "bm25",
      abstainOnLowEvidence: false,
    });
    expect(zeroHit.citations).toEqual([]);

    const telemetry = wf.getTelemetry();
    expect(telemetry.queryCount).toBe(3);
    expect(telemetry.abstentionCount).toBe(1);
    expect(telemetry.zeroHitCount).toBe(1);
    expect(telemetry.p50LatencyMs).toBeGreaterThanOrEqual(0);
    expect(telemetry.p95LatencyMs).toBeGreaterThanOrEqual(telemetry.p50LatencyMs);

    const report = collectDiagnostics({ workflow: wf });
    expect(report.retrieval.queryCount).toBe(3);
    expect(report.retrieval.abstentionCount).toBe(1);
    expect(report.retrieval.zeroHitCount).toBe(1);
    expect(report.retrieval.vectorStorage).toBe("float32");
    expect(report.retrieval.vectorBytes).toBeGreaterThan(0);

    // Privacy invariant: query text and document content never appear in diagnostics JSON
    const formatted = formatDiagnosticsReport(report);
    expect(formatted).not.toContain(secretMarker);
    expect(formatted).not.toContain("piezoelectric");

    // DiagnosticsPanel renders the Retrieval telemetry row
    const panel = new DiagnosticsPanel({ input: { workflow: wf } });
    panel.mount(container);
    expect(container.textContent).toContain("Retrieval telemetry");
    expect(container.textContent).toContain("3 queries · 1 abstained · 1 zero-hit");
    expect(container.textContent).toContain("float32");
    panel.unmount();

    wf.resetTelemetry();
    expect(wf.getTelemetry().queryCount).toBe(0);
  });
});
