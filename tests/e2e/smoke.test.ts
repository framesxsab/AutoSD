/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapApp } from "../../src/app/bootstrap.js";
import { DIContainer } from "../../src/core/DIContainer.js";
import { createCitationList } from "../../src/ui/CitationView.js";

describe("E2E smoke: app start → ingest → retrieval → citations → export/delete → shutdown", () => {
  let dir: string;
  let di: DIContainer;
  let stop: () => void;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "autosd-e2e-"));
    di = new DIContainer();
  });

  afterEach(async () => {
    try {
      stop?.();
    } catch {}
    di.clear();
    await rm(dir, { recursive: true, force: true });
  });

  it("proves full lifecycle", async () => {
    const { workflow, liveSync, stop: s } = await bootstrapApp({ di, corpusDir: dir });
    stop = s;
    expect(workflow.listDocuments()).toHaveLength(0);
    expect(liveSync.isRunning()).toBe(true);
    expect(liveSync.getStatus()).toBe("Idle");

    await writeFile(
      join(dir, "docs", "guide.md"),
      "alpha beta gamma guide for smoke",
      "utf8",
    ).catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(dir, "docs"), { recursive: true });
      await writeFile(join(dir, "docs", "guide.md"), "alpha beta gamma guide for smoke", "utf8");
    });

    const docsDir = join(dir, "docs");
    const { CorpusWatcher } = await import("../../src/retrieval/CorpusWatcher.js");
    const watcher = new CorpusWatcher(docsDir, async ev => {
      const docs = [...ev.added, ...ev.modified];
      if (docs.length) await workflow.ingest(docs);
    });
    const ev = await watcher.trigger();
    expect(ev.added.length).toBeGreaterThan(0);
    await workflow.ingest(ev.added);
    expect(workflow.listDocuments().length).toBeGreaterThan(0);

    const res = await workflow.run({ id: "q1", question: "alpha beta" });
    expect(res.citations.length).toBeGreaterThan(0);
    expect(res.confidence).toBeGreaterThan(0);

    const el = createCitationList(res, () => {});
    expect(el.querySelectorAll("[data-chunk]").length).toBe(res.citations.length);

    const session = workflow.listSessions()[0];
    const json = workflow.exportSession(session.id);
    expect(JSON.parse(json).id).toBe(session.id);

    const before = workflow.listSessions().length;
    expect(workflow.deleteSession(session.id)).toBe(true);
    expect(workflow.listSessions()).toHaveLength(before - 1);

    await workflow.saveToDisk(dir);
    const di2 = new DIContainer();
    const { workflow: wf2 } = await bootstrapApp({ di: di2, corpusDir: dir });
    expect(wf2.listDocuments().length).toBeGreaterThan(0);
    wf2.clear();
    di2.clear();

    stop();
    expect(liveSync.isRunning()).toBe(false);
  });
});
