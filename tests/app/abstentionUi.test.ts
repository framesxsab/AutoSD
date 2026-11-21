/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  clearPreferences,
  loadPreferences,
  PREFS_STORAGE_KEY,
  savePreferences,
} from "../../src/app/BrowserStore.js";
import { AppRouter } from "../../src/app/router.js";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { LexicalHashEmbeddingProvider } from "../../src/retrieval/providers/LexicalHashEmbeddingProvider.js";

describe("Low-evidence abstention UI (#/settings <-> #/research) and BrowserStore", () => {
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

  it("persists and validates abstainOnLowEvidence in BrowserStore", () => {
    savePreferences({ abstainOnLowEvidence: true });
    expect(loadPreferences().abstainOnLowEvidence).toBe(true);

    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ abstainOnLowEvidence: "yes" }));
    expect(loadPreferences().abstainOnLowEvidence).toBeUndefined();
  });

  it("syncs Abstain on low evidence between #/settings and #/research and renders abstention banner on OOD queries", async () => {
    const wf = new ResearchWorkflow({
      provider: new LexicalHashEmbeddingProvider(),
      reranker: true,
    });
    await wf.ingest([
      {
        id: "braille-hw",
        path: "braille.md",
        content: "Refreshable braille displays actuate piezoelectric tactile pins at 60 Hz.",
      },
    ]);

    router = new AppRouter({ container, workflow: wf });
    router.start();

    await vi.waitFor(() => {
      expect(container.querySelector('input[aria-label="Abstain on low evidence"]')).not.toBeNull();
    });
    const settingsCheck = container.querySelector<HTMLInputElement>(
      'input[aria-label="Abstain on low evidence"]',
    )!;
    settingsCheck.checked = true;
    settingsCheck.dispatchEvent(new Event("change", { bubbles: true }));
    expect(loadPreferences().abstainOnLowEvidence).toBe(true);

    // Navigate to #/research — inline toggle should be checked automatically
    router.navigate("research");
    await vi.waitFor(() => {
      const researchToggle = container.querySelector<HTMLInputElement>(
        "[data-autosd-abstain-toggle]",
      );
      expect(researchToggle).not.toBeNull();
      expect(researchToggle!.checked).toBe(true);
    });

    // Submit out-of-domain query -> renders explicit abstention banner with 0 citations
    const searchInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Research question"]',
    )!;
    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      b => b.textContent === "Run research",
    )!;
    searchInput.value = "sourdough starter hydration fermentation temperature";
    submitBtn.click();

    await vi.waitFor(() => {
      const banner = container.querySelector("[data-autosd-abstention]");
      expect(banner).not.toBeNull();
      expect(banner!.textContent).toContain("Abstained");
      expect(container.querySelector(".autosd-confidence-badge")).toBeNull();
    });

    // Submit in-domain query -> renders normal grounded answer + confidence badge
    searchInput.value = "piezoelectric tactile pins refreshable braille";
    submitBtn.click();

    await vi.waitFor(() => {
      expect(container.querySelector("[data-autosd-abstention]")).toBeNull();
      expect(container.querySelector(".autosd-confidence-badge")?.textContent).toContain(
        "Confidence",
      );
    });
  });
});
