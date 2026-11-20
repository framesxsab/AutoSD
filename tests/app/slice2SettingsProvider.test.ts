/** @vitest-environment jsdom */
/**
 * Slice 2 tests — #/settings OpenAI provider preservation & BrowserStore support.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AppRouter } from "../../src/app/router.js";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { OpenAIEmbeddingProvider } from "../../src/retrieval/providers/OpenAIEmbeddingProvider.js";
import { LexicalHashEmbeddingProvider } from "../../src/retrieval/providers/LexicalHashEmbeddingProvider.js";
import { createProviderById } from "../../src/app/bootstrap.js";
import { resetConfigCache } from "../../src/app/config.js";
import { clearPreferences, loadPreferences, savePreferences } from "../../src/app/BrowserStore.js";

describe("Slice 2 — #/settings OpenAI provider preservation", () => {
  let container: HTMLElement;
  let router: AppRouter | null = null;
  const origKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    clearPreferences();
    window.location.hash = "";
    delete process.env.OPENAI_API_KEY;
    resetConfigCache();
  });

  afterEach(() => {
    router?.stop();
    router = null;
    container.remove();
    clearPreferences();
    if (origKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = origKey;
    resetConfigCache();
  });

  it("BrowserStore persists and restores embeddingProvider='openai'", () => {
    savePreferences({ embeddingProvider: "openai", retrievalMode: "hybrid" });
    expect(loadPreferences().embeddingProvider).toBe("openai");
  });

  it("createProviderById('openai') creates OpenAI provider when configured and falls back safely when not", () => {
    expect(createProviderById("openai").id).toBe("mock");

    process.env.OPENAI_API_KEY = "sk-test-slice2-key-1234567890";
    resetConfigCache();
    const prov = createProviderById("openai");
    expect(prov.id).toBe("openai");
  });

  it("preserves an active OpenAIEmbeddingProvider in #/settings instead of downgrading to mock", async () => {
    const openaiProv = new OpenAIEmbeddingProvider(
      "text-embedding-3-small",
      1536,
      "",
      "https://embeddings.example.com/v1",
      true,
    );
    const wf = new ResearchWorkflow({ provider: openaiProv });
    router = new AppRouter({ container, workflow: wf });
    router.start();
    router.navigate("settings");

    await vi.waitFor(() => {
      expect(container.querySelector('select[aria-label="Embedding provider"]')).not.toBeNull();
    });

    const providerSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Embedding provider"]',
    )!;
    expect(providerSelect.value).toBe("openai");
    const openaiOpt = Array.from(providerSelect.options).find(o => o.value === "openai")!;
    expect(openaiOpt.disabled).toBe(false);

    // Changing another setting does not clobber the active OpenAI provider.
    const modeSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Default retrieval mode"]',
    )!;
    modeSelect.value = "bm25";
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(wf.getProvider().id).toBe("openai");
    expect(providerSelect.value).toBe("openai");
  });

  it("disables OpenAI option and guards change when no endpoint or key is configured", async () => {
    const wf = new ResearchWorkflow({ provider: new LexicalHashEmbeddingProvider() });
    router = new AppRouter({ container, workflow: wf });
    router.start();
    router.navigate("settings");

    await vi.waitFor(() => {
      expect(container.querySelector('select[aria-label="Embedding provider"]')).not.toBeNull();
    });

    const providerSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Embedding provider"]',
    )!;
    const openaiOpt = Array.from(providerSelect.options).find(o => o.value === "openai")!;
    expect(openaiOpt.disabled).toBe(true);
    expect(providerSelect.value).toBe("lexical");

    // Force-attempting change via script reverts cleanly without clobbering provider.
    providerSelect.value = "openai";
    providerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(wf.getProvider().id).toBe("lexical-hash");
    expect(providerSelect.value).toBe("lexical");
  });
});
