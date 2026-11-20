import { ReaderView } from "../../ui/ReaderView.js";
import { parseHIDInputReport } from "../../devices/HIDDevice.js";
import {
  brailleToText,
  inspectBrailleCell,
  textToDots,
  wrapTextToBrailleLines,
  type BrailleRenderResult,
} from "../../workflows/tactile.js";
import type { ReaderPage } from "../../workflows/reader.js";
import { loadPreferences, savePreferences } from "../BrowserStore.js";
import type { RouterView, ViewContext } from "../router.js";

const WELCOME_DOC = {
  id: "welcome",
  title: "Welcome to AutoSD",
  content: "Select a document from the corpus to begin reading with grounded citations.",
};

export function createReaderView(ctx: ViewContext): RouterView {
  const root = document.createElement("section");
  root.setAttribute("aria-label", "Reader");

  const toolbar = document.createElement("div");
  toolbar.className = "autosd-toolbar";
  toolbar.setAttribute("role", "group");
  toolbar.setAttribute("aria-label", "Reader document selector");

  const select = document.createElement("select");
  select.setAttribute("aria-label", "Select corpus document");

  const loadBtn = document.createElement("button");
  loadBtn.type = "button";
  loadBtn.textContent = "Load document";

  let cellPaginationEnabled = false;
  const cellPaginateBtn = document.createElement("button");
  cellPaginateBtn.type = "button";
  cellPaginateBtn.dataset.autosdCellPagination = "true";
  cellPaginateBtn.setAttribute("aria-pressed", "false");
  cellPaginateBtn.textContent = "Cell-aware pagination";

  toolbar.appendChild(select);
  toolbar.appendChild(loadBtn);
  toolbar.appendChild(cellPaginateBtn);
  root.appendChild(toolbar);

  const tactileStrip = document.createElement("div");
  tactileStrip.className = "autosd-tactile-preview";
  tactileStrip.setAttribute("role", "status");
  tactileStrip.setAttribute("aria-label", "Reader tactile output");
  tactileStrip.tabIndex = 0;
  tactileStrip.textContent = "Tactile output ready — send any page to the active device.";

  let currentBrailleLines: BrailleRenderResult[] = [];
  let activeLineIndex = 0;
  let lastRenderedPageIndex = 0;
  let lastCellCount = 40;
  let lastBrailleGrade: 1 | 2 = 1;
  let lastRoutingDetail = "";

  const getActiveCellCount = (): number => {
    const active = ctx.deviceManager?.getActive();
    const prefs = loadPreferences();
    return active?.info.capabilities?.dotCount ?? prefs.displayCellCount ?? 40;
  };

  const renderBrailleLineToStrip = async (lineIdx: number, announceLine = false): Promise<void> => {
    if (currentBrailleLines.length === 0) return;
    activeLineIndex = Math.max(0, Math.min(currentBrailleLines.length - 1, lineIdx));
    const active = ctx.deviceManager?.getActive();
    const targetLine = currentBrailleLines[activeLineIndex];
    if (active && targetLine) {
      await ctx.deviceManager?.broadcast(targetLine.cells);
    }

    tactileStrip.replaceChildren();
    const info = document.createElement("div");
    info.textContent = active
      ? `${active.info.name} (${lastCellCount} cells · line ${activeLineIndex + 1} of ${currentBrailleLines.length} · UEB Grade ${lastBrailleGrade} Braille)`
      : `Preview (${lastCellCount} cells · line ${activeLineIndex + 1} of ${currentBrailleLines.length} · UEB Grade ${lastBrailleGrade} Braille, no active device)`;
    tactileStrip.appendChild(info);

    if (lastRoutingDetail) {
      const routingEl = document.createElement("div");
      routingEl.dataset.brailleRoutingStatus = "true";
      routingEl.textContent = lastRoutingDetail;
      tactileStrip.appendChild(routingEl);
    }

    if (currentBrailleLines.length > 1) {
      const lineNav = document.createElement("div");
      lineNav.setAttribute("role", "group");
      lineNav.setAttribute("aria-label", "Braille line navigation");
      const prevLineBtn = document.createElement("button");
      prevLineBtn.type = "button";
      prevLineBtn.textContent = "Previous braille line";
      prevLineBtn.disabled = activeLineIndex === 0;
      prevLineBtn.addEventListener("click", () => {
        lastRoutingDetail = "";
        void renderBrailleLineToStrip(activeLineIndex - 1, true);
      });
      const nextLineBtn = document.createElement("button");
      nextLineBtn.type = "button";
      nextLineBtn.textContent = "Next braille line";
      nextLineBtn.disabled = activeLineIndex >= currentBrailleLines.length - 1;
      nextLineBtn.addEventListener("click", () => {
        lastRoutingDetail = "";
        void renderBrailleLineToStrip(activeLineIndex + 1, true);
      });
      lineNav.append(prevLineBtn, nextLineBtn);
      tactileStrip.appendChild(lineNav);
    }

    const brailleLine = document.createElement("pre");
    brailleLine.textContent = currentBrailleLines
      .map((l, idx) =>
        currentBrailleLines.length > 1
          ? `${idx === activeLineIndex ? "▸ " : "  "}${l.unicode || "⠀"}`
          : l.unicode || "⠀",
      )
      .join("\n");
    tactileStrip.appendChild(brailleLine);

    if (announceLine) {
      ctx.announce(
        `Braille line ${activeLineIndex + 1} of ${currentBrailleLines.length} on page ${lastRenderedPageIndex + 1}`,
      );
    }
  };

  tactileStrip.addEventListener("keydown", ev => {
    if (currentBrailleLines.length === 0) return;
    if (ev.key === "ArrowDown" || ev.key === "PageDown") {
      ev.preventDefault();
      if (activeLineIndex < currentBrailleLines.length - 1) {
        lastRoutingDetail = "";
        void renderBrailleLineToStrip(activeLineIndex + 1, true);
      }
    } else if (ev.key === "ArrowUp" || ev.key === "PageUp") {
      ev.preventDefault();
      if (activeLineIndex > 0) {
        lastRoutingDetail = "";
        void renderBrailleLineToStrip(activeLineIndex - 1, true);
      }
    }
  });

  const renderPageToActiveDevice = async (
    page: ReaderPage,
    startLine: number | "last" = 0,
  ): Promise<void> => {
    const active = ctx.deviceManager?.getActive();
    const prefs = loadPreferences();
    const mode = prefs.tactileMode ?? "braille";
    const grade = prefs.brailleGrade ?? 1;
    const cellCount = getActiveCellCount();
    const excerpt = page.text.trim().slice(0, cellCount * 2);
    lastRenderedPageIndex = page.index;
    lastCellCount = cellCount;
    lastBrailleGrade = grade;
    lastRoutingDetail = "";

    if (mode === "braille") {
      currentBrailleLines = wrapTextToBrailleLines(page.text, cellCount, { grade });
      const initialIdx = startLine === "last" ? currentBrailleLines.length - 1 : startLine;
      await renderBrailleLineToStrip(initialIdx, false);
      ctx.announce(
        active
          ? `Sent page ${page.index + 1} (${currentBrailleLines.length} braille lines) to ${active.info.name}`
          : `Rendered braille preview for page ${page.index + 1}`,
      );
      return;
    }

    currentBrailleLines = [];
    const pattern = textToDots(excerpt, cellCount);
    if (active) {
      await ctx.deviceManager?.broadcast(pattern);
    }
    const glyphs = Array.from(pattern, c => (c > 0 ? "●" : "·")).join("");
    tactileStrip.replaceChildren();
    const info = document.createElement("div");
    info.textContent = active
      ? `${active.info.name} (${cellCount} dots · 6-dot mode)`
      : `Preview (${cellCount} dots · 6-dot mode)`;
    const pre = document.createElement("pre");
    pre.setAttribute("aria-hidden", "true");
    pre.textContent = glyphs;
    tactileStrip.append(info, pre);
    ctx.announce(
      active
        ? `Sent page ${page.index + 1} dots to ${active.info.name}`
        : `Rendered dot preview for page ${page.index + 1}`,
    );
  };

  const readerView = new ReaderView({
    onCitationOpen: cit => ctx.announce(`Opened citation ${cit.chunkId}`),
    onSendToDevice: page => {
      void renderPageToActiveDevice(page);
    },
  });
  readerView.mount(root);
  root.appendChild(tactileStrip);

  const syncCellPaginationMode = (): void => {
    const prefs = loadPreferences();
    const cellCount = getActiveCellCount();
    if (cellPaginationEnabled) {
      readerView.setPaginationOptions({
        paginationMode: "cells",
        cellCount,
        linesPerPage: 5,
        tactileMode: prefs.tactileMode ?? "braille",
        brailleGrade: prefs.brailleGrade ?? 1,
      });
    } else {
      readerView.setPaginationOptions({ paginationMode: "chars" });
    }
  };

  cellPaginateBtn.addEventListener("click", () => {
    cellPaginationEnabled = !cellPaginationEnabled;
    cellPaginateBtn.setAttribute("aria-pressed", String(cellPaginationEnabled));
    savePreferences({ cellPaginationEnabled });
    syncCellPaginationMode();
    const cellCount = getActiveCellCount();
    ctx.announce(
      cellPaginationEnabled
        ? `Cell-aware pagination enabled (${cellCount} cells per line)`
        : "Standard character pagination enabled",
    );
  });

  let rendered = false;
  let unsubscribeSync: (() => void) | undefined;
  let unsubscribeSelection: (() => void) | undefined;
  let unsubscribeDeviceInput: (() => void) | undefined;
  let unsubscribeActiveDevice: (() => void) | undefined;

  const wireActiveDeviceInput = (): void => {
    unsubscribeDeviceInput?.();
    unsubscribeDeviceInput = undefined;
    const active = ctx.deviceManager?.getActive();
    if (!active) return;
    unsubscribeDeviceInput = active.on("input", ev => {
      if (currentBrailleLines.length === 0) return;
      const parsed = parseHIDInputReport(ev.data, lastCellCount);
      if (parsed.kind === "pan-right") {
        if (activeLineIndex < currentBrailleLines.length - 1) {
          lastRoutingDetail = "";
          void renderBrailleLineToStrip(activeLineIndex + 1, true);
        } else {
          const pages = readerView.getPages();
          const nextPage = pages[lastRenderedPageIndex + 1];
          if (nextPage) {
            readerView.setActivePage(nextPage.index);
            void renderPageToActiveDevice(nextPage, 0);
          }
        }
        return;
      }
      if (parsed.kind === "pan-left") {
        if (activeLineIndex > 0) {
          lastRoutingDetail = "";
          void renderBrailleLineToStrip(activeLineIndex - 1, true);
        } else {
          const pages = readerView.getPages();
          const prevPage = pages[lastRenderedPageIndex - 1];
          if (prevPage) {
            readerView.setActivePage(prevPage.index);
            void renderPageToActiveDevice(prevPage, "last");
          }
        }
        return;
      }
      if (parsed.kind === "routing" && parsed.routingCell !== null) {
        const line = currentBrailleLines[activeLineIndex];
        const inspected = line ? inspectBrailleCell(line, parsed.routingCell) : null;
        lastRoutingDetail = inspected
          ? `Cell ${parsed.routingCell + 1}: "${inspected.char}" in "${inspected.word}"`
          : `Cell ${parsed.routingCell + 1}: blank`;
        void renderBrailleLineToStrip(activeLineIndex, false);
        ctx.announce(lastRoutingDetail);
        return;
      }
      if (parsed.kind === "select") {
        const line = currentBrailleLines[activeLineIndex];
        const text = line?.sourceText ?? "";
        ctx.announce(`Line ${activeLineIndex + 1}: ${text}`);
        return;
      }
      if (parsed.kind === "chord" && parsed.chordMask > 0) {
        const decoded = brailleToText([parsed.chordMask]);
        lastRoutingDetail = `Braille chord: "${decoded}"`;
        void renderBrailleLineToStrip(activeLineIndex, false);
        ctx.announce(`Braille chord input: "${decoded}"`);
      }
    });
  };

  const refreshOptions = (): void => {
    const prevValue = select.value || WELCOME_DOC.id;
    select.replaceChildren();

    const welcomeOpt = document.createElement("option");
    welcomeOpt.value = WELCOME_DOC.id;
    welcomeOpt.textContent = WELCOME_DOC.title;
    select.appendChild(welcomeOpt);

    for (const doc of ctx.workflow.listDocuments()) {
      const opt = document.createElement("option");
      opt.value = doc.id;
      opt.textContent = doc.path ?? doc.id;
      select.appendChild(opt);
    }

    const hasPrev = Array.from(select.options).some(o => o.value === prevValue);
    select.value = hasPrev ? prevValue : WELCOME_DOC.id;
  };

  const applyPendingSelection = (): boolean => {
    const sel = ctx.consumePendingReaderSelection?.();
    if (!sel) return false;
    refreshOptions();
    const doc =
      ctx.workflow.getDocument(sel.documentId) ??
      ctx.workflow.listDocuments().find(d => d.id === sel.documentId);
    if (!doc) return false;
    select.value = doc.id;
    const title = doc.path ?? doc.id;
    readerView.render({ id: doc.id, title, content: doc.content }, sel.result);
    rendered = true;
    if (sel.chunkId) {
      readerView.highlight(sel.chunkId);
    }
    ctx.announce(`Loaded document ${title}`);
    return true;
  };

  loadBtn.addEventListener("click", () => {
    const selectedId = select.value;
    if (selectedId === WELCOME_DOC.id) {
      readerView.render(WELCOME_DOC);
      rendered = true;
      ctx.announce(`Loaded document ${WELCOME_DOC.title}`);
      return;
    }
    const doc = ctx.workflow.listDocuments().find(d => d.id === selectedId);
    if (!doc) {
      refreshOptions();
      ctx.announce("Selected document is no longer available");
      return;
    }
    const title = doc.path ?? doc.id;
    readerView.render({ id: doc.id, title, content: doc.content });
    rendered = true;
    ctx.announce(`Loaded document ${title}`);
  });

  return {
    root,
    mount(host: HTMLElement) {
      host.appendChild(root);
      refreshOptions();
      const prefs = loadPreferences();
      cellPaginationEnabled = Boolean(prefs.cellPaginationEnabled);
      cellPaginateBtn.setAttribute("aria-pressed", String(cellPaginationEnabled));
      syncCellPaginationMode();
      const loadedPending = applyPendingSelection();
      if (!loadedPending && !rendered) {
        readerView.render(WELCOME_DOC);
        rendered = true;
      }
      unsubscribeSelection?.();
      unsubscribeSelection = ctx.onReaderSelectionChange?.(() => {
        applyPendingSelection();
      });
      if (ctx.liveSync) {
        unsubscribeSync?.();
        unsubscribeSync = ctx.liveSync.onStatusChange(status => {
          if (status === "Updated") refreshOptions();
        });
      }
      wireActiveDeviceInput();
      if (ctx.deviceManager) {
        unsubscribeActiveDevice?.();
        unsubscribeActiveDevice = ctx.deviceManager.on("activeChanged", () => {
          wireActiveDeviceInput();
          if (cellPaginationEnabled) syncCellPaginationMode();
        });
      }
    },
    unmount() {
      unsubscribeSync?.();
      unsubscribeSync = undefined;
      unsubscribeSelection?.();
      unsubscribeSelection = undefined;
      unsubscribeDeviceInput?.();
      unsubscribeDeviceInput = undefined;
      unsubscribeActiveDevice?.();
      unsubscribeActiveDevice = undefined;
      root.remove();
    },
  };
}
