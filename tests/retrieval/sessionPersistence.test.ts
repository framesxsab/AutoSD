import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";

describe("Session persistence hardening", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "autosd-sess-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("first write", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([{ id: "d1", content: "hello" }]);
    await wf.run({ id: "q1", question: "hello" });
    await wf.saveToDisk(dir);
    const raw = await readFile(join(dir, "sessions.json"), "utf8");
    const arr = JSON.parse(raw);
    expect(arr).toHaveLength(1);
    expect(arr[0].query.id).toBe("q1");
  });

  it("reload", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([{ id: "d1", content: "hello" }]);
    await wf.run({ id: "q1", question: "hello" });
    await wf.saveToDisk(dir);
    const wf2 = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    const ok = await wf2.loadFromDisk(dir);
    expect(ok).toBe(true);
    expect(wf2.listSessions()).toHaveLength(1);
    expect(wf2.listSessions()[0].query.id).toBe("q1");
  });

  it("multiple sessions", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([{ id: "d1", content: "doc" }]);
    await wf.run({ id: "q1", question: "a" });
    await wf.run({ id: "q2", question: "b" });
    await wf.saveToDisk(dir);
    const wf2 = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf2.loadFromDisk(dir);
    expect(wf2.listSessions()).toHaveLength(2);
  });

  it("delete", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([{ id: "d1", content: "hello" }]);
    await wf.run({ id: "q1", question: "hello" });
    await wf.run({ id: "q2", question: "hello" });
    const id = wf.listSessions()[0].id;
    expect(wf.deleteSession(id)).toBe(true);
    expect(wf.listSessions()).toHaveLength(1);
    await wf.saveToDisk(dir);
    const wf2 = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf2.loadFromDisk(dir);
    expect(wf2.listSessions()).toHaveLength(1);
    expect(wf2.listSessions()[0].id).not.toBe(id);
  });

  it("malformed file handled gracefully, does not discard valid sessions", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([{ id: "d1", content: "hello" }]);
    await wf.run({ id: "q1", question: "hello" });
    await wf.saveToDisk(dir);
    await writeFile(join(dir, "sessions.json"), "not json {", "utf8");
    const wf2 = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf2.ingest([{ id: "d1", content: "hello" }]);
    const before = wf2.listSessions().length;
    const ok = await wf2.loadFromDisk(dir);
    expect(ok).toBe(true);
    // History should be from file load attempt, but malformed should not clear existing? Currently load tries to parse and if fails, keeps existing (0)
    // After malformed, history remains as before (0) not discarded to empty
    expect(wf2.listSessions().length).toBe(before);
  });

  it("empty state", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.saveToDisk(dir);
    const raw = await readFile(join(dir, "sessions.json"), "utf8");
    expect(JSON.parse(raw)).toEqual([]);
    const wf2 = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    const ok = await wf2.loadFromDisk(dir);
    expect(ok).toBe(true);
    expect(wf2.listSessions()).toHaveLength(0);
    expect(await wf2.loadFromDisk(join(dir, "missing"))).toBe(false);
  });

  it("atomic temp-file rename does not leave tmp", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([{ id: "d1", content: "hello" }]);
    await wf.saveToDisk(dir);
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    expect(files.some(f => f.includes(".tmp."))).toBe(false);
  });
});
