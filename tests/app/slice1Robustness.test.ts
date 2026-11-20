/** @vitest-environment jsdom */
/**
 * Slice 1 regression tests — Critical/High robustness fixes:
 *  - CRITICAL-1: snapshot restore keeps empty docs and restores exact text
 *  - HIGH-1: serialized ResearchWorkflow mutations / atomic pipeline commit
 *  - HIGH-2: LiveSync never drops watcher events and orders manual syncs
 *  - HIGH-3: ErrorBoundary uninstall really removes window listeners
 *  - HIGH-4: CorpusWatcher stays stopped when node:fs is the browser stub
 *  - MEDIUM-1: SnapshotIndex.saveToFile surfaces real I/O failures
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { RetrievalPipeline } from "../../src/retrieval/pipeline.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";
import type { EmbeddingProvider } from "../../src/retrieval/embedder.js";
import { LiveSync } from "../../src/app/LiveSync.js";
import type { WatcherEvent } from "../../src/retrieval/CorpusWatcher.js";
import { ErrorBoundary } from "../../src/app/ErrorBoundary.js";
import { SnapshotIndex } from "../../src/retrieval/snapshot.js";

/** Provider whose embedMany calls resolve only when released, to force interleaving. */
class GatedProvider implements EmbeddingProvider {
  readonly id = "gated";
  readonly model = "gated-8";
  readonly dimensions = 8;
  private inner = new MockEmbeddingProvider();
  private gates: Array<() => void> = [];
  embed(text: string): Promise<number[]> {
    return this.inner.embed(text);
  }
  async embedMany(texts: string[]): Promise<number[][]> {
    await new Promise<void>(resolve => this.gates.push(resolve));
    return Promise.all(texts.map(t => this.inner.embed(t)));
  }
  pending(): number {
    return this.gates.length;
  }
  releaseAll(): void {
    const g = this.gates.splice(0);
    g.forEach(fn => fn());
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe("Slice 1 — CRITICAL-1 snapshot restore fidelity", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "autosd-s1-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps zero-chunk (empty) documents through saveToDisk → loadFromDisk", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([
      { id: "empty", content: "", path: "/empty.md" },
      { id: "full", content: "Braille displays render tactile cells.", path: "/full.md" },
    ]);
    await wf.saveToDisk(dir);

    // Even without documents.json (older corpus dirs) the empty doc survives via the manifest.
    await rm(join(dir, "documents.json"));
    const restored = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    expect(await restored.loadFromDisk(dir)).toBe(true);
    const ids = restored
      .listDocuments()
      .map(d => d.id)
      .sort();
    expect(ids).toEqual(["empty", "full"]);
    expect(restored.getDocument("empty")?.content).toBe("");
    expect(restored.getDocument("empty")?.path).toBe("/empty.md");
  });

  it("restores exact text for documents with skipped whitespace-only spans", async () => {
    // A long whitespace run produces a chunk that chunkDocument() skips, leaving a
    // gap that chunk-based reconstruction cannot recover on its own.
    const content = `${"Alpha sentence one. ".repeat(30)}${" ".repeat(900)}${"Omega sentence two. ".repeat(30)}`;
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([{ id: "gappy", content }]);
    await wf.saveToDisk(dir);

    const restored = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    expect(await restored.loadFromDisk(dir)).toBe(true);
    expect(restored.getDocument("gappy")?.content).toBe(content);
  });

  it("ignores a documents.json entry whose hash does not match the loaded index", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([{ id: "d1", content: "original indexed text for d1" }]);
    await wf.saveToDisk(dir);
    const docsPath = join(dir, "documents.json");
    const tampered = JSON.parse(await readFile(docsPath, "utf8")) as { content: string }[];
    tampered[0].content = "tampered text that was never indexed";
    await writeFile(docsPath, JSON.stringify(tampered), "utf8");

    const restored = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await restored.loadFromDisk(dir);
    expect(restored.getDocument("d1")?.content).toBe("original indexed text for d1");
  });

  it("rejects (instead of silently ignoring) unreadable sessions.json", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([{ id: "d1", content: "some content" }]);
    await wf.saveToDisk(dir);
    // A directory where a file is expected → EISDIR, a real I/O fault (not ENOENT).
    await rm(join(dir, "sessions.json"));
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "sessions.json"));
    const restored = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await expect(restored.loadFromDisk(dir)).rejects.toThrow();
  });
});

