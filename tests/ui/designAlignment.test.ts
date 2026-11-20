/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AppRouter, ROUTES, type RouteId } from "../../src/app/router.js";
import { Workspace } from "../../src/app/Workspace.js";
import { getOnboardingComplete, setOnboardingComplete } from "../../src/app/OnboardingStore.js";
import { DeviceManager } from "../../src/core/DeviceManager.js";
import { VirtualDevice } from "../../src/devices/VirtualDevice.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";
import { VirtualList } from "../../src/ui/VirtualList.js";
import { ResearchWorkflow } from "../../src/workflows/research.js";

function assertValidHeadingOutline(root: HTMLElement): void {
  const headings = Array.from(root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"));
  expect(headings.length).toBeGreaterThan(0);
  let prevLevel = 0;
  for (const h of headings) {
    const level = Number(h.tagName.slice(1));
    if (prevLevel === 0) {
      expect(level).toBe(1);
    } else {
      expect(level).toBeLessThanOrEqual(prevLevel + 1);
    }
    prevLevel = level;
  }
}

describe("UI design alignment & interactive regression suite", () => {
  let container: HTMLElement;
  let router: AppRouter | undefined;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    window.location.hash = "#/home";
  });

  afterEach(() => {
    router?.stop();
    router = undefined;
    document.body.innerHTML = "";
    localStorage.clear();
    window.location.hash = "";
    vi.restoreAllMocks();
  });

  it("focuses the primary view heading on activation for every AppRouter route", async () => {
    const workflow = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    const deviceManager = new DeviceManager();
    router = new AppRouter({ container, workflow, deviceManager });
    router.start();

    const expectedRouteIds: RouteId[] = [
      "home",
      "reader",
      "workspace",
      "devices",
      "research",
      "sessions",
      "settings",
      "help",
      "demo",
    ];
    expect(ROUTES.map(r => r.id)).toEqual(expectedRouteIds);

    // Check initial home route, then navigate across all remaining routes and revisit home
    const activationOrder: RouteId[] = [
      "home",
      "reader",
      "workspace",
      "devices",
      "research",
      "sessions",
      "settings",
      "help",
      "demo",
      "home",
    ];

    for (const routeId of activationOrder) {
      router.navigate(routeId);
      await vi.waitFor(() => {
        expect(router?.getCurrentRoute()?.id).toBe(routeId);
        expect(container.querySelector("[data-autosd-lazy]")).toBeNull();
        const heading = container.querySelector<HTMLElement>("[data-autosd-view-heading]");
        expect(heading).not.toBeNull();
        expect(["H1", "H2"]).toContain(heading!.tagName);
        expect(document.activeElement).toBe(heading);
      });
    }
  });

  it("enforces valid Workspace heading hierarchy and VirtualList 72px border-box item sizing", async () => {
    const workflow = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await workflow.ingest([
      {
        id: "doc-ws",
        path: "workspace-guide.md",
        content: "AutoSD tactile knowledge workspace virtualized retrieval chunk content.",
      },
    ]);

    const ws = new Workspace(workflow);
    ws.mount(container);

    // Initial outline: h1 -> h2 across all sections, no skipped h3
    assertValidHeadingOutline(container);
    expect(container.querySelector("h1")?.dataset.autosdViewHeading).toBe("true");
    expect(container.querySelectorAll("h3")).toHaveLength(0);

    // Run search to mount VirtualList items
    const searchInput = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(searchInput).not.toBeNull();
    searchInput!.value = "tactile";
    searchInput!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    let chunkItem: HTMLElement | null = null;
    await vi.waitFor(() => {
      chunkItem = container.querySelector<HTMLElement>(".autosd-virtual-list [data-chunk]");
      expect(chunkItem).not.toBeNull();
    });

    expect(chunkItem!.classList.contains("autosd-virtual-list__item")).toBe(true);
    expect(chunkItem!.classList.contains("autosd-chunk-item")).toBe(true);
    expect(chunkItem!.style.boxSizing).toBe("border-box");
    expect(chunkItem!.style.minHeight).toBe("72px");

    // Inspecting a chunk introduces an h3 under the inspector h2 (valid h1 -> h2 -> h3 outline)
    chunkItem!.click();
    assertValidHeadingOutline(container);
    expect(container.querySelector('[aria-label="Citation inspector"] h2')?.textContent).toBe(
      "Citation inspector",
    );
    expect(container.querySelector('[aria-label="Citation inspector"] h3')?.textContent).toContain(
      "doc-ws",
    );

    ws.unmount();

    // Direct VirtualList contract verification with itemHeight = 72
    const list = new VirtualList<string>({
      itemHeight: 72,
      containerHeight: 240,
      renderItem: label => {
        const item = document.createElement("div");
        item.textContent = label;
        return item;
      },
    });
    const host = document.createElement("div");
    container.appendChild(host);
    list.mount(host);
    list.setItems(["Alpha", "Beta", "Gamma"]);

    const renderedItems = Array.from(
      list.getElement().querySelectorAll<HTMLElement>('[role="listitem"]'),
    );
    expect(renderedItems).toHaveLength(3);
    for (const item of renderedItems) {
      expect(item.classList.contains("autosd-virtual-list__item")).toBe(true);
      expect(item.style.boxSizing).toBe("border-box");
      expect(item.style.minHeight).toBe("72px");
    }
  });

  it("exposes Onboarding tour from #/home and #/settings alongside DiagnosticsPanel", async () => {
    const workflow = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    const deviceManager = new DeviceManager();
    router = new AppRouter({ container, workflow, deviceManager });
    router.start();

    // #/home -> Launch onboarding tour
    const launchBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Launch onboarding tour"]',
    );
    expect(launchBtn).not.toBeNull();
    expect(launchBtn!.textContent).toBe("Launch onboarding tour");

    launchBtn!.click();
    await vi.waitFor(() => {
      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
      expect(dialog).not.toBeNull();
      expect(dialog!.getAttribute("aria-label")).toBe("Introducing AutoSD");
    });

    const homeDialog = document.body.querySelector<HTMLElement>(
      '[role="dialog"][aria-modal="true"]',
    )!;
    const skipFromHome = Array.from(homeDialog.querySelectorAll("button")).find(
      b => b.textContent === "Skip onboarding",
    );
    expect(skipFromHome).toBeDefined();
    skipFromHome!.click();
    expect(document.body.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();

    // #/settings -> Replay onboarding tour + DiagnosticsPanel
    router.navigate("settings");
    await vi.waitFor(() => {
      expect(router?.getCurrentRoute()?.id).toBe("settings");
      expect(container.querySelector('[aria-label="Diagnostics"]')).not.toBeNull();
    });

    setOnboardingComplete(true);
    expect(getOnboardingComplete()).toBe(true);

    const replayBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Replay onboarding tour"]',
    );
    expect(replayBtn).not.toBeNull();
    expect(replayBtn!.textContent).toBe("Replay onboarding tour");

    replayBtn!.click();
    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    });
    expect(getOnboardingComplete()).toBe(false);

    const settingsDialog = document.body.querySelector<HTMLElement>(
      '[role="dialog"][aria-modal="true"]',
    )!;
    const skipFromSettings = Array.from(settingsDialog.querySelectorAll("button")).find(
      b => b.textContent === "Skip onboarding",
    );
    expect(skipFromSettings).toBeDefined();
    skipFromSettings!.click();
    expect(document.body.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
  });

  it("renders dot glyphs in #/devices tactile preview when sending a test pattern", async () => {
    const workflow = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    const deviceManager = new DeviceManager();
    const device = new VirtualDevice("virtual-1", "VirtualDevice", 40);
    await device.connect();
    deviceManager.register(device);

    router = new AppRouter({ container, workflow, deviceManager });
    router.start();
    router.navigate("devices");

    await vi.waitFor(() => {
      expect(router?.getCurrentRoute()?.id).toBe("devices");
      expect(container.querySelector("[data-autosd-lazy]")).toBeNull();
      expect(
        container.querySelector('[aria-label="Active device tactile preview"]'),
      ).not.toBeNull();
    });

    const preview = container.querySelector<HTMLElement>(
      '[aria-label="Active device tactile preview"]',
    )!;
    expect(preview.textContent).toContain("No pattern rendered yet.");

    const sendBtn = Array.from(container.querySelectorAll("button")).find(
      b => b.textContent === "Send test pattern to active device",
    );
    expect(sendBtn).toBeDefined();
    sendBtn!.click();

    await vi.waitFor(() => {
      expect(preview.textContent).toContain("●");
      expect(preview.textContent).toContain("dots active");
    });

    expect(device.snapshot().some(cell => cell > 0)).toBe(true);
  });

  it("preserves Welcome to AutoSD in #/reader and allows switching to an ingested corpus document", async () => {
    const workflow = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await workflow.ingest([
      {
        id: "doc-corpus-1",
        path: "corpus-guide.md",
        content: "Grounded tactile corpus document body for reader view switching.",
      },
    ]);

    router = new AppRouter({ container, workflow });
    router.start();
    router.navigate("reader");

    await vi.waitFor(() => {
      expect(router?.getCurrentRoute()?.id).toBe("reader");
      expect(container.querySelector("[data-autosd-lazy]")).toBeNull();
      expect(
        container.querySelector('[aria-label="Reader with grounded citations"]'),
      ).not.toBeNull();
    });

    const readerTitle = container.querySelector<HTMLElement>("#reader-title");
    expect(readerTitle?.textContent).toBe("Welcome to AutoSD");
    expect(container.textContent).toContain(
      "Select a document from the corpus to begin reading with grounded citations.",
    );

    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Select corpus document"]',
    );
    expect(select).not.toBeNull();
    expect(Array.from(select!.options).map(o => o.value)).toEqual(["welcome", "doc-corpus-1"]);

    const loadBtn = Array.from(container.querySelectorAll("button")).find(
      b => b.textContent === "Load document",
    );
    expect(loadBtn).toBeDefined();

    select!.value = "doc-corpus-1";
    loadBtn!.click();

    expect(container.querySelector("#reader-title")?.textContent).toBe("corpus-guide.md");
    expect(
      container.querySelector('[aria-label="Reader with grounded citations"]')?.textContent,
    ).toContain("Grounded tactile corpus document body for reader view switching.");

    select!.value = "welcome";
    loadBtn!.click();
    expect(container.querySelector("#reader-title")?.textContent).toBe("Welcome to AutoSD");
  });

  it("verifies index.html contains single .skip-link:focus, global box-sizing, input/summary focus rules, and 36px targets", async () => {
    const html = await readFile(resolve(process.cwd(), "index.html"), "utf8");

    const skipLinkFocusMatches = html.match(/\.skip-link:focus\s*\{/g) ?? [];
    expect(skipLinkFocusMatches).toHaveLength(1);

    expect(html).toMatch(/\*\s*,\s*\*::before\s*,\s*\*::after\s*\{[^}]*box-sizing:\s*border-box/s);
    expect(html).toContain("input:focus");
    expect(html).toContain("summary:focus");
    expect(html).toContain("min-height: 36px");
  });
});
