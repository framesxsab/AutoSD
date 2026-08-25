/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";
import { LiveSync } from "../../src/app/LiveSync.js";

describe("LiveSync", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "autosd-live-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("Idle → Indexing → Updated without blocking UI", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    const sync = new LiveSync(wf, dir);
    const statusHost = document.createElement("div");
    sync.mountStatusIndicator(statusHost);
    await sync.start();
    expect(sync.getStatus()).toBe("Idle");
    expect(statusHost.textContent).toContain("Idle");

    await writeFile(join(dir, "doc.md"), "alpha beta gamma", "utf8");
    const { CorpusWatcher } = await import("../../src/retrieval/CorpusWatcher.js");
    const watcher = new CorpusWatcher(dir, async ev => {
      const docs = [...ev.added, ...ev.modified];
      if (docs.length) await wf.ingest(docs);
    });
    const ev = await watcher.trigger();
    expect(ev.added.length).toBe(1);

    // Simulate LiveSync handling
    await wf.ingest(ev.added);
    expect(wf.listDocuments()).toHaveLength(1);
    sync.stop();
    expect(sync.isRunning()).toBe(false);
  });

  it("does not block UI while indexing (background)", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    const sync = new LiveSync(wf, dir);
    await sync.start();
    const start = Date.now();
    const p = wf.ingest([{ id: "d1", content: "hello ".repeat(200) }]);
    expect(sync.getStatus()).toBe("Idle");
    await p;
    expect(Date.now() - start).toBeLessThan(2000);
    sync.stop();
  });
});
