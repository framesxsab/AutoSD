/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppRouter } from "../../src/app/router.js";
import { MAX_UPLOAD_FILE_BYTES } from "../../src/app/Workspace.js";
import {
  clearPreferences,
  clearWorkspaceState,
  loadPreferences,
  loadWorkspaceState,
  saveWorkspaceState,
} from "../../src/app/BrowserStore.js";
import { LiveSync } from "../../src/app/LiveSync.js";
import { DeviceManager } from "../../src/core/DeviceManager.js";
import {
  HIDDevice,
  parseHIDInputReport,
  STANDARD_HID_PROFILES,
} from "../../src/devices/HIDDevice.js";
import { RetrievalPipeline } from "../../src/retrieval/pipeline.js";
import { SnapshotIndex } from "../../src/retrieval/snapshot.js";
import { LexicalReranker, EmbeddingReranker } from "../../src/retrieval/reranker.js";
import { LexicalHashEmbeddingProvider } from "../../src/retrieval/providers/LexicalHashEmbeddingProvider.js";
import {
  OpenAIEmbeddingProvider,
  DEFAULT_OPENAI_MAX_INPUT_CHARS,
} from "../../src/retrieval/providers/OpenAIEmbeddingProvider.js";
import { ResearchWorkflow, isValidRestoredSession } from "../../src/workflows/research.js";
import { ReaderWorkflow } from "../../src/workflows/reader.js";
import { measureBrailleCells, wrapTextToBrailleLines } from "../../src/workflows/tactile.js";
import { assertSafePath, escapeSelector } from "../../src/utils/sanitize.js";
import { clearRegisteredSecrets } from "../../src/app/logger.js";