describe("Slice 1 — HIGH-1 serialized ingestion", () => {
  it("RetrievalPipeline: overlapping ingests of the same doc never duplicate chunks", async () => {
    const provider = new GatedProvider();
    const pipeline = new RetrievalPipeline(provider);
    const a = pipeline.ingest([{ id: "d", content: "first version of the document text" }]);
    const b = pipeline.ingest([{ id: "d", content: "second version of the document text" }]);
    await flush();
    expect(provider.pending()).toBe(2);
    provider.releaseAll();
    await Promise.all([a, b]);
    const chunks = pipeline.getChunks().filter(c => c.documentId === "d");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("second version of the document text");
    expect(pipeline.getBM25().search("version", 10)).toHaveLength(1);
  });

  it("RetrievalPipeline: clear() during an in-flight ingest discards the stale batch", async () => {
    const provider = new GatedProvider();
    const pipeline = new RetrievalPipeline(provider);
    const p = pipeline.ingest([{ id: "d", content: "stale content" }]);
    await flush();
    pipeline.clear();
    provider.releaseAll();
    await p;
    expect(pipeline.getChunks()).toHaveLength(0);
  });

  it("ResearchWorkflow: concurrent ingest + remove + provider swap converge to one consistent index", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider(), mode: "bm25" });
    const ops = [
      wf.ingest([{ id: "a", content: "alpha tactile reader content" }]),
      wf.ingest([{ id: "b", content: "beta braille display content" }]),
      wf.removeDocument("a"),
      wf.ingest([{ id: "c", content: "gamma refreshable cells content" }]),
    ];
    wf.setEmbeddingProvider(new MockEmbeddingProvider());
    await Promise.all(ops);
    await wf.whenIdle();

    expect(
      wf
        .listDocuments()
        .map(d => d.id)
        .sort(),
    ).toEqual(["b", "c"]);
    const res = await wf.run({ id: "q", question: "content" });
    const docIds = res.citations.map(c => c.documentId);
    expect(new Set(docIds).size).toBe(docIds.length); // no duplicate chunks
    expect(docIds).not.toContain("a");
  });

  it("ResearchWorkflow: a failed mutation does not block later ones and reindex errors surface", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([{ id: "a", content: "alpha content" }]);
    const failing: EmbeddingProvider = {
      id: "failing",
      model: "failing-1",
      dimensions: 4,
      embed: () => Promise.reject(new Error("provider down")),
      embedMany: () => Promise.reject(new Error("provider down")),
    } as EmbeddingProvider;
    const errors: string[] = [];
    wf.onError(e => errors.push(e.operation));
    wf.setEmbeddingProvider(failing);
    await wf.whenIdle();
    expect(errors).toContain("reindex");
    expect(wf.getLastError()?.operation).toBe("reindex");

    wf.setEmbeddingProvider(new MockEmbeddingProvider());
    const r = await wf.ingest([{ id: "b", content: "beta content" }]);
    expect(r.chunkCount).toBeGreaterThan(0);
  });
});

