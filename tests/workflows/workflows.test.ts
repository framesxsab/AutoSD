import { describe, it, expect } from "vitest";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { MarketplaceWorkflow } from "../../src/workflows/marketplace.js";
import { ReaderWorkflow } from "../../src/workflows/reader.js";
import {
  measureBrailleCells,
  TactileWorkflow,
  textToDots,
  wrapTextToBrailleLines,
} from "../../src/workflows/tactile.js";
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
  it("M4 cell-aware braille measurement, line wrapping, and pagination respect capital/number signs", async () => {
    // "Hi 12" => 'H' (2 cells: capital + h), 'i' (1), ' ' (1), '12' (3 cells: number sign + a + b) = 7 cells
    expect(measureBrailleCells("Hi 12")).toBe(7);

    const lines = wrapTextToBrailleLines(
      "AutoSD tactile reader wraps Grade 1 Braille cleanly across display cells.",
      20,
    );
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) {
      expect(line.activeCells).toBeLessThanOrEqual(20);
      expect(line.cells.length).toBe(20);
    }

    const dev = new MockDevice("braille-line-dev");
    await dev.connect();
    const t = new TactileWorkflow();
    const rendered = await t.renderBrailleLines(dev, "Hello Braille World 2026");
    expect(rendered.length).toBeGreaterThan(0);

    const reader = new ReaderWorkflow();
    const pages = reader.paginateByCells(
      {
        id: "bdoc",
        title: "Braille Doc",
        content:
          "Refreshable braille displays raise pins in a 2 by 3 cell matrix for tactile reading across multiple lines.",
      },
      { cellCount: 20, linesPerPage: 2, mode: "braille" },
    );
    expect(pages.length).toBeGreaterThan(2);
    expect(pages[0].cellCount).toBe(20);
    expect(pages[0].brailleLines?.length).toBe(2);
    for (const bl of pages[0].brailleLines ?? []) {
      expect(bl.length).toBeLessThanOrEqual(20);
    }
  });
});
