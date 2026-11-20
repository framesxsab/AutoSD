import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RetrievalPipeline } from "../../src/retrieval/pipeline.js";
import type { EmbeddingProvider } from "../../src/retrieval/embedder.js";
import { LexicalHashEmbeddingProvider } from "../../src/retrieval/providers/LexicalHashEmbeddingProvider.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import {
  textToBraille,
  dotsToUnicodeBraille,
  TactileWorkflow,
} from "../../src/workflows/tactile.js";
import { ReaderWorkflow } from "../../src/workflows/reader.js";
import { VirtualDevice } from "../../src/devices/VirtualDevice.js";

describe("v1.2 Wave 1 & Tactile core improvements", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "autosd-v12-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("batches embeddings via embedMany and deduplicates re-ingested document chunks", async () => {
    const base = new LexicalHashEmbeddingProvider();
    const embedSpy = vi.fn((t: string) => base.embed(t));
    const embedManySpy = vi.fn((texts: string[]) => base.embedMany(texts));
    const spyProvider: EmbeddingProvider = {
      id: base.id,
      model: base.model,
      dimensions: base.dimensions,
      embed: embedSpy,
      embedMany: embedManySpy,
    };

    const pipe = new RetrievalPipeline(spyProvider, { chunkSize: 80, overlap: 10 });
    await pipe.ingest([
      { id: "d1", content: "First sentence about tactile braille. ".repeat(4) },
      { id: "d2", content: "Second document about hybrid search ranking." },
    ]);

    expect(embedManySpy).toHaveBeenCalledTimes(1);
    expect(embedSpy).not.toHaveBeenCalled();

    const beforeCount = pipe.getChunks().filter(c => c.documentId === "d1").length;
    expect(beforeCount).toBeGreaterThan(1);

    // Re-ingest d1 with shorter single-chunk content — old chunks must be replaced, not duplicated
    await pipe.ingest([{ id: "d1", content: "Short updated d1 body." }]);
    const d1Chunks = pipe.getChunks().filter(c => c.documentId === "d1");
    expect(d1Chunks).toHaveLength(1);
    expect(d1Chunks[0].content).toBe("Short updated d1 body.");
  });

  it("filters search by documentIds across hybrid, bm25, and vector modes", async () => {
    const pipe = new RetrievalPipeline(new LexicalHashEmbeddingProvider(), { topK: 5 });
    await pipe.ingest([
      { id: "doc-a", content: "braille display actuators and pins" },
      { id: "doc-b", content: "braille display software pagination" },
      { id: "doc-c", content: "completely unrelated cooking topic" },
    ]);

    for (const mode of ["hybrid", "bm25", "vector"] as const) {
      const scoped = await pipe.search("braille display", { mode, documentIds: ["doc-b"] });
      expect(scoped.length).toBeGreaterThan(0);
      expect(scoped.every(r => r.chunk.documentId === "doc-b")).toBe(true);

      const emptyScope = await pipe.search("braille display", { mode, documentIds: [] });
      expect(emptyScope).toEqual([]);
    }
  });

  it("preserves prior documents across incremental single-doc ingest and removes cleanly", async () => {
    const wf = new ResearchWorkflow({
      provider: new LexicalHashEmbeddingProvider(),
      reranker: true,
    });
    await wf.ingest([{ id: "doc-1", path: "one.md", content: "Piezoelectric braille pins." }]);
    await wf.ingest([{ id: "doc-2", path: "two.md", content: "Screen reader landmarks." }]);

    expect(wf.listDocuments().map(d => d.id)).toEqual(["doc-1", "doc-2"]);
    expect(wf.getManifest()?.documentCount).toBe(2);

    // Query scoped to doc-1 returns only doc-1
    const scoped = await wf.run({
      id: "q-scope",
      question: "landmarks or pins",
      corpusIds: ["doc-1"],
    });
    expect(scoped.citations.every(c => c.documentId === "doc-1")).toBe(true);
    expect(scoped.answer).toContain("Piezoelectric braille pins");
    expect(scoped.answer).toContain("[doc-1#0]");

    const removed = await wf.removeDocument("doc-1");
    expect(removed).toBe(true);
    expect(wf.listDocuments().map(d => d.id)).toEqual(["doc-2"]);
    expect(wf.getManifest()?.documentCount).toBe(1);
    expect(await wf.removeDocument("missing")).toBe(false);
  });

  it("losslessly reconstructs multi-chunk documents on saveToDisk/loadFromDisk and toPersistedState/fromPersistedState", async () => {
    const longContent = Array.from(
      { length: 30 },
      (_, i) => `Sentence number ${i + 1} describes tactile braille cell rendering in detail.`,
    ).join(" ");
    expect(longContent.length).toBeGreaterThan(1500);

    const wf1 = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf1.ingest([{ id: "long-doc", path: "docs/long.md", content: longContent }]);
    await wf1.run({ id: "q-long", question: "tactile braille cell rendering" });
    await wf1.saveToDisk(dir);

    const wf2 = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    const loadedDisk = await wf2.loadFromDisk(dir);
    expect(loadedDisk).toBe(true);
    const restoredDoc = wf2.getDocument("long-doc");
    expect(restoredDoc?.path).toBe("docs/long.md");
    expect(restoredDoc?.content).toBe(longContent);
    expect(wf2.listSessions()).toHaveLength(1);

    const wf3 = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf3.fromPersistedState(wf1.toPersistedState());
    expect(wf3.getDocument("long-doc")?.content).toBe(longContent);
    expect(wf3.listSessions()).toHaveLength(1);
  });

  it("encodes UEB Grade 1 Braille deterministically and renders onto VirtualDevice", async () => {
    const encoded = textToBraille("Abc 12!", 20);
    expect(encoded.cells).toHaveLength(20);
    // A = capital(⠠ 0x20) + a(⠁ 0x01), b(⠃), c(⠉), space(⠀), number(⠼) + a(⠁) + b(⠃), !(⠖)
    expect(encoded.unicode).toBe("⠠⠁⠃⠉⠀⠼⠁⠃⠖");
    expect(dotsToUnicodeBraille([0x01, 0x03, 0x09])).toBe("⠁⠃⠉");

    const dev = new VirtualDevice("v-braille", "BrailleSim", 20);
    await dev.connect();
    const tactile = new TactileWorkflow();
    const res = await tactile.renderBraille(dev, "Hi 5");
    expect(res.unicode).toBe("⠠⠓⠊⠀⠼⠑");
    expect(dev.snapshot().slice(0, 6)).toEqual(res.cells.slice(0, 6));
  });

  it("paginates on word boundaries when wordBoundary option is enabled", () => {
    const reader = new ReaderWorkflow();
    const pages = reader.paginate(
      {
        id: "r1",
        title: "Word Boundary",
        content: "alpha bravo charlie delta echo foxtrot golf hotel",
      },
      { charsPerPage: 20, wordBoundary: true },
    );
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0].text.endsWith(" ")).toBe(true);
    expect(pages.map(p => p.text).join("")).toBe(
      "alpha bravo charlie delta echo foxtrot golf hotel",
    );
  });
});
