import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CorpusWatcher, type WatcherErrorEvent } from "../../src/retrieval/CorpusWatcher.js";
import { SnapshotIndex, nextVersion } from "../../src/retrieval/snapshot.js";
import { chunkDocument, chunkDocuments, hashContent } from "../../src/retrieval/chunker.js";
import { RetrievalPipeline } from "../../src/retrieval/pipeline.js";
import { BM25Index } from "../../src/retrieval/bm25.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";
import { OpenAIEmbeddingProvider } from "../../src/retrieval/providers/OpenAIEmbeddingProvider.js";
import * as retrievalPublicApi from "../../src/retrieval/index.js";
import * as providerPublicApi from "../../src/retrieval/providers/index.js";
import type { IndexManifest } from "../../src/retrieval/types.js";

describe("v1.0 hardening — genuine missing branches", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "autosd-v1-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("CorpusWatcher error listener contract", () => {
    it("unsubscribe removes the listener while others keep receiving events", async () => {
      const missingDir = join(dir, "does-not-exist");
      const watcher = new CorpusWatcher(missingDir, async () => {});
      const received: WatcherErrorEvent[] = [];
      const noisy = (): void => {
        throw new Error("listener exploded");
      };
      const offNoisy = watcher.onError(noisy);
      const offGood = watcher.onError(e => received.push(e));

      // Throwing listener is still subscribed -> must not break dispatch.
      const ev = await watcher.trigger();
      expect(ev.added).toHaveLength(0);
      expect(ev.modified).toHaveLength(0);
      expect(received).toHaveLength(1);
      expect(received[0].operation).toBe("scan");
      expect(watcher.getLastError()?.operation).toBe("scan");

      offNoisy();
      await watcher.trigger();
      expect(received).toHaveLength(2);

      offGood();
      await watcher.trigger();
      expect(received).toHaveLength(2); // unsubscribed listener no longer notified
    });

    it("skips entries whose stat says they are not regular files", async () => {
      await mkdir(join(dir, "notes.md"), { recursive: true }); // directory wearing a tracked extension
      await writeFile(join(dir, "real.md"), "real content", "utf8");
      const watcher = new CorpusWatcher(dir, async () => {});
      const ev = await watcher.trigger();
      expect(ev.added.map(d => d.id)).toEqual(["real"]);
    });

    it("keeps running and records an error when onChange rejects (default debounce)", async () => {
      const onChange = vi.fn(async () => {
        throw new Error("onChange exploded");
      });
      // No debounceMs option -> exercises the 150ms default branch.
      const watcher = new CorpusWatcher(dir, onChange);
      await watcher.start();
      try {
        await writeFile(join(dir, "boom.md"), "trigger content", "utf8");
        await vi.waitFor(() => expect(watcher.getLastError()?.operation).toBe("onChange"), {
          timeout: 4000,
          interval: 50,
        });
        expect(onChange).toHaveBeenCalled();
        expect((watcher.getLastError()?.error as Error).message).toContain("onChange exploded");
        expect(watcher.isRunning()).toBe(true); // watcher loop survives handler failure
      } finally {
        watcher.stop();
      }
    });
  });

  describe("chunker batch API", () => {
    it("chunkDocuments flattens per-document chunks and skips empty documents", () => {
      const docs = [
        { id: "a", content: "first document body", path: "/a.md" },
        { id: "empty", content: "", path: "/empty.md" },
        { id: "b", content: "second document body", path: "/b.md" },
      ];
      const chunks = chunkDocuments(docs);
      expect(chunks.map(c => c.id)).toEqual(["a#0", "b#0"]);
      expect(chunks[0].documentId).toBe("a");
      const single = chunkDocument(docs[0]);
      expect(chunks[0].hash).toBe(single[0].hash);
    });
  });

  describe("SnapshotIndex persistence edges", () => {
    it("saveToFile resolves silently when the target directory cannot be created", async () => {
      const blocker = join(dir, "blocker.txt");
      await writeFile(blocker, "a file, not a directory", "utf8");
      const idx = new SnapshotIndex();
      await idx.index([{ id: "d1", content: "persist me", path: "/d1.md" }]);
      const before = idx.getChunks().length;
      await expect(idx.saveToFile(join(blocker, "nested", "index.json"))).resolves.toBeUndefined();
      expect(idx.getChunks()).toHaveLength(before); // state untouched by failed save
    });

    it("nextVersion patches patch segment when minor-only version supplied", () => {
      expect(nextVersion()).toBe("1.0.0");
      expect(nextVersion("1.0")).toBe("1.0.1");
      expect(nextVersion("2.3.7")).toBe("2.3.8");
    });

    it("re-indexing after legacy manifest hydration tolerates missing chunk state", async () => {
      const content = "legacy hydration content used for stable hashing";
      const hash = hashContent(content);
      const legacy: IndexManifest = {
        version: "3.1.4",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        chunkCount: 0,
        documentCount: 1,
        documents: [
          {
            id: "legacy",
            path: "/legacy.md",
            hash,
            chunkIds: [],
            indexedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        config: { chunkSize: 800, overlap: 120, embeddingModel: "mock-384" },
      };
      const legacyPath = join(dir, "legacy.json");
      await writeFile(legacyPath, JSON.stringify(legacy), "utf8");

      const idx = new SnapshotIndex();
      expect(await idx.loadFromFile(legacyPath)).toBe(true);
      expect(idx.getVersion()).toBe("3.1.4");
      expect(idx.getChunks()).toHaveLength(0); // legacy format carries no chunk bodies

      // Same doc, same hash -> unchanged, but no stored chunks -> manifest entry gets []
      const r1 = await idx.index([{ id: "legacy", content, path: "/legacy.md" }]);
      expect(r1.unchanged).toEqual(["legacy"]);
      expect(r1.manifest.documents[0].chunkIds).toEqual([]);
      expect(idx.getVersion()).toBe("3.1.5");

      // Doc disappears -> removal path runs with no stored chunks to remove
      const r2 = await idx.index([]);
      expect(r2.removed).toHaveLength(0);
      expect(r2.manifest.documentCount).toBe(0);
    });
  });

  describe("RetrievalPipeline BM25 accessor", () => {
    it("exposes the live BM25 index used by search", async () => {
      const pipe = new RetrievalPipeline(new MockEmbeddingProvider(), { topK: 3 });
      const bm25 = pipe.getBM25();
      expect(bm25).toBeInstanceOf(BM25Index);
      expect(bm25.size()).toBe(0);
      await pipe.ingest([
        { id: "d1", content: "indexable content for lexical search", path: "/d.md" },
      ]);
      expect(bm25.size()).toBe(1);
      const hits = bm25.search("indexable");
      expect(hits).toHaveLength(1);
      expect(hits[0].chunk.documentId).toBe("d1");
    });
  });

  describe("public API surface", () => {
    it("retrieval barrel re-exports the documented runtime symbols", () => {
      expect(retrievalPublicApi.BM25Index).toBe(BM25Index);
      expect(retrievalPublicApi.RetrievalPipeline).toBe(RetrievalPipeline);
      expect(retrievalPublicApi.SnapshotIndex).toBe(SnapshotIndex);
      expect(typeof retrievalPublicApi.chunkDocument).toBe("function");
      expect(typeof retrievalPublicApi.hashContent).toBe("function");
      expect(retrievalPublicApi.MockEmbeddingProvider).toBe(MockEmbeddingProvider);
      expect(retrievalPublicApi.OpenAIEmbeddingProvider).toBe(OpenAIEmbeddingProvider);
    });

    it("providers barrel re-exports all three embedding providers", () => {
      expect(providerPublicApi.MockEmbeddingProvider).toBe(MockEmbeddingProvider);
      expect(providerPublicApi.OpenAIEmbeddingProvider).toBe(OpenAIEmbeddingProvider);
      expect(typeof providerPublicApi.LocalEmbeddingProvider).toBe("function");
    });
  });

  describe("OpenAIEmbeddingProvider environment configuration", () => {
    it("isConfigured reflects OPENAI_API_KEY presence at construction time", () => {
      try {
        vi.stubEnv("OPENAI_API_KEY", "");
        expect(new OpenAIEmbeddingProvider().isConfigured()).toBe(false);
        vi.stubEnv("OPENAI_API_KEY", "sk-env-provided-key-1234567890");
        expect(new OpenAIEmbeddingProvider().isConfigured()).toBe(true);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
