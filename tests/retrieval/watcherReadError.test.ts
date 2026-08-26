import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CorpusWatcher } from "../../src/retrieval/CorpusWatcher.js";

// Partial mock: real fs everywhere except stat(), which fails for one
// attacker/OS-controlled path. This simulates the real-world race where a file
// disappears (or becomes unreadable) between readdir and stat during a scan.
const statFail = vi.hoisted(() => ({ target: null as string | null }));

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const stat = ((path: string, options?: { throwIfNoEntry?: boolean }) => {
    if (statFail.target !== null && path === statFail.target) {
      return Promise.reject(new Error("simulated stat failure"));
    }
    return actual.stat(path, options);
  }) as typeof actual.stat;
  return { ...actual, default: actual, stat };
});

describe("CorpusWatcher read-error resilience", () => {
  let dir: string;
  let watcher: CorpusWatcher | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "autosd-readerr-"));
  });

  afterEach(async () => {
    statFail.target = null;
    watcher?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it("records a read error and keeps the rest of the scan intact when stat fails", async () => {
    await writeFile(join(dir, "healthy.md"), "healthy content", "utf8");
    const doomed = join(dir, "doomed.md");
    await writeFile(doomed, "will fail on stat", "utf8");

    statFail.target = doomed;
    watcher = new CorpusWatcher(dir, async () => {});

    const ev = await watcher.trigger();
    // doomed.md is skipped, healthy.md still indexed
    expect(ev.added.map(d => d.id)).toEqual(["healthy"]);
    expect(ev.modified).toHaveLength(0);

    const err = watcher.getLastError();
    expect(err?.operation).toBe("read");
    expect(err?.path).toBe(doomed);
    expect((err?.error as Error).message).toContain("simulated stat failure");
  });

  it("scans normally once the failing path is cleared", async () => {
    const target = join(dir, "flaky.md");
    await writeFile(target, "recovers", "utf8");

    statFail.target = target;
    watcher = new CorpusWatcher(dir, async () => {});
    expect((await watcher.trigger()).added).toHaveLength(0);

    statFail.target = null;
    const ev = await watcher.trigger();
    expect(ev.added.map(d => d.id)).toEqual(["flaky"]);
    expect(watcher.getLastError()?.operation).toBe("read"); // last error retained until next success scan
  });
});