describe("Slice 1 — HIGH-2 LiveSync queueing", () => {
  type Internals = { handleChange(ev: WatcherEvent): Promise<void> };

  it("queues watcher events that arrive while a sync is in flight (none dropped)", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    const saveToDisk = vi.spyOn(wf, "saveToDisk").mockResolvedValue();
    const sync = new LiveSync(wf, "corpus/docs");
    const internals = sync as unknown as Internals;
    const first = internals.handleChange({
      added: [{ id: "one", content: "first file" }],
      modified: [],
      deleted: [],
    });
    const second = internals.handleChange({
      added: [{ id: "two", content: "second file" }],
      modified: [],
      deleted: [],
    });
    expect(sync.isPending()).toBe(true);
    await Promise.all([first, second]);
    expect(
      wf
        .listDocuments()
        .map(d => d.id)
        .sort(),
    ).toEqual(["one", "two"]);
    expect(saveToDisk).toHaveBeenCalledTimes(2);
    expect(sync.isPending()).toBe(false);
    expect(sync.getStatus()).toBe("Updated");
  });

  it("deleting a watched file keeps research session history intact", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    vi.spyOn(wf, "saveToDisk").mockResolvedValue();
    await wf.ingest([
      { id: "keep", content: "keep this braille document" },
      { id: "gone", content: "remove this braille document" },
    ]);
    await wf.run({ id: "q1", question: "braille" });
    const sync = new LiveSync(wf, "corpus/docs");
    await (sync as unknown as Internals).handleChange({
      added: [],
      modified: [],
      deleted: ["gone"],
    });
    expect(wf.listDocuments().map(d => d.id)).toEqual(["keep"]);
    expect(wf.listSessions()).toHaveLength(1);
  });

  it("runs manual syncs strictly in call order, even while another is in flight", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    const sync = new LiveSync(wf, "corpus/docs");
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = sync.runManualSync(async () => {
      order.push("first:start");
      await new Promise<void>(r => (releaseFirst = r));
      order.push("first:end");
    });
    const second = sync.runManualSync(() => {
      order.push("second");
    });
    await flush();
    expect(order).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("reports manual sync failures, then returns to Idle once the queue drains", async () => {
    vi.useFakeTimers();
    try {
      const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
      const sync = new LiveSync(wf, "corpus/docs");
      const seen: string[] = [];
      sync.onError(e => seen.push(e.operation));
      await sync.runManualSync(() => {
        throw new Error("disk full");
      });
      expect(seen).toEqual(["save"]);
      expect(sync.getStatus()).toBe("Error");
      vi.advanceTimersByTime(2000);
      expect(sync.getStatus()).toBe("Idle");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Slice 1 — HIGH-3 ErrorBoundary uninstall", () => {
  it("removes window listeners and allows a clean re-install", () => {
    const host = document.createElement("div");
    const boundary = new ErrorBoundary({ host });
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    try {
      const uninstall = boundary.installGlobalHandlers();
      expect(boundary.hasGlobalHandlers).toBe(true);
      const errorHandler = add.mock.calls.find(c => c[0] === "error")?.[1];
      const rejectionHandler = add.mock.calls.find(c => c[0] === "unhandledrejection")?.[1];

      uninstall();
      expect(boundary.hasGlobalHandlers).toBe(false);
      expect(remove).toHaveBeenCalledWith("error", errorHandler);
      expect(remove).toHaveBeenCalledWith("unhandledrejection", rejectionHandler);

      // After uninstall, a window error no longer renders the fallback.
      window.dispatchEvent(new ErrorEvent("error", { message: "after uninstall" }));
      expect(boundary.isActive).toBe(false);

      const again = boundary.installGlobalHandlers();
      expect(boundary.hasGlobalHandlers).toBe(true);
      again();
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });
});

describe("Slice 1 — HIGH-4 CorpusWatcher with browser fs stub", () => {
  afterEach(() => {
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });

  it("does not report running or record a scan error when node:fs is the empty alias", async () => {
    vi.resetModules();
    // Mirrors the Vite browser alias (src/utils/empty.ts): no callable fs functions.
    vi.doMock("node:fs/promises", () => ({ default: {}, readdir: undefined }));
    const { CorpusWatcher } = await import("../../src/retrieval/CorpusWatcher.js");
    const watcher = new CorpusWatcher("corpus/docs", () => undefined);
    await watcher.start();
    expect(watcher.isRunning()).toBe(false);
    expect(watcher.getLastError()).toBeNull();
  });
});

describe("Slice 1 — MEDIUM-1 SnapshotIndex.saveToFile", () => {
  it("rejects path-traversal attempts instead of silently returning", async () => {
    const idx = new SnapshotIndex();
    await idx.index([{ id: "d1", content: "persist me" }]);
    await expect(idx.saveToFile("../outside/index.json")).rejects.toThrow();
  });
});
