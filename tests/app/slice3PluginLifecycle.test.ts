/** @vitest-environment jsdom */
/**
 * Slice 3 integration tests — Real PluginHost / PluginRegistry wiring
 * in bootstrapApp(), #/settings Marketplace toggles, and BrowserStore persistence.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DIContainer } from "../../src/core/DIContainer.js";
import { bootstrapApp, PLUGIN_HOST_TOKEN } from "../../src/app/bootstrap.js";
import { AppRouter } from "../../src/app/router.js";
import { clearPreferences, loadPreferences, savePreferences } from "../../src/app/BrowserStore.js";

describe("Slice 3 — PluginHost / PluginRegistry lifecycle & persistence", () => {
  let dir: string;
  let container: HTMLElement;
  let router: AppRouter | null = null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "autosd-s3-"));
    container = document.createElement("div");
    document.body.appendChild(container);
    clearPreferences();
    window.location.hash = "";
  });

  afterEach(async () => {
    router?.stop();
    router = null;
    container.remove();
    clearPreferences();
    await rm(dir, { recursive: true, force: true });
  });

  it("bootstrapApp registers catalog plugins, activates default plugin, and exposes callable workflow", async () => {
    const di = new DIContainer();
    const res = await bootstrapApp({ corpusDir: dir, di, interactiveDefaults: true });
    try {
      expect(di.has(PLUGIN_HOST_TOKEN)).toBe(true);
      expect(res.pluginHost.registry.ids().sort()).toEqual([
        "autosd-braille",
        "autosd-reader",
        "autosd-tts",
      ]);
      expect(res.pluginHost.registry.get("autosd-reader")?.state).toBe("active");
      expect(res.pluginHost.hasWorkflow("autosd-reader:paginate")).toBe(true);
      expect(res.pluginHost.hasWorkflow("autosd-braille:encode")).toBe(false);

      const pages = (await res.pluginHost.runWorkflow("autosd-reader:paginate", {
        id: "p1",
        title: "Sample",
        content: "Hello braille world.",
      })) as unknown[];
      expect(pages.length).toBe(1);
    } finally {
      res.stop();
    }
  });

  it("toggling plugins in #/settings activates/deactivates real workflows and persists across route switches and restarts", async () => {
    const di1 = new DIContainer();
    const boot1 = await bootstrapApp({ corpusDir: dir, di: di1, interactiveDefaults: true });
    try {
      router = new AppRouter({
        container,
        workflow: boot1.workflow,
        liveSync: boot1.liveSync,
        deviceManager: boot1.deviceManager,
        pluginHost: boot1.pluginHost,
      });
      router.start();
      router.navigate("settings");

      await vi.waitFor(() => {
        expect(container.querySelector('[data-plugin-id="autosd-braille"] button')).not.toBeNull();
      });

      // Enable Braille Plugin
      const brailleBtn = container.querySelector<HTMLButtonElement>(
        '[data-plugin-id="autosd-braille"] button',
      )!;
      expect(brailleBtn.getAttribute("aria-pressed")).toBe("false");
      brailleBtn.click();

      await vi.waitFor(() => {
        expect(boot1.pluginHost.registry.get("autosd-braille")?.state).toBe("active");
        expect(boot1.pluginHost.hasWorkflow("autosd-braille:encode")).toBe(true);
      });

      const encoded = (await boot1.pluginHost.runWorkflow("autosd-braille:encode", {
        text: "hi",
        cellCount: 20,
      })) as { unicode: string };
      expect(encoded.unicode.length).toBeGreaterThan(0);

      // Disable Reader Plugin
      const readerBtn = container.querySelector<HTMLButtonElement>(
        '[data-plugin-id="autosd-reader"] button',
      )!;
      readerBtn.click();

      await vi.waitFor(() => {
        expect(boot1.pluginHost.registry.get("autosd-reader")?.state).toBe("inactive");
        expect(boot1.pluginHost.hasWorkflow("autosd-reader:paginate")).toBe(false);
      });

      expect(loadPreferences().installedPlugins).toEqual(["autosd-braille"]);

      // Navigate away and back — UI reflects persisted live PluginHost state
      router.navigate("home");
      await vi.waitFor(() => {
        expect(router?.getCurrentRoute()?.id).toBe("home");
      });
      router.navigate("settings");
      await vi.waitFor(() => {
        const b = container.querySelector<HTMLButtonElement>(
          '[data-plugin-id="autosd-braille"] button',
        );
        const r = container.querySelector<HTMLButtonElement>(
          '[data-plugin-id="autosd-reader"] button',
        );
        expect(b?.getAttribute("aria-pressed")).toBe("true");
        expect(r?.getAttribute("aria-pressed")).toBe("false");
      });
    } finally {
      router?.stop();
      router = null;
      boot1.stop();
    }

    // Fresh bootstrapApp restart restores the persisted plugin selection
    const di2 = new DIContainer();
    const boot2 = await bootstrapApp({ corpusDir: dir, di: di2, interactiveDefaults: true });
    try {
      expect(boot2.pluginHost.registry.get("autosd-braille")?.state).toBe("active");
      expect(boot2.pluginHost.registry.get("autosd-reader")?.state).toBe("registered");
      expect(boot2.pluginHost.hasWorkflow("autosd-braille:encode")).toBe(true);
    } finally {
      boot2.stop();
    }
  });

  it("ignores unknown saved plugin IDs gracefully on startup without throwing", async () => {
    savePreferences({ installedPlugins: ["nonexistent-plugin", "autosd-tts"] });
    const di = new DIContainer();
    const res = await bootstrapApp({ corpusDir: dir, di, interactiveDefaults: true });
    try {
      expect(res.pluginHost.registry.get("autosd-tts")?.state).toBe("active");
      expect(res.pluginHost.hasWorkflow("autosd-tts:prepare")).toBe(true);
      const tts = (await res.pluginHost.runWorkflow(
        "autosd-tts:prepare",
        "First sentence. Second sentence!",
      )) as { segments: string[]; estimatedSeconds: number };
      expect(tts.segments).toEqual(["First sentence.", "Second sentence!"]);
      expect(tts.estimatedSeconds).toBeGreaterThan(0);
    } finally {
      res.stop();
    }
  });
});
