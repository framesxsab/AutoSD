/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  brailleToText,
  inspectBrailleCell,
  measureBrailleCells,
  textToBraille,
  unicodeBrailleToDots,
} from "../../src/workflows/tactile.js";
import { ReaderView } from "../../src/ui/ReaderView.js";
import { createReaderView } from "../../src/app/views/readerView.js";
import { DeviceManager } from "../../src/core/DeviceManager.js";
import { VirtualDevice } from "../../src/devices/VirtualDevice.js";
import { PluginHost } from "../../src/plugins/PluginHost.js";
import { createCatalogPlugins } from "../../src/workflows/marketplace.js";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";
import { clearPreferences } from "../../src/app/BrowserStore.js";

describe("Braille Iteration 3 — UEB Grade 1 completeness, decoder, cell-pagination & HID UX", () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    clearPreferences();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    clearPreferences();
    vi.restoreAllMocks();
  });

  it("encodes UEB capital-word indicator, capital terminator, and Grade 1 letter-mode sign", () => {
    // Capital word indicator: ⠠⠠ + wcag = 6 cells (instead of 8)
    const wcag = textToBraille("WCAG", 20);
    expect(wcag.activeCells).toBe(6);
    expect(wcag.unicode).toBe("⠠⠠⠺⠉⠁⠛");
    expect(brailleToText(wcag.unicode)).toBe("WCAG");

    // Mid-word transition from ALL-CAPS to lowercase uses capital terminator ⠠⠄
    const mixed = textToBraille("HTMLReader", 40);
    expect(brailleToText(mixed.unicode)).toBe("HTMLReader");
    expect(measureBrailleCells("HTMLReader")).toBe(mixed.activeCells);

    // Letter a-j immediately after digit requires Grade 1 letter-mode sign ⠰ (0x30)
    const numLetter = textToBraille("1a 2b 10k", 30);
    expect(numLetter.unicode).toContain("⠼⠁⠰⠁");
    expect(numLetter.unicode).toContain("⠼⠃⠰⠃");
    // 'k' is outside a-j so no Grade 1 letter sign is needed after '0'
    expect(numLetter.unicode).toContain("⠼⠁⠚⠅");
    expect(brailleToText(numLetter.unicode)).toBe("1a 2b 10k");
  });

  it("encodes and round-trip decodes 2-cell UEB punctuation and symbols", () => {
    const sample = 'Score (100%) [A+B=C] "ok" @# $5 & *_';
    const encoded = textToBraille(sample, 100);
    expect(measureBrailleCells(sample)).toBe(encoded.activeCells);
    expect(brailleToText(encoded.unicode)).toBe(sample);
    expect(brailleToText(unicodeBrailleToDots(encoded.unicode))).toBe(sample);
    expect(brailleToText(encoded.cells.subarray(0, encoded.activeCells))).toBe(sample);
  });

  it("maintains exact measureBrailleCells === textToBraille().activeCells invariant and inspects routing cells", () => {
    const samples = [
      "Hello, World!",
      "WCAG 2.2 AA (level 1a)",
      "API_KEY=42 & 100%",
      "HTML5Reader [draft]",
    ];
    for (const s of samples) {
      const res = textToBraille(s, 200);
      expect(measureBrailleCells(s)).toBe(res.activeCells);
      expect(brailleToText(res.unicode)).toBe(s);
    }

    const line = textToBraille("Hello braille", 20);
    // 'H' is cells 0 (⠠) and 1 (⠓), 'e' is 2, 'l' is 3, 'l' is 4, 'o' is 5, ' ' is 6, 'b' is 7
    const cell0 = inspectBrailleCell(line, 0);
    expect(cell0).not.toBeNull();
    expect(cell0!.char).toBe("H");
    expect(cell0!.word).toBe("Hello");

    const cell7 = inspectBrailleCell(line, 7);
    expect(cell7).not.toBeNull();
    expect(cell7!.char).toBe("b");
    expect(cell7!.word).toBe("braille");

    // Trailing blank padding cell returns null
    expect(inspectBrailleCell(line, 19)).toBeNull();
    expect(inspectBrailleCell(line, -1)).toBeNull();
    expect(inspectBrailleCell(line, 25)).toBeNull();
  });

  it("ReaderView supports cell-aware pagination mode and live pagination option switching", () => {
    const rv = new ReaderView({
      paginationMode: "cells",
      cellCount: 20,
      linesPerPage: 2,
      tactileMode: "braille",
    });
    rv.mount(container);

    const doc = {
      id: "doc-cells",
      title: "Cell Pagination Doc",
      content:
        "Refreshable braille displays raise pins in a tactile matrix for multi-line reading across pages.",
    };
    rv.render(doc);

    const cellPages = rv.getPages();
    expect(cellPages.length).toBeGreaterThan(2);
    expect(cellPages[0].cellCount).toBe(20);
    expect(cellPages[0].brailleLines?.length).toBeLessThanOrEqual(2);

    // Switching back to character pagination collapses short doc to 1 page
    rv.setPaginationOptions({ paginationMode: "chars", charsPerPage: 1000 });
    expect(rv.getPages()).toHaveLength(1);
  });

  it("readerView wires cell-aware pagination toggle, cross-page HID panning, routing inspection, select, and chord", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([
      {
        id: "multi-doc",
        path: "multi.md",
        content:
          "Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango.",
      },
    ]);

    const dm = new DeviceManager();
    const dev = new VirtualDevice("v-hid-20", "Braille 20", 20);
    await dev.connect();
    await dm.register(dev);
    await dm.setActive("v-hid-20");

    const announcements: string[] = [];
    const view = createReaderView({
      workflow: wf,
      deviceManager: dm,
      announce: msg => announcements.push(msg),
    });
    view.mount(container);

    // Load the multi-word document
    const select = container.querySelector<HTMLSelectElement>("select")!;
    select.value = "multi-doc";
    const loadBtn = Array.from(container.querySelectorAll("button")).find(
      b => b.textContent === "Load document",
    )!;
    loadBtn.click();

    // Enable cell-aware pagination (20 cells x 5 lines -> multiple pages)
    const cellToggle = container.querySelector<HTMLButtonElement>("[data-autosd-cell-pagination]")!;
    expect(cellToggle.getAttribute("aria-pressed")).toBe("false");
    cellToggle.click();
    expect(cellToggle.getAttribute("aria-pressed")).toBe("true");

    const articles = container.querySelectorAll("article[data-page]");
    expect(articles.length).toBeGreaterThan(1);

    // Send page 1 to active device
    const sendBtn = Array.from(container.querySelectorAll("button")).find(
      b => b.textContent === "Send page to tactile device",
    )!;
    sendBtn.click();

    await vi.waitFor(() => {
      expect(container.querySelector(".autosd-tactile-preview")?.textContent).toContain(
        "line 1 of",
      );
    });

    // Cursor-routing key at cell 1 ('A' in 'Alpha')
    await dev.write(new Uint8Array([0x80, 1, 0x00]));
    await vi.waitFor(() => {
      const routing = container.querySelector("[data-braille-routing-status]");
      expect(routing?.textContent).toContain('"A"');
      expect(routing?.textContent).toContain('"Alpha"');
    });

    // Select key announces current braille line text
    await dev.write(new Uint8Array([0x04, 0x00, 0x00]));
    expect(announcements.some(a => a.includes("Line 1:") && a.includes("Alpha"))).toBe(true);

    // Perkins chord key (0x01 = 'a') decodes and announces
    await dev.write(new Uint8Array([0x00, 0x00, 0x01]));
    expect(announcements.some(a => a.includes('Braille chord input: "a"'))).toBe(true);

    // Page 1 has 5 lines (indices 0..4): 4 pan-rights reach line 5, 5th pan-right crosses to Page 2 line 1
    for (let i = 0; i < 5; i++) {
      await dev.write(new Uint8Array([0x02, 0x00, 0x00]));
    }
    await vi.waitFor(() => {
      const status = container.querySelector("[data-reader-page-status]");
      expect(status?.textContent).toContain("Page 2 of");
      expect(container.querySelector(".autosd-tactile-preview")?.textContent).toContain(
        "line 1 of",
      );
    });

    // Pan-left from line 1 of page 2 returns to page 1's last line (line 5 of 5)
    await dev.write(new Uint8Array([0x01, 0x00, 0x00]));
    await vi.waitFor(() => {
      const status = container.querySelector("[data-reader-page-status]");
      expect(status?.textContent).toContain("Page 1 of");
      expect(container.querySelector(".autosd-tactile-preview")?.textContent).toContain(
        "line 5 of 5",
      );
    });

    view.unmount();
  });

  it("autosd-braille plugin registers and unregisters autosd-braille:decode alongside encode", async () => {
    const host = new PluginHost();
    for (const p of createCatalogPlugins()) {
      host.registry.register(p);
    }
    await host.registry.activate("autosd-braille");
    expect(host.hasWorkflow("autosd-braille:encode")).toBe(true);
    expect(host.hasWorkflow("autosd-braille:decode")).toBe(true);

    const encoded = (await host.runWorkflow("autosd-braille:encode", {
      text: "WCAG 2.2",
      cellCount: 30,
    })) as { unicode: string };
    const decoded = await host.runWorkflow("autosd-braille:decode", { unicode: encoded.unicode });
    expect(decoded).toBe("WCAG 2.2");

    await host.registry.deactivate("autosd-braille");
    expect(host.hasWorkflow("autosd-braille:decode")).toBe(false);
  });
});
