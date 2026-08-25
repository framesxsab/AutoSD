import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CorpusWatcher } from "../../src/retrieval/CorpusWatcher.js";

describe("CorpusWatcher", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "autosd-watch-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("detects added and modified via trigger", async () => {
    const watcher = new CorpusWatcher(dir, async () => {}, { debounceMs: 10 });
    // initial scan empty
    let ev = await watcher.trigger();
    expect(ev.added).toHaveLength(0);

    await writeFile(join(dir, "a.md"), "hello", "utf8");
    ev = await watcher.trigger();
    expect(ev.added).toHaveLength(1);
    expect(ev.added[0].id).toBe("a");

    await writeFile(join(dir, "a.md"), "hello changed", "utf8");
    ev = await watcher.trigger();
    expect(ev.modified).toHaveLength(1);
    expect(ev.modified[0].id).toBe("a");

    await writeFile(join(dir, "b.txt"), "second", "utf8");
    ev = await watcher.trigger();
    expect(ev.added.some(d => d.id === "b")).toBe(true);
  });

  it("detects deleted", async () => {
    await writeFile(join(dir, "a.md"), "hello", "utf8");
    const watcher = new CorpusWatcher(dir, async () => {}, { debounceMs: 10 });
    await watcher.trigger();
    await unlink(join(dir, "a.md"));
    const ev = await watcher.trigger();
    expect(ev.deleted).toContain("a");
  });

  it("debounces fs events and calls onChange", async () => {
    const onChange = vi.fn(async () => {});
    const watcher = new CorpusWatcher(dir, onChange, { debounceMs: 20, extensions: [".md"] });
    await watcher.start();
    expect(watcher.isRunning()).toBe(true);
    await writeFile(join(dir, "x.md"), "one", "utf8");
    // wait for debounce + scan
    await new Promise(r => setTimeout(r, 80));
    expect(onChange).toHaveBeenCalled();
    watcher.stop();
    expect(watcher.isRunning()).toBe(false);
  });

  it("ignores dotfiles and filters extensions", async () => {
    const watcher = new CorpusWatcher(dir, async () => {}, {
      extensions: [".md"],
      ignoreDotfiles: true,
    });
    await writeFile(join(dir, ".hidden.md"), "secret", "utf8");
    await writeFile(join(dir, "keep.md"), "keep", "utf8");
    await writeFile(join(dir, "ignore.json"), "{}", "utf8");
    const ev = await watcher.trigger();
    expect(ev.added.some(d => d.id === ".hidden")).toBe(false);
    expect(ev.added.some(d => d.id === "ignore")).toBe(false);
    expect(ev.added.some(d => d.id === "keep")).toBe(true);
  });

  it("handles missing dir gracefully", async () => {
    const watcher = new CorpusWatcher(join(dir, "missing"), async () => {});
    const ev = await watcher.trigger();
    expect(ev.added).toHaveLength(0);
  });

  it("start idempotent", async () => {
    const watcher = new CorpusWatcher(dir, async () => {});
    await watcher.start();
    await watcher.start();
    expect(watcher.isRunning()).toBe(true);
    watcher.stop();
  });
});
