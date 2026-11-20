/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  brailleToText,
  inspectBrailleCell,
  measureBrailleCells,
  textToBraille,
  wrapTextToBrailleLines,
} from "../../src/workflows/tactile.js";
import { ReaderWorkflow } from "../../src/workflows/reader.js";
import {
  clearPreferences,
  loadPreferences,
  PREFS_STORAGE_KEY,
  savePreferences,
} from "../../src/app/BrowserStore.js";
import { AppRouter } from "../../src/app/router.js";
import { DeviceManager } from "../../src/core/DeviceManager.js";
import { VirtualDevice } from "../../src/devices/VirtualDevice.js";
import { PluginHost } from "../../src/plugins/PluginHost.js";
import { createCatalogPlugins } from "../../src/workflows/marketplace.js";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";

describe("Braille Iteration 4 — UEB Grade 2 contractions, persisted preferences & settings UX", () => {
  let container: HTMLElement;
  let router: AppRouter | undefined;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    clearPreferences();
    container = document.createElement("div");
    document.body.appendChild(container);
    window.location.hash = "#/settings";
  });

  afterEach(() => {
    router?.stop();
    router = undefined;
    document.body.innerHTML = "";
    localStorage.clear();
    clearPreferences();
    window.location.hash = "";
    vi.restoreAllMocks();
  });

  it("encodes and round-trip decodes UEB Grade 2 strong signs and alphabetic wordsigns with cell savings", () => {
    const sentence = "The people can do more with knowledge and reading for that is very good.";
    const g1 = textToBraille(sentence, 200, { grade: 1 });
    const g2 = textToBraille(sentence, 200, { grade: 2 });

    expect(g2.grade).toBe(2);
    expect(g2.activeCells).toBeLessThan(g1.activeCells);
    expect(measureBrailleCells(sentence, { grade: 2 })).toBe(g2.activeCells);
    expect(brailleToText(g2.unicode, { grade: 2 })).toBe(sentence);

    // Specific UEB Grade 2 glyphs: "the" -> ⠮, "and" -> ⠯, "for" -> ⠿, "of" -> ⠷, "with" -> ⠾
    expect(textToBraille("the and for of with", 40, { grade: 2 }).unicode).toBe("⠮⠀⠯⠀⠿⠀⠷⠀⠾");
    // Standing-alone alphabetic wordsigns + literal single letters
    const literalAndWords = "a I can do b X you as";
    const enc = textToBraille(literalAndWords, 60, { grade: 2 });
    expect(brailleToText(enc.unicode, { grade: 2 })).toBe(literalAndWords);
  });

  it("handles Grade 2 capitalization (Title, ALL-CAPS) and strong groupsigns losslessly", () => {
    const samples = [
      "THE quick brown fox",
      "WITH reading, shouting, and searching",
      "People like THAT knowledge!",
      "section b and part 1a (100%)",
      "church ghost shine think where loved power house cow star ring",
    ];
    for (const s of samples) {
      const encoded = textToBraille(s, 200, { grade: 2 });
      expect(measureBrailleCells(s, { grade: 2 })).toBe(encoded.activeCells);
      expect(brailleToText(encoded.unicode, { grade: 2 })).toBe(s);
    }

    // Cursor-routing inspection still maps Grade 2 contracted cells back to the enclosing word
    const line = textToBraille("The reading", 20, { grade: 2 });
    // Cell 0 = ⠠, Cell 1 = ⠮ ("The")
    const cell1 = inspectBrailleCell(line, 1);
    expect(cell1).not.toBeNull();
    expect(cell1!.word).toBe("The");
  });

  it("wraps lines and paginates by cells in Grade 2 without exceeding cellCount", () => {
    const text =
      "The people can do more with knowledge and reading for that will bring clarity to every researcher.";
    const g1Lines = wrapTextToBrailleLines(text, 20, { grade: 1 });
    const g2Lines = wrapTextToBrailleLines(text, 20, { grade: 2 });
    expect(g2Lines.length).toBeLessThanOrEqual(g1Lines.length);
    for (const line of g2Lines) {
      expect(line.activeCells).toBeLessThanOrEqual(20);
      expect(line.grade).toBe(2);
    }

    const reader = new ReaderWorkflow();
    const pages = reader.paginateByCells(
      { id: "g2-doc", title: "Grade 2 Doc", content: text },
      { cellCount: 20, linesPerPage: 2, mode: "braille", grade: 2 },
    );
    expect(pages.length).toBeGreaterThan(0);
    for (const p of pages) {
      for (const bl of p.brailleLines ?? []) {
        expect(bl.length).toBeLessThanOrEqual(20);
      }
    }
  });

  it("BrowserStore persists and validates brailleGrade and cellPaginationEnabled", () => {
    savePreferences({ brailleGrade: 2, cellPaginationEnabled: true });
    expect(loadPreferences()).toMatchObject({
      brailleGrade: 2,
      cellPaginationEnabled: true,
    });

    // Invalid values are ignored safely on load
    localStorage.setItem(
      PREFS_STORAGE_KEY,
      JSON.stringify({ brailleGrade: 99, cellPaginationEnabled: "yes" }),
    );
    const sanitized = loadPreferences();
    expect(sanitized.brailleGrade).toBeUndefined();
    expect(sanitized.cellPaginationEnabled).toBeUndefined();
  });

  it("syncs Braille grade and cell-aware pagination between #/settings and #/reader via BrowserStore", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([
      {
        id: "prefs-doc",
        path: "prefs.md",
        content:
          "The people can do more with knowledge and reading across multiple tactile braille lines.",
      },
    ]);

    const dm = new DeviceManager();
    const dev = new VirtualDevice("v-g2", "Braille 20", 20);
    await dev.connect();
    await dm.register(dev);
    await dm.setActive("v-g2");

    router = new AppRouter({ container, workflow: wf, deviceManager: dm });
    router.start();

    // Configure Grade 2 + Cell-aware pagination in #/settings
    await vi.waitFor(() => {
      expect(container.querySelector('select[aria-label="Braille grade"]')).not.toBeNull();
    });
    const gradeSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Braille grade"]',
    )!;
    const cellCheck = container.querySelector<HTMLInputElement>(
      'input[aria-label="Enable cell-aware pagination"]',
    )!;

    gradeSelect.value = "2";
    gradeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    cellCheck.checked = true;
    cellCheck.dispatchEvent(new Event("change", { bubbles: true }));

    expect(loadPreferences()).toMatchObject({
      brailleGrade: 2,
      cellPaginationEnabled: true,
    });

    // Navigate to #/reader — cell-aware pagination should be restored and Grade 2 used
    router.navigate("reader");
    await vi.waitFor(() => {
      const toggle = container.querySelector<HTMLButtonElement>("[data-autosd-cell-pagination]");
      expect(toggle).not.toBeNull();
      expect(toggle!.getAttribute("aria-pressed")).toBe("true");
    });

    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Select corpus document"]',
    )!;
    select.value = "prefs-doc";
    const loadBtn = Array.from(container.querySelectorAll("button")).find(
      b => b.textContent === "Load document",
    )!;
    loadBtn.click();

    const sendBtn = Array.from(container.querySelectorAll("button")).find(
      b => b.textContent === "Send page to tactile device",
    )!;
    sendBtn.click();

    await vi.waitFor(() => {
      const strip = container.querySelector(".autosd-tactile-preview")?.textContent ?? "";
      expect(strip).toContain("UEB Grade 2 Braille");
    });

    // Toggling cell-aware pagination off in Reader persists to BrowserStore
    const toggle = container.querySelector<HTMLButtonElement>("[data-autosd-cell-pagination]")!;
    toggle.click();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(loadPreferences().cellPaginationEnabled).toBe(false);
  });

  it("autosd-braille plugin workflows support grade 2 encode and decode", async () => {
    const host = new PluginHost();
    for (const p of createCatalogPlugins()) {
      host.registry.register(p);
    }
    await host.registry.activate("autosd-braille");

    const encoded = (await host.runWorkflow("autosd-braille:encode", {
      text: "The people can read with knowledge",
      cellCount: 40,
      grade: 2,
    })) as { unicode: string; grade: number };
    expect(encoded.grade).toBe(2);

    const decoded = await host.runWorkflow("autosd-braille:decode", {
      unicode: encoded.unicode,
      grade: 2,
    });
    expect(decoded).toBe("The people can read with knowledge");
  });
});
