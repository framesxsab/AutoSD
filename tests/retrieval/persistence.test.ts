import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SnapshotIndex } from "../../src/retrieval/snapshot.js";
import { saveManifest, loadManifest, saveJson, loadJson } from "../../src/retrieval/persistence.js";

describe("persistence", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "autosd-persist-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("save/load manifest round-trip", async () => {
    const idx = new SnapshotIndex();
    await idx.index([{ id: "d1", content: "hello", path: "/a.md" }]);
    const manifest = idx.getManifest()!;
    const file = join(dir, "index.json");
    await saveManifest(file, manifest);
    const loaded = await loadManifest(file);
    expect(loaded?.version).toBe(manifest.version);
    expect(loaded?.documents[0].id).toBe("d1");
  });

  it("loadManifest returns null on missing/broken", async () => {
    expect(await loadManifest(join(dir, "missing.json"))).toBeNull();
    const bad = join(dir, "bad.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(bad, "not json", "utf8");
    expect(await loadManifest(bad)).toBeNull();
  });

  it("saveJson/loadJson round-trip", async () => {
    const file = join(dir, "data.json");
    await saveJson(file, { a: 1 });
    expect(await loadJson(file)).toEqual({ a: 1 });
    expect(await loadJson(join(dir, "nope.json"))).toBeNull();
  });

  it("SnapshotIndex saveToFile/loadFromFile preserves versioning and hashes", async () => {
    const idx = new SnapshotIndex();
    await idx.index([{ id: "d1", content: "hello" }]);
    const file = join(dir, "index.json");
    await idx.saveToFile(file);
    const idx2 = new SnapshotIndex();
    const ok = await idx2.loadFromFile(file);
    expect(ok).toBe(true);
    expect(idx2.getVersion()).toBe(idx.getVersion());
    expect(idx2.getChunks()).toHaveLength(1);
    // incremental: unchanged not re-added
    const r = await idx2.index([{ id: "d1", content: "hello" }]);
    expect(r.added).toHaveLength(0);
  });

  it("loadFromFile supports legacy manifest-only", async () => {
    const idx = new SnapshotIndex();
    await idx.index([{ id: "d1", content: "hello", path: "/a.md" }]);
    const manifest = idx.getManifest()!;
    const file = join(dir, "legacy.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, JSON.stringify(manifest), "utf8");
    const idx2 = new SnapshotIndex();
    expect(await idx2.loadFromFile(file)).toBe(true);
    expect(idx2.getVersion()).toBe(manifest.version);
  });

  it("loadFromFile returns false on missing/bad", async () => {
    const idx = new SnapshotIndex();
    expect(await idx.loadFromFile(join(dir, "missing.json"))).toBe(false);
    const bad = join(dir, "bad.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(bad, "not json", "utf8");
    expect(await idx.loadFromFile(bad)).toBe(false);
  });

  it("ResearchWorkflow saveToDisk/loadFromDisk", async () => {
    const { ResearchWorkflow } = await import("../../src/workflows/research.js");
    const { MockEmbeddingProvider } =
      await import("../../src/retrieval/providers/MockEmbeddingProvider.js");
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([{ id: "d1", content: "hello world" }]);
    await wf.run({ id: "q1", question: "hello" });
    await wf.saveToDisk(dir);
    const wf2 = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    const ok = await wf2.loadFromDisk(dir);
    expect(ok).toBe(true);
    expect(wf2.listDocuments()).toHaveLength(1);
    expect(wf2.listSessions()).toHaveLength(1);
    expect(await wf2.loadFromDisk(join(dir, "missing"))).toBe(false);
  });
});
