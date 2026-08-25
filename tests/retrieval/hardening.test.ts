import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CorpusWatcher } from "../../src/retrieval/CorpusWatcher.js";
import { SnapshotIndex } from "../../src/retrieval/snapshot.js";
import { chunkDocument } from "../../src/retrieval/chunker.js";

describe("T06.5 hardening — uncovered branches", () => {
  it("CorpusWatcher start success vs failure path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autosd-hard-"));
    const watcherOk = new CorpusWatcher(dir, async () => {}, { debounceMs: 10 });
    await watcherOk.start();
    expect(watcherOk.isRunning()).toBe(true);
    watcherOk.stop();
    expect(watcherOk.isRunning()).toBe(false);

    const missing = join(dir, "nope");
    const watcherFail = new CorpusWatcher(missing, async () => {}, { debounceMs: 10 });
    await watcherFail.start();
    expect(watcherFail.isRunning()).toBe(true);
    expect((watcherFail as unknown as { watcher?: unknown }).watcher).toBeUndefined();
    watcherFail.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it("Snapshot legacy-format vs full-state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autosd-snap-"));
    const idx = new SnapshotIndex();
    await idx.index([{ id: "d1", content: "hello", path: "/a.md" }]);
    const manifest = idx.getManifest()!;
    // Legacy manifest-only file
    const legacyPath = join(dir, "legacy.json");
    await writeFile(legacyPath, JSON.stringify(manifest), "utf8");
    const idx2 = new SnapshotIndex();
    expect(await idx2.loadFromFile(legacyPath)).toBe(true);
    expect(idx2.getVersion()).toBe(manifest.version);
    // Full-state file
    const fullPath = join(dir, "full.json");
    await idx.saveToFile(fullPath);
    const idx3 = new SnapshotIndex();
    expect(await idx3.loadFromFile(fullPath)).toBe(true);
    expect(idx3.getVersion()).toBe(idx.getVersion());
    // Malformed (neither format) → false
    const badPath = join(dir, "bad.json");
    await writeFile(badPath, JSON.stringify({ foo: "bar" }), "utf8");
    const idx4 = new SnapshotIndex();
    expect(await idx4.loadFromFile(badPath)).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  it("Chunker minimum-size edge and overlap clamp", () => {
    const tiny = chunkDocument(
      { id: "d1", content: "   \n   \n" + "a".repeat(50) },
      { chunkSize: 10, overlap: 2, minChunkSize: 20 },
    );
    expect(tiny.length).toBeGreaterThan(0);
    expect(
      tiny.every(
        c => c.content.trim().length >= 20 || c.end === ("   \n   \n" + "a".repeat(50)).length,
      ),
    ).toBe(true);
    const noFilter = chunkDocument(
      { id: "d1", content: "hello world test" },
      { chunkSize: 5, overlap: 1 },
    );
    expect(noFilter.length).toBeGreaterThan(0);
    const lastShort = chunkDocument(
      { id: "d1", content: "abcdefghij".repeat(3) + "xy" },
      { chunkSize: 10, overlap: 2, minChunkSize: 20 },
    );
    expect(lastShort.length).toBeGreaterThan(0);
    expect(lastShort[lastShort.length - 1].end).toBe(("abcdefghij".repeat(3) + "xy").length);
    const clamped = chunkDocument(
      { id: "d1", content: "a".repeat(500) },
      { chunkSize: 100, overlap: 150 },
    );
    expect(clamped.length).toBeGreaterThan(1);
  });
});
