import { describe, it, expect } from "vitest";
import { CorpusWatcher } from "../../src/retrieval/CorpusWatcher.js";
import { chunkDocument } from "../../src/retrieval/chunker.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("T07.2 branch hardening", () => {
  it("CorpusWatcher with empty extensions covers branch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autosd-t07-"));
    const watcher = new CorpusWatcher(dir, async () => {}, { extensions: [] });
    const ev = await watcher.trigger();
    expect(ev.added).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  it("chunker skips middle whitespace chunk (minChunkSize branch)", () => {
    const content = "hello world this is a test\n".repeat(10);
    const chunks = chunkDocument(
      { id: "d1", content },
      { chunkSize: 15, overlap: 2, minChunkSize: 50 },
    );
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every(c => c.content.trim().length >= 50 || c.end === content.length)).toBe(true);
  });
});
