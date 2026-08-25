/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapApp, WORKFLOW_TOKEN } from "../../src/app/bootstrap.js";
import { DIContainer } from "../../src/core/DIContainer.js";

describe("App bootstrap", () => {
  let dir: string;
  let di: DIContainer;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "autosd-app-"));
    di = new DIContainer();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    di.clear();
  });

  it("auto loadFromDisk restores sessions and handles empty corpus", async () => {
    const { workflow, restored } = await bootstrapApp({ di, corpusDir: dir });
    expect(restored).toBe(false);
    expect(workflow.listDocuments()).toHaveLength(0);
    await workflow.ingest([{ id: "d1", content: "hello world" }]);
    await workflow.run({ id: "q1", question: "hello" });
    await workflow.saveToDisk(dir);

    const di2 = new DIContainer();
    const { workflow: wf2, restored: r2 } = await bootstrapApp({ di: di2, corpusDir: dir });
    expect(r2).toBe(true);
    expect(wf2.listDocuments()).toHaveLength(1);
    expect(wf2.listSessions()).toHaveLength(1);
    expect(di2.has(WORKFLOW_TOKEN)).toBe(true);
  });

  it("singleton reuse via DI", async () => {
    const { workflow: w1 } = await bootstrapApp({ di, corpusDir: dir });
    const { workflow: w2 } = await bootstrapApp({ di, corpusDir: dir });
    expect(w1).toBe(w2);
  });

  it("gracefully handles empty corpus dir", async () => {
    const { workflow } = await bootstrapApp({ di, corpusDir: join(dir, "missing") });
    const res = await workflow.run({ id: "q1", question: "anything" });
    expect(res.confidence).toBe(0.1);
  });
});
