import { describe, it, expect } from "vitest";
import { SnapshotIndex, nextVersion, hashDocument } from "../../src/retrieval/snapshot.js";

describe("hashDocument/nextVersion", () => {
  it("stable hash", () => {
    expect(hashDocument({ id: "d1", content: "hello" })).toBe(
      hashDocument({ id: "d1", content: "hello" }),
    );
    expect(hashDocument({ id: "d1", content: "hello" })).not.toBe(
      hashDocument({ id: "d1", content: "world" }),
    );
  });
  it("nextVersion bumps patch", () => {
    expect(nextVersion()).toBe("1.0.0");
    expect(nextVersion("1.0.0")).toBe("1.0.1");
    expect(nextVersion("2.3.9")).toBe("2.3.10");
  });
});

describe("SnapshotIndex incremental", () => {
  it("indexes new docs and increments version", async () => {
    const idx = new SnapshotIndex();
    const r1 = await idx.index([{ id: "d1", content: "hello world" }]);
    expect(r1.added.length).toBe(1);
    expect(r1.removed.length).toBe(0);
    expect(r1.manifest.version).toBe("1.0.0");
    expect(idx.getVersion()).toBe("1.0.0");
    expect(idx.getChunks().length).toBe(1);
  });

  it("never re-indexes unchanged files", async () => {
    const idx = new SnapshotIndex();
    await idx.index([{ id: "d1", content: "hello" }]);
    const r2 = await idx.index([{ id: "d1", content: "hello" }]);
    expect(r2.added).toHaveLength(0);
    expect(r2.removed).toHaveLength(0);
    expect(r2.unchanged).toContain("d1");
  });

  it("detects changed content", async () => {
    const idx = new SnapshotIndex();
    await idx.index([{ id: "d1", content: "hello" }]);
    const r2 = await idx.index([{ id: "d1", content: "hello changed" }]);
    expect(r2.added).toHaveLength(1);
    expect(r2.removed).toHaveLength(1);
    expect(r2.manifest.version).toBe("1.0.1");
  });

  it("detects removed documents", async () => {
    const idx = new SnapshotIndex();
    await idx.index([
      { id: "d1", content: "a" },
      { id: "d2", content: "b" },
    ]);
    const r2 = await idx.index([{ id: "d1", content: "a" }]);
    expect(r2.removed.length).toBe(1);
    expect(idx.getChunks().every(c => c.documentId !== "d2")).toBe(true);
  });

  it("snapshotHash stable", async () => {
    const idx = new SnapshotIndex();
    await idx.index([{ id: "d1", content: "hello" }]);
    const h1 = idx.snapshotHash();
    await idx.index([{ id: "d1", content: "hello" }]);
    expect(idx.snapshotHash()).toBe(h1);
    await idx.index([{ id: "d1", content: "world" }]);
    expect(idx.snapshotHash()).not.toBe(h1);
  });

  it("exportManifest and list", async () => {
    const idx = new SnapshotIndex();
    await idx.index([{ id: "d1", content: "hello", path: "/tmp/a.md" }]);
    const json = idx.exportManifest();
    expect(JSON.parse(json).version).toBe("1.0.0");
    expect(idx.listManifests()).toHaveLength(1);
    expect(() => idx.exportManifest("9.9.9")).toThrow();
  });

  it("handles long docs split into multiple chunks", async () => {
    const idx = new SnapshotIndex();
    const content = "x ".repeat(1000);
    const r = await idx.index([{ id: "d1", content }]);
    expect(r.added.length).toBeGreaterThan(1);
    expect(r.manifest.chunkCount).toBeGreaterThan(1);
    expect(r.manifest.documentCount).toBe(1);
  });

  it("clear resets", async () => {
    const idx = new SnapshotIndex();
    await idx.index([{ id: "d1", content: "hi" }]);
    idx.clear();
    expect(idx.getVersion()).toBe("0.0.0");
    expect(idx.getChunks()).toHaveLength(0);
    expect(idx.listManifests()).toHaveLength(0);
  });

  it("empty index throws on export", () => {
    const idx = new SnapshotIndex();
    expect(() => idx.exportManifest()).toThrow("no manifest");
  });
});
