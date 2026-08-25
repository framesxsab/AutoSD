import { describe, it, expect } from "vitest";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { MarketplaceWorkflow } from "../../src/workflows/marketplace.js";
import { ReaderWorkflow } from "../../src/workflows/reader.js";
import { TactileWorkflow, textToDots } from "../../src/workflows/tactile.js";
import { MockDevice } from "../../src/devices/MockDevice.js";

describe("workflows", () => {
  it("research returns citations", async () => {
    const w = new ResearchWorkflow();
    const r = await w.run({ id: "q1", question: "what is braille?" });
    expect(r.citations.length).toBeGreaterThan(0);
  });
  it("marketplace search/install", async () => {
    const m = new MarketplaceWorkflow();
    expect((await m.search("reader")).length).toBeGreaterThan(0);
    await expect(m.install("autosd-reader")).resolves.toBeDefined();
    await expect(m.install("nope")).rejects.toThrow();
  });
  it("reader paginates with aria", () => {
    const r = new ReaderWorkflow();
    const pages = r.paginate({ id: "d1", title: "Doc", content: "a".repeat(2500) }, 1000);
    expect(pages.length).toBe(3);
    expect(pages[0].ariaLabel).toContain("page 1");
  });
  it("tactile renders via any Device", async () => {
    const dev = new MockDevice("tactile-test");
    await dev.connect();
    const t = new TactileWorkflow();
    await t.renderText(dev, "hello");
    expect(dev.getLastPattern()?.length).toBeGreaterThan(0);
    expect(textToDots("hi", 5).length).toBe(5);
  });
});
