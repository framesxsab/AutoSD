/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapApp } from "../../src/app/bootstrap.js";
import {
  clearPreferences,
  clearWorkspaceState,
  loadPreferences,
  loadWorkspaceState,
  saveWorkspaceState,
  WORKSPACE_STORAGE_KEY,
} from "../../src/app/BrowserStore.js";
import { AppRouter } from "../../src/app/router.js";
import { LiveSync } from "../../src/app/LiveSync.js";
import { Workspace } from "../../src/app/Workspace.js";
import { DIContainer } from "../../src/core/DIContainer.js";
import { DeviceManager } from "../../src/core/DeviceManager.js";
import { VirtualDevice } from "../../src/devices/VirtualDevice.js";
import { LexicalHashEmbeddingProvider } from "../../src/retrieval/providers/LexicalHashEmbeddingProvider.js";
import { ResearchWorkflow } from "../../src/workflows/research.js";

describe("v1.2 connected workflows, browser store, settings, and tactile UI", () => {
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
    dir = await mkdtemp(join(tmpdir(), "autosd-v12-ui-"));
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

  it("BrowserStore persists workspace state and preferences via localStorage fallback", async () => {
    const wf = new ResearchWorkflow({ provider: new LexicalHashEmbeddingProvider() });
    await wf.ingest([{ id: "b1", path: "browser.md", content: "Persisted browser knowledge." }]);
    await wf.run({ id: "qb", question: "browser knowledge" });

    await saveWorkspaceState(wf.toPersistedState());
    const loaded = await loadWorkspaceState();
    expect(loaded).not.toBeNull();
    expect(loaded!.workflowState.documents).toHaveLength(1);
    expect(loaded!.workflowState.sessions).toHaveLength(1);

    // Corrupt storage falls back to null without throwing
    localStorage.setItem(WORKSPACE_STORAGE_KEY, "{not-valid-json");
    expect(await loadWorkspaceState()).toBeNull();

    // bootstrapApp with interactiveDefaults restores from BrowserStore when disk is absent
    await saveWorkspaceState(wf.toPersistedState());
    const di = new DIContainer();
    const app = await bootstrapApp({
      di,
      corpusDir: join(dir, "missing"),
      interactiveDefaults: true,
    });
    expect(app.workflow.getProvider().id).toBe("lexical-hash");
    expect(app.workflow.isRerankingEnabled()).toBe(true);
    expect(app.workflow.listDocuments()).toHaveLength(1);
    expect(app.workflow.listSessions()).toHaveLength(1);
    app.stop();
    di.clear();
  });

  it("Workspace manages sample corpus, custom document creation, XSS safety, and document removal", async () => {
    const wf = new ResearchWorkflow({ provider: new LexicalHashEmbeddingProvider() });
    const onMutate = vi.fn();
    const onOpenInReader = vi.fn();
    const ws = new Workspace(wf, { onMutate, onOpenInReader });
    ws.mount(container);

    const sampleBtn = Array.from(container.querySelectorAll("button")).find(
      b => b.textContent === "Load sample corpus",
    )!;
    expect(sampleBtn).toBeDefined();
    sampleBtn.click();

    await vi.waitFor(() => {
      expect(wf.listDocuments().length).toBeGreaterThanOrEqual(3);
      expect(onMutate).toHaveBeenCalled();
    });

    // Add custom document with potentially hostile HTML markup — rendered strictly as text
    const titleInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Document title"]',
    )!;
    const contentInput = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Document content"]',
    )!;
    const addBtn = Array.from(container.querySelectorAll("button")).find(
      b => b.textContent === "Add document",
    )!;

    titleInput.value = "Custom Note";
    contentInput.value = 'Note <img src=x onerror="window.__v12xss=1"> tactile notes';
    addBtn.click();

    let openBtn: HTMLButtonElement | null = null;
    await vi.waitFor(() => {
      expect(wf.getDocument("custom-note")).toBeDefined();
      openBtn = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Open custom-note in Reader"]',
      );
      expect(openBtn).not.toBeNull();
    });
    expect(container.querySelector("img")).toBeNull();

    // Open in Reader action
    openBtn!.click();
    expect(onOpenInReader).toHaveBeenCalledWith({ documentId: "custom-note" });

    // Remove document action
    const removeBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove document custom-note"]',
    )!;
    removeBtn.click();
    await vi.waitFor(() => {
      expect(wf.getDocument("custom-note")).toBeUndefined();
      expect(
        container.querySelector('button[aria-label="Remove document custom-note"]'),
      ).toBeNull();
    });

    ws.unmount();
  });

  it("connects Research citations directly to ReaderView with highlight and tactile page output", async () => {
    const wf = new ResearchWorkflow({
      provider: new LexicalHashEmbeddingProvider(),
      reranker: true,
    });
    await wf.ingest([
      {
        id: "doc-guide",
        path: "guide.md",
        content: "Refreshable braille displays actuate pins for tactile reading.",
      },
      {
        id: "doc-other",
        path: "other.md",
        content: "Unrelated weather forecast notes.",
      },
    ]);

    const dm = new DeviceManager();
    const vdev = new VirtualDevice("v1", "VirtualDisplay", 40);
    await vdev.connect();
    dm.register(vdev);

    router = new AppRouter({ container, workflow: wf, deviceManager: dm });
    router.start();
    router.navigate("research");

    await vi.waitFor(() => {
      expect(router?.getCurrentRoute()?.id).toBe("research");
      expect(container.querySelector('input[aria-label="Research question"]')).not.toBeNull();
    });

    const scopeSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Scope to corpus document"]',
    )!;
    scopeSelect.value = "doc-guide";

    const questionInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Research question"]',
    )!;
    questionInput.value = "braille displays actuate pins";

    const form = container.querySelector<HTMLFormElement>("form.autosd-search-form")!;
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

    let citeItem: HTMLElement | null = null;
    await vi.waitFor(() => {
      citeItem = container.querySelector<HTMLElement>('[data-chunk^="doc-guide#"]');
      expect(citeItem).not.toBeNull();
    });

    // Clicking the citation navigates to #/reader with doc-guide & highlighted chunk
    citeItem!.click();
    await vi.waitFor(() => {
      expect(router?.getCurrentRoute()?.id).toBe("reader");
      expect(container.querySelector("#reader-title")?.textContent).toBe("guide.md");
      expect(container.querySelector('[data-cited="doc-guide#0"]')).not.toBeNull();
    });

    // Send page to tactile device updates preview & writes braille cells to VirtualDevice
    const sendBtn = Array.from(container.querySelectorAll("button")).find(
      b => b.textContent === "Send page to tactile device",
    )!;
    expect(sendBtn).toBeDefined();
    sendBtn.click();

    await vi.waitFor(() => {
      const strip = container.querySelector('[aria-label="Reader tactile output"]')!;
      expect(strip.textContent).toContain("UEB Grade 1 Braille");
      expect(vdev.snapshot().some(c => c > 0)).toBe(true);
    });
  });

  it("allows hot-swapping provider, retrieval mode, and preferences in #/settings", async () => {
    const wf = new ResearchWorkflow({ provider: new LexicalHashEmbeddingProvider() });
    await wf.ingest([{ id: "s1", content: "Settings test document content." }]);
    const sync = new LiveSync(wf, join(dir, "docs"));
    router = new AppRouter({ container, workflow: wf, liveSync: sync });
    router.start();
    router.navigate("settings");

    await vi.waitFor(() => {
      expect(router?.getCurrentRoute()?.id).toBe("settings");
      expect(container.querySelector('select[aria-label="Embedding provider"]')).not.toBeNull();
    });

    const providerSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Embedding provider"]',
    )!;
    providerSelect.value = "mock";
    providerSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(wf.getProvider().id).toBe("mock");
    expect(loadPreferences().embeddingProvider).toBe("mock");
    expect(container.querySelector('[aria-label="Diagnostics"]')?.textContent).toContain("mock");

    const modeSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Default retrieval mode"]',
    )!;
    modeSelect.value = "bm25";
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(wf.getRetrievalMode()).toBe("bm25");
    expect(loadPreferences().retrievalMode).toBe("bm25");

    const rerankCheck = container.querySelector<HTMLInputElement>(
      'input[aria-label="Enable lexical reranking"]',
    )!;
    rerankCheck.checked = true;
    rerankCheck.dispatchEvent(new Event("change", { bubbles: true }));
    expect(wf.isRerankingEnabled()).toBe(true);

    // Marketplace plugin filter & enable
    const pluginFilter = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search plugin catalog"]',
    )!;
    pluginFilter.value = "braille";
    pluginFilter.dispatchEvent(new Event("input", { bubbles: true }));
    expect(container.querySelector('[aria-label="Available plugins"]')?.textContent).toContain(
      "Braille Plugin",
    );

    const resetBtn = Array.from(container.querySelectorAll("button")).find(
      b => b.textContent === "Reset local workspace",
    )!;
    resetBtn.click();
    expect(wf.listDocuments()).toHaveLength(0);
  });

  it("provisions VirtualDevice and renders UEB Grade 1 Braille with I/O log in #/devices", async () => {
    const wf = new ResearchWorkflow({ provider: new LexicalHashEmbeddingProvider() });
    const dm = new DeviceManager();
    router = new AppRouter({ container, workflow: wf, deviceManager: dm });
    router.start();
    router.navigate("devices");

    await vi.waitFor(() => {
      expect(router?.getCurrentRoute()?.id).toBe("devices");
      expect(container.querySelector("button")).not.toBeNull();
      expect(container.textContent).toContain("Add virtual device");
    });

    const cellSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Virtual device cell count"]',
    )!;
    cellSelect.value = "80";

    const addVirtualBtn = Array.from(container.querySelectorAll("button")).find(
      b => b.textContent === "Add virtual device",
    )!;
    addVirtualBtn.click();

    await vi.waitFor(() => {
      expect(dm.list()).toHaveLength(1);
      expect(dm.getActive()?.info.capabilities.dotCount).toBe(80);
    });

    const textInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Custom tactile text"]',
    )!;
    textInput.value = "Hi";
    const renderBtn = Array.from(container.querySelectorAll("button")).find(
      b => b.textContent === "Render to active device",
    )!;
    renderBtn.click();

    await vi.waitFor(() => {
      const preview = container.querySelector('[aria-label="Active device tactile preview"]')!;
      expect(preview.textContent).toContain("Braille: ⠠⠓⠊");
      expect(preview.textContent).toContain("●");
      const log = container.querySelector('[aria-label="Device event entries"]')!;
      expect(log.textContent).toContain("[display]");
    });

    // Connect HID display handles absent WebHID gracefully, then succeeds when mocked
    const hidBtn = Array.from(container.querySelectorAll("button")).find(
      b => b.textContent === "Connect HID display",
    )!;
    expect(hidBtn).toBeDefined();
    hidBtn.click();
    await vi.waitFor(() => {
      const log = container.querySelector('[aria-label="Device event entries"]')!;
      expect(log.textContent).toContain("WebHID requestDevice unavailable");
    });

    Object.defineProperty(navigator, "hid", {
      value: { requestDevice: vi.fn().mockResolvedValue([{ productName: "MockHID" }]) },
      configurable: true,
    });
    hidBtn.click();
    await vi.waitFor(() => {
      expect(dm.list().some(d => d.kind === "hid")).toBe(true);
    });
    Object.defineProperty(navigator, "hid", { value: undefined, configurable: true });
  });

  it("opens cited document in #/reader when clicking a citation from #/sessions", async () => {
    const wf = new ResearchWorkflow({ provider: new LexicalHashEmbeddingProvider() });
    await wf.ingest([
      { id: "sess-doc", path: "session-guide.md", content: "Session deep link tactile citation." },
    ]);
    await wf.run({ id: "q-sess", question: "tactile citation" });

    router = new AppRouter({ container, workflow: wf });
    router.start();
    router.navigate("sessions");

    await vi.waitFor(() => {
      expect(router?.getCurrentRoute()?.id).toBe("sessions");
      expect(container.querySelector('[data-chunk="sess-doc#0"]')).not.toBeNull();
    });

    const citeEl = container.querySelector<HTMLElement>('[data-chunk="sess-doc#0"]')!;
    citeEl.click();

    await vi.waitFor(() => {
      expect(router?.getCurrentRoute()?.id).toBe("reader");
      expect(container.querySelector("#reader-title")?.textContent).toBe("session-guide.md");
      expect(container.querySelector('[data-cited="sess-doc#0"]')).not.toBeNull();
    });
  });
});
