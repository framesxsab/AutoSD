import { describe, it, expect } from "vitest";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";
import { SnapshotIndex } from "../../src/retrieval/snapshot.js";
import { chunkDocument } from "../../src/retrieval/chunker.js";

const provider = () => new MockEmbeddingProvider();

describe("retrieval hardening — edge cases (C8.2)", () => {
  it("duplicate ingestion is idempotent — no duplicate chunks", async () => {
    const wf = new ResearchWorkflow({ provider: provider() });
    const doc = { id: "dup", path: "dup.md", content: "hello world hello world" };
    const a = await wf.ingest([doc]);
    const b = await wf.ingest([doc]);
    expect(b.added).toBe(0);
    expect(a.chunkCount).toBe(b.chunkCount);
  });
  it("stale snapshot state is detected — hash changes", async () => {
    const snap = new SnapshotIndex();
    await snap.index([{ id: "s", path: "s.md", content: "v1" }]);
    const h1 = snap.snapshotHash();
    await snap.index([{ id: "s", path: "s.md", content: "v2" }]);
    const h2 = snap.snapshotHash();
    expect(h1).not.toBe(h2);
  });
  it("deleted documents are removed from index", async () => {
    const snap = new SnapshotIndex();
    await snap.index([
      { id: "a", path: "a.md", content: "alpha" },
      { id: "b", path: "b.md", content: "beta" },
    ]);
    const r = await snap.index([{ id: "a", path: "a.md", content: "alpha" }]);
    expect(r.removed.length).toBeGreaterThan(0);
    expect(r.removed.every(c => c.documentId === "b")).toBe(true);
  });
  it("renamed documents (same id, new content) trigger re-chunk", async () => {
    const snap = new SnapshotIndex();
    await snap.index([{ id: "r", path: "r.md", content: "original content here" }]);
    const r = await snap.index([
      { id: "r", path: "r.md", content: "completely different content there" },
    ]);
    expect(r.added.length).toBeGreaterThan(0);
    expect(r.removed.length).toBeGreaterThan(0);
  });
  it("modified documents update manifest version", async () => {
    const snap = new SnapshotIndex();
    await snap.index([{ id: "m", path: "m.md", content: "v1" }]);
    const v1 = snap.getManifest()?.version;
    await snap.index([{ id: "m", path: "m.md", content: "v1 plus extra" }]);
    const v2 = snap.getManifest()?.version;
    expect(v1).not.toBe(v2);
  });
  it("malformed documents (empty content) do not crash", async () => {
    const wf = new ResearchWorkflow({ provider: provider() });
    const info = await wf.ingest([{ id: "empty", path: "empty.md", content: "" }]);
    expect(info.chunkCount).toBeGreaterThanOrEqual(0);
  });
  it("contradictory documents both appear in citations", async () => {
    const wf = new ResearchWorkflow({ provider: provider() });
    await wf.ingest([
      { id: "c1", path: "c1.md", content: "pins are piezoelectric fast" },
      { id: "c2", path: "c2.md", content: "pins are electromagnetic slow" },
    ]);
    const res = await wf.run({ id: "q", question: "what moves pins" });
    const ids = res.citations.map(c => c.documentId);
    expect(ids).toContain("c1");
    expect(ids).toContain("c2");
  });
  it("empty corpus returns graceful stub without throwing", async () => {
    const wf = new ResearchWorkflow({ provider: provider() });
    const res = await wf.run({ id: "q", question: "anything" });
    expect(res.citations.length).toBeGreaterThan(0);
    expect(res.confidence).toBe(0.1);
  });
  it("missing corpus (no ingest) behaves like empty corpus", async () => {
    const wf = new ResearchWorkflow({ provider: provider() });
    const res = await wf.run({ id: "q2", question: "missing" });
    expect(res.answer).toContain("no indexed corpus");
  });
  it("deterministic behavior — same ingest + query twice yields same citations", async () => {
    const wf = new ResearchWorkflow({ provider: provider() });
    await wf.ingest([{ id: "d", path: "d.md", content: "deterministic content for testing" }]);
    const a = await wf.run({ id: "q1", question: "deterministic" });
    const b = await wf.run({ id: "q2", question: "deterministic" });
    expect(a.citations.map(c => c.documentId)).toEqual(b.citations.map(c => c.documentId));
  });
  it("citation consistency — chunkId starts with documentId", async () => {
    const wf = new ResearchWorkflow({ provider: provider() });
    await wf.ingest([
      { id: "cit", path: "cit.md", content: "citation consistency check content here" },
    ]);
    const res = await wf.run({ id: "q", question: "consistency" });
    for (const c of res.citations) expect(c.chunkId.startsWith(c.documentId)).toBe(true);
  });
  it("stale results after corpus update — new query reflects new corpus", async () => {
    const wf = new ResearchWorkflow({ provider: provider() });
    await wf.ingest([{ id: "old", path: "old.md", content: "old content alpha" }]);
    const r1 = await wf.run({ id: "q1", question: "alpha" });
    expect(r1.citations[0].documentId).toBe("old");
    await wf.ingest([{ id: "fresh", path: "fresh.md", content: "fresh content beta beta beta" }]);
    const r2 = await wf.run({ id: "q2", question: "beta" });
    expect(r2.citations[0].documentId).toBe("fresh");
  });
  it("chunking deterministic — same doc yields same chunks", () => {
    const doc = { id: "ch", path: "ch.md", content: "chunk deterministic test ".repeat(50) };
    const a = chunkDocument(doc, { chunkSize: 100, overlap: 20 });
    const b = chunkDocument(doc, { chunkSize: 100, overlap: 20 });
    expect(a.map(c => c.id)).toEqual(b.map(c => c.id));
    expect(a.map(c => c.content)).toEqual(b.map(c => c.content));
  });
});
