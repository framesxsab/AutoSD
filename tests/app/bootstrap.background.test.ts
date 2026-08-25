import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapApp } from "../../src/app/bootstrap.js";
import { DIContainer } from "../../src/core/DIContainer.js";

describe("bootstrapApp background mode", () => {
  let dir: string;
  let di: DIContainer;
  let stop: () => void;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "autosd-bg-"));
    di = new DIContainer();
  });

  afterEach(async () => {
    try {
      stop?.();
    } catch {}
    di.clear();
    await rm(dir, { recursive: true, force: true });
  });

  it("resolves without awaiting corpus load; ready settles restored state", async () => {
    const diSeed = new DIContainer();
    try {
      const seeded = await bootstrapApp({ di: diSeed, corpusDir: dir });
      await seeded.workflow.ingest([{ id: "d1", content: "background corpus content" }]);
      await seeded.workflow.run({ id: "q1", question: "background" });
      await seeded.workflow.saveToDisk(dir);
      seeded.stop();
    } finally {
      diSeed.clear();
    }

    const {
      workflow,
      ready,
      stop: s,
    } = await bootstrapApp({
      di,
      corpusDir: dir,
      background: true,
    });
    stop = s;

    expect(ready).toBeDefined();
    const outcome = await ready!;
    expect(outcome.restored).toBe(true);
    expect(outcome.syncStarted).toBe(true);
    expect(workflow.listDocuments().length).toBeGreaterThan(0);
  });

  it("keeps awaited v0.8 semantics by default (ready undefined)", async () => {
    const result = await bootstrapApp({ di, corpusDir: join(dir, "missing") });
    expect(result.restored).toBe(false);
    expect(result.ready).toBeUndefined();
  });
});
