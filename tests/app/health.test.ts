/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { getHealth } from "../../src/app/health.js";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";

describe("health", () => {
  it("reports secret-free readiness snapshot", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([{ id: "d1", content: "hello" }]);
    const report = getHealth({ workflow: wf });

    expect(report.status).toBe("ok");
    expect(report.corpus.documents).toBe(1);
    expect(report.embedding.provider).toBe("mock");
    const serialized = JSON.stringify(report);
    expect(serialized.toLowerCase()).not.toContain("apikey");
    expect(serialized).not.toContain("OPENAI");
    expect(Object.isFrozen(report)).toBe(true);
  });

  it("never throws with no dependencies", () => {
    const report = getHealth();
    expect(["ok", "degraded"]).toContain(report.status);
    expect(report.corpus.dir).not.toMatch(/[/\\]/);
  });
});