describe("Whitebox Suite — internal algorithm invariants, state transitions, and security boundaries", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch as unknown as typeof fetch;
    clearRegisteredSecrets();
    vi.restoreAllMocks();
  });

  it("extractive answer synthesis filters stop words, normalizes plural/inflected stems, and falls back when query is all stop words", async () => {
    const wf = new ResearchWorkflow({ provider: new LexicalHashEmbeddingProvider() });
    await wf.ingest([
      {
        id: "disp-doc",
        path: "disp.md",
        content:
          "How much power a unit draws depends on how often it runs. " +
          "Refreshable braille display modules render tactile dots using piezoelectric actuators.",
      },
    ]);

    // Despite "How" appearing twice in sentence 1, stop-word filtering + stem matching
    // ("displays"->"display", "renders"->"render", "dots"->"dot") ranks sentence 2 first.
    const res = await wf.run({
      id: "q-extract",
      question: "How do refreshable braille displays render tactile dots?",
    });
    expect(res.answer.startsWith("Refreshable braille display modules render tactile dots")).toBe(
      true,
    );
    expect(res.answer).toContain("[disp-doc#0]");

    // Fallback branch: query composed exclusively of stop words still produces a valid extractive answer
    const stopOnly = await wf.run({
      id: "q-stop",
      question: "how and why are they there",
    });
    expect(stopOnly.answer).toContain("[disp-doc#0]");
  });

  it("RetrievalPipeline RRF score math, LexicalReranker boost formula, and EmbeddingReranker batching", async () => {
    const provider = new LexicalHashEmbeddingProvider();
    const pipe = new RetrievalPipeline(provider, {
      topK: 3,
      rrfK: 60,
      bm25Weight: 2,
      vectorWeight: 1,
      mode: "hybrid",
    });
    await pipe.ingest([
      { id: "a", content: "piezoelectric braille actuator pins" },
      { id: "b", content: "screen reader landmarks and headings" },
    ]);

    const hits = await pipe.search("piezoelectric braille");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].chunk.documentId).toBe("a");
    // Top hit ranked #1 in both BM25 and Vector gets 2*(1/61) + 1*(1/61) = 3/61
    expect(hits[0].score).toBeCloseTo(3 / 61, 5);

    // LexicalReranker exact boost formula: score * (1 + hits / qTerms.length)
    const lex = new LexicalReranker();
    const reranked = await lex.rerank("piezoelectric braille", hits, 2);
    expect(reranked[0].details?.lexicalBoost).toBe(1);
    expect(reranked[0].score).toBeCloseTo((3 / 61) * 2, 5);

    // EmbeddingReranker batches query + all candidates in a single embedMany call
    const embedManySpy = vi.spyOn(provider, "embedMany");
    const embReranker = new EmbeddingReranker(provider);
    const embRanked = await embReranker.rerank("piezoelectric braille", hits, 2);
    expect(embedManySpy).toHaveBeenCalledTimes(1);
    expect(embedManySpy.mock.calls[0][0]).toHaveLength(1 + hits.length);
    expect(embRanked[0].chunk.documentId).toBe("a");
  });

  it("SnapshotIndex and isValidRestoredSession guard against prototype pollution and malformed payloads", () => {
    const snap = new SnapshotIndex();
    const pollutedHashes = JSON.parse(
      '{"d1":"hash1","__proto__":"polluted","constructor":"bad","num":123}',
    ) as Record<string, string>;

    snap.fromPersistedState({
      version: "1.2.0",
      documentHashes: pollutedHashes,
      chunks: [
        { id: "d1#0", documentId: "d1", content: "valid chunk", start: 0, end: 11, hash: "h1" },
        null as unknown as never,
        { id: 999 } as unknown as never,
      ],
      manifests: [{ version: "1.2.0" } as never, null as unknown as never],
    });

    const exported = snap.toPersistedState();
    expect(Object.keys(exported.documentHashes)).toEqual(["d1"]);
    expect(exported.chunks).toHaveLength(1);
    expect(exported.manifests).toHaveLength(1);

    expect(isValidRestoredSession(null)).toBe(false);
    expect(isValidRestoredSession({ id: "s1", createdAt: "2026-01-01" })).toBe(false);
    expect(
      isValidRestoredSession({
        id: "s1",
        createdAt: "2026-01-01",
        query: { id: "q1", question: "hi" },
        results: {
          queryId: "q1",
          answer: "ans",
          confidence: 0.5,
          citations: [{ chunkId: "c1", documentId: "d1", content: "txt", score: "bad" }],
        },
      }),
    ).toBe(false);
  });

  it("tactile cell measurement, overlong single-token slicing, and HID input bitmask boundary checks", () => {
    // Empty/whitespace returns single blank braille line
    const blank = wrapTextToBrailleLines("   ", 12);
    expect(blank).toHaveLength(1);
    expect(blank[0].activeCells).toBe(0);

    // Overlong single token with capitals/numbers is sliced cleanly without exceeding cellCount
    // UEB Grade 1: capital-word indicator (2) + 26 letters + number sign (1) + 10 digits = 39 cells
    const longToken = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
    expect(measureBrailleCells(longToken)).toBe(2 + 26 + 1 + 10);
    const wrapped = wrapTextToBrailleLines(longToken, 10);
    expect(wrapped.length).toBeGreaterThanOrEqual(4);
    for (const line of wrapped) {
      expect(line.activeCells).toBeLessThanOrEqual(10);
    }

    // ReaderWorkflow.paginateByCells handles empty content and overlong tokens
    const reader = new ReaderWorkflow();
    expect(reader.paginateByCells({ id: "empty", title: "Empty", content: "   " })).toEqual([]);
    const cellPages = reader.paginateByCells(
      { id: "tok", title: "Token", content: `${longToken} short words` },
      { cellCount: 10, linesPerPage: 2, mode: "braille" },
    );
    expect(cellPages.length).toBeGreaterThan(2);

    // parseHIDInputReport rejects out-of-range routing cell index (>= dotCount)
    const outOfRange = parseHIDInputReport(new Uint8Array([0x80, 45, 0x00]), 40);
    expect(outOfRange.routingCell).toBeNull();
    expect(outOfRange.kind).toBe("raw");

    // escapeSelector fallback strips control characters when CSS.escape is absent
    const origCss = (globalThis as unknown as { CSS?: unknown }).CSS;
    try {
      (globalThis as unknown as { CSS?: unknown }).CSS = undefined;
      const escaped = escapeSelector('chunk"1\n\r\0');
      expect(escaped).toContain('\\"');
      expect(escaped).not.toMatch(/[\n\r\0]/);
    } finally {
      (globalThis as unknown as { CSS?: unknown }).CSS = origCss;
    }

    expect(() => assertSafePath("")).toThrow("empty file path");
  });

  it("OpenAIEmbeddingProvider truncates oversized inputs to DEFAULT_OPENAI_MAX_INPUT_CHARS and sends same-origin credentials", async () => {
    let capturedBody = "";
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      capturedBody = String(init?.body ?? "");
      return {
        ok: true,
        json: async () => ({ data: [{ embedding: [0.5, 0.5, 0.5] }] }),
      } as Response;
    }) as unknown as typeof fetch;

    const origin = window.location.origin || "http://localhost:3000";
    const provider = new OpenAIEmbeddingProvider(
      "text-embedding-3-small",
      3,
      "",
      `${origin}/api/v1`,
      true,
    );
    const huge = "x".repeat(DEFAULT_OPENAI_MAX_INPUT_CHARS + 500);
    await provider.embed(huge);

    const parsed = JSON.parse(capturedBody) as { input: string[] };
    expect(parsed.input[0].length).toBe(DEFAULT_OPENAI_MAX_INPUT_CHARS);
    expect(capturedInit?.credentials).toBe("same-origin");
  });
});

