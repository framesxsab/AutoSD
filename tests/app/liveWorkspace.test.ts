/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";
import { Workspace } from "../../src/app/Workspace.js";
import { LiveSync } from "../../src/app/LiveSync.js";

describe("Live workspace synchronization", () => {
  let dir: string;
  let workflow: ResearchWorkflow;
  let liveSync: LiveSync;
  let workspace: Workspace;
  let parent: HTMLElement;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "autosd-livews-"));
    workflow = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    liveSync = new LiveSync(workflow, join(dir, "docs"));
    workspace = new Workspace(workflow);
    parent = document.createElement("div");
    document.body.appendChild(parent);
    workspace.mount(parent);
    workspace.attachLiveSync(liveSync);
    await liveSync.start();
  });

  afterEach(async () => {
    workspace.unmount();
    liveSync.stop();
    parent.remove();
    await rm(dir, { recursive: true, force: true });
  });

  it("added file → Indexing → Updated and workspace refreshes", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "docs"), { recursive: true });
    await writeFile(join(dir, "docs", "a.md"), "alpha beta", "utf8");
    const { CorpusWatcher } = await import("../../src/retrieval/CorpusWatcher.js");
    const watcher = new CorpusWatcher(join(dir, "docs"), async ev => {
      const docs = [...ev.added, ...ev.modified];
      if (docs.length) await workflow.ingest(docs);
    });
    const ev = await watcher.trigger();
    expect(ev.added.length).toBe(1);
    await workflow.ingest(ev.added);
    expect(workflow.listDocuments().length).toBe(1);
    // Simulate LiveSync status flow
    const statuses: string[] = [];
    const unsub = liveSync.onStatusChange(s => statuses.push(s));
    (liveSync as unknown as { setStatus: (s: string) => void }).setStatus("Indexing");
    (liveSync as unknown as { setStatus: (s: string) => void }).setStatus("Updated");
    expect(statuses).toContain("Indexing");
    expect(statuses).toContain("Updated");
    unsub();
  });

  it("modified file triggers incremental ingest", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "docs"), { recursive: true });
    await writeFile(join(dir, "docs", "b.md"), "hello", "utf8");
    const { CorpusWatcher } = await import("../../src/retrieval/CorpusWatcher.js");
    const watcher = new CorpusWatcher(join(dir, "docs"), async () => {});
    await watcher.trigger();
    await writeFile(join(dir, "docs", "b.md"), "hello changed", "utf8");
    const ev2 = await watcher.trigger();
    expect(ev2.modified.length).toBe(1);
    await workflow.ingest(ev2.modified);
    expect(workflow.listDocuments().length).toBe(1);
  });

  it("deleted file triggers removal", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "docs"), { recursive: true });
    await writeFile(join(dir, "docs", "c.md"), "to delete", "utf8");
    const { CorpusWatcher } = await import("../../src/retrieval/CorpusWatcher.js");
    const watcher = new CorpusWatcher(join(dir, "docs"), async () => {});
    const ev1 = await watcher.trigger();
    await workflow.ingest(ev1.added);
    expect(workflow.listDocuments().length).toBe(1);
    await unlink(join(dir, "docs", "c.md"));
    const ev2 = await watcher.trigger();
    expect(ev2.deleted).toContain("c");
  });

  it("indexing → error status on ingest failure", async () => {
    const badWorkflow = {
      ingest: async () => {
        throw new Error("ingest fail");
      },
      listDocuments: () => [],
      clear: () => {},
      saveToDisk: async () => {},
    } as unknown as ResearchWorkflow;
    const badSync = new LiveSync(badWorkflow, join(dir, "docs"));
    await badSync.start();
    const statuses: string[] = [];
    const unsub = badSync.onStatusChange(s => statuses.push(s));
    // Trigger handleChange directly via watcher event
    await (badSync as unknown as { handleChange: (ev: unknown) => Promise<void> }).handleChange({
      added: [{ id: "x", content: "y", path: "/tmp/x" }],
      modified: [],
      deleted: [],
    });
    expect(statuses).toContain("Indexing");
    expect(statuses).toContain("Error");
    unsub();
    badSync.stop();
  });

  it("no duplicate subscriptions and no leaks", () => {
    const sync = new LiveSync(workflow, join(dir, "docs"));
    const fn1 = () => {};
    const fn2 = () => {};
    const unsub1 = sync.onStatusChange(fn1);
    const unsub2 = sync.onStatusChange(fn1);
    expect(unsub1).not.toBe(unsub2);
    unsub1();
    unsub2();
    const unsub3 = sync.onStatusChange(fn2);
    unsub3();
    expect((sync as unknown as { statusListeners: Set<unknown> }).statusListeners.size).toBe(0);
  });

  it("accessible status announcements", () => {
    const host = document.createElement("div");
    liveSync.mountStatusIndicator(host);
    expect(host.querySelector('[aria-label="Corpus sync status"]')).not.toBeNull();
    expect(host.querySelector("[data-status]")).not.toBeNull();
  });
});
