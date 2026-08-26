/**
 * Persistence round-trip executed in REAL Node (no Vite SSR transform).
 * Serves as T06's probe for `npm run evaluate` — see src/app/evaluation.ts.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";
import { SYNTHETIC_CORPUS, EVALUATION_QUERY } from "../../src/app/evaluation.js";

describe("evaluation T06 probe: disk persistence round-trip", () => {
  it("survives saveToDisk → loadFromDisk in a private temp dir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autosd-eval-"));
    try {
      const provider = new MockEmbeddingProvider();
      const wf = new ResearchWorkflow({ provider, topK: 5 });
      await wf.ingest([...SYNTHETIC_CORPUS]);
      await wf.run({ id: "eval-query-1", question: EVALUATION_QUERY });

      await wf.saveToDisk(dir);

      const restored = new ResearchWorkflow({ provider });
      const ok = await restored.loadFromDisk(dir);
      expect(ok).toBe(true);

      const sessions = restored.listSessions();
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.at(-1)?.query.id).toBe("eval-query-1");
      expect(restored.listDocuments()).toHaveLength(SYNTHETIC_CORPUS.length);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