describe("Blackbox Suite — end-to-end production user workflows across routes", () => {
  let container: HTMLElement;
  let router: AppRouter | undefined;
  let dir: string;

  beforeEach(async () => {
    document.body.innerHTML = "";
    localStorage.clear();
    await clearWorkspaceState();
    clearPreferences();
    container = document.createElement("div");
    document.body.appendChild(container);
    window.location.hash = "#/home";
    dir = await mkdtemp(join(tmpdir(), "autosd-bb-"));
  });

  afterEach(async () => {
    router?.stop();
    router = undefined;
    document.body.innerHTML = "";
    localStorage.clear();
    await clearWorkspaceState();
    clearPreferences();
    window.location.hash = "";
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("Journey 1: Workspace upload validation + ID disambiguation -> search -> Citation Inspector 'Open chunk in Reader' -> multi-line Braille stepping & HID hardware pan navigation", async () => {
    const wf = new ResearchWorkflow({
      provider: new LexicalHashEmbeddingProvider(),
      reranker: true,
    });
    const dm = new DeviceManager();
    const hid20 = new HIDDevice("hid-bb", "Braille20", {
      profile: STANDARD_HID_PROFILES.find(p => p.dotCount === 20),
    });
    await hid20.connect();
    dm.register(hid20);

    router = new AppRouter({
      container,
      workflow: wf,
      deviceManager: dm,
      onWorkspaceMutated: () => {
        void saveWorkspaceState(wf.toPersistedState());
      },
    });
    router.start();
    router.navigate("workspace");

    await vi.waitFor(() => {
      expect(router?.getCurrentRoute()?.id).toBe("workspace");
      expect(container.querySelector('input[aria-label="Upload corpus files"]')).not.toBeNull();
    });

    // 1. Test file upload validation: disallowed .exe and oversized files are rejected;
    //    duplicate filenames ("notes.md", "notes.txt") are disambiguated ("notes", "notes-2").
    const fileInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Upload corpus files"]',
    )!;
    const badExe = new File(["binary"], "malware.exe", { type: "application/octet-stream" });
    Object.defineProperty(fileInput, "files", {
      value: [badExe],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(wf.listDocuments()).toHaveLength(0);

    const noteA = new File(
      [
        "Piezoelectric braille pins rise and fall rapidly so blind readers can scan multi-line tactile passages with precision and comfort.",
      ],
      "notes.md",
      { type: "text/markdown" },
    );
    const noteB = new File(
      ["Secondary tactile note on refreshable cell spacing and ergonomic reading rhythm."],
      "notes.txt",
      { type: "text/plain" },
    );
    const oversized = {
      name: "huge.md",
      size: MAX_UPLOAD_FILE_BYTES + 100,
      text: async () => "oversized",
    } as unknown as File;

    Object.defineProperty(fileInput, "files", {
      value: [noteA, noteB, oversized],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => {
      expect(wf.listDocuments().map(d => d.id)).toEqual(["notes", "notes-2"]);
    });

    // 2. Search in Workspace and inspect the top chunk
    const searchInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search corpus"]',
    )!;
    searchInput.value = "piezoelectric braille pins multi-line";
    searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    let chunkRow: HTMLElement | null = null;
    await vi.waitFor(() => {
      chunkRow = container.querySelector<HTMLElement>('[data-chunk="notes#0"]');
      expect(chunkRow).not.toBeNull();
    });
    chunkRow!.click();

    const openInReaderBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open cited chunk notes#0 in Reader"]',
    )!;
    expect(openInReaderBtn).not.toBeNull();
    openInReaderBtn.click();

    // 3. Verify seamless navigation to #/reader with document loaded & chunk highlighted
    await vi.waitFor(() => {
      expect(router?.getCurrentRoute()?.id).toBe("reader");
      expect(container.querySelector("#reader-title")?.textContent).toBe("notes.md");
      expect(container.querySelector('[data-cited="notes#0"]')).not.toBeNull();
    });

    // 4. Send page to the 20-cell HID device -> wraps into multiple 20-cell braille lines
    const sendBtn = Array.from(container.querySelectorAll("button")).find(
      b => b.textContent === "Send page to tactile device",
    )!;
    sendBtn.click();

    await vi.waitFor(() => {
      const strip = container.querySelector('[aria-label="Reader tactile output"]')!;
      expect(strip.textContent).toContain("line 1 of");
      expect(strip.querySelector('[aria-label="Braille line navigation"]')).not.toBeNull();
    });

    // 5. Step to line 2 via UI button, then step to line 3 and back to line 2 via hardware HID pan-right / pan-left input reports!
    const nextLineBtn = Array.from(container.querySelectorAll("button")).find(
      b => b.textContent === "Next braille line",
    )!;
    nextLineBtn.click();

    await vi.waitFor(() => {
      const strip = container.querySelector('[aria-label="Reader tactile output"]')!;
      expect(strip.textContent).toContain("line 2 of");
    });

    // Hardware pan-right packet (0x02) advances from line 2 to line 3
    hid20.receiveInputReport(new Uint8Array([0x02, 0x00, 0x00]));
    await vi.waitFor(() => {
      const strip = container.querySelector('[aria-label="Reader tactile output"]')!;
      expect(strip.textContent).toContain("line 3 of");
    });

    // Hardware pan-left packet (0x01) rewinds from line 3 back to line 2
    hid20.receiveInputReport(new Uint8Array([0x01, 0x00, 0x00]));
    await vi.waitFor(() => {
      const strip = container.querySelector('[aria-label="Reader tactile output"]')!;
      expect(strip.textContent).toContain("line 2 of");
    });
  });

  it("Journey 2: Devices HID input-report simulator, Sessions export/delete, and Settings persistence roundtrip", async () => {
    const wf = new ResearchWorkflow({ provider: new LexicalHashEmbeddingProvider() });
    await wf.ingest([
      {
        id: "arch",
        path: "arch.md",
        content: "AutoSD uses Reciprocal Rank Fusion to combine lexical and vector scores.",
      },
    ]);
    await wf.run({ id: "q-arch", question: "How does Reciprocal Rank Fusion combine scores?" });

    const dm = new DeviceManager();
    const hid = new HIDDevice("hid-sim", "SimBraille40");
    await hid.connect();
    dm.register(hid);

    const sync = new LiveSync(wf, join(dir, "docs"));
    router = new AppRouter({
      container,
      workflow: wf,
      liveSync: sync,
      deviceManager: dm,
      onWorkspaceMutated: () => {
        void saveWorkspaceState(wf.toPersistedState());
      },
    });
    router.start();

    // 1. Navigate to #/devices and test the HID input-report simulator buttons
    router.navigate("devices");
    await vi.waitFor(() => {
      expect(router?.getCurrentRoute()?.id).toBe("devices");
      expect(container.querySelector('[aria-label="HID input report simulator"]')).not.toBeNull();
    });

    const panRightSim = Array.from(container.querySelectorAll("button")).find(
      b => b.textContent === "Simulate pan right",
    )!;
    const routeSim = Array.from(container.querySelectorAll("button")).find(
      b => b.textContent === "Simulate routing cell 1",
    )!;
    panRightSim.click();
    routeSim.click();

    const ioLog = container.querySelector('[aria-label="Device event entries"]')!;
    expect(ioLog.textContent).toContain("pan-right");
    expect(ioLog.textContent).toContain("routing cell 1");
    expect(hid.getLastInputReport()?.kind).toBe("routing");
    expect(hid.getLastInputReport()?.routingCell).toBe(1);

    // 2. Navigate to #/sessions, export session JSON, and delete session with Delete key
    router.navigate("sessions");
    await vi.waitFor(() => {
      expect(router?.getCurrentRoute()?.id).toBe("sessions");
      expect(container.querySelectorAll("li[data-session]")).toHaveLength(1);
    });

    const sessionItem = container.querySelector<HTMLElement>("li[data-session]")!;
    const exportBtn = sessionItem.querySelector<HTMLButtonElement>("button")!;
    exportBtn.click();

    sessionItem.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    await vi.waitFor(() => {
      expect(wf.listSessions()).toHaveLength(0);
    });

    // 3. Verify BrowserStore persisted the session deletion and Settings preferences survive reload
    const persisted = await loadWorkspaceState();
    expect(persisted?.workflowState.documents).toHaveLength(1);
    expect(persisted?.workflowState.sessions).toHaveLength(0);

    router.navigate("settings");
    await vi.waitFor(() => {
      expect(router?.getCurrentRoute()?.id).toBe("settings");
    });
    const cellSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Display cell count"]',
    )!;
    cellSelect.value = "80";
    cellSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(loadPreferences().displayCellCount).toBe(80);
  });
});
