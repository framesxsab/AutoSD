/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { runDemo, DEMO_CORPUS, DEMO_STEPS } from "../../src/app/demo.js";
import type { DemoResult, DemoStepId } from "../../src/app/demo.js";
import { VirtualDevice } from "../../src/devices/VirtualDevice.js";
import { DemoPanel } from "../../src/ui/DemoPanel.js";

async function runIsolated(): Promise<DemoResult> {
  return runDemo();
}

describe("runDemo (deterministic showcase)", () => {
  it("produces byte-identical exports and identical results across runs", async () => {
    const a = await runIsolated();
    const b = await runIsolated();

    expect(a.exportJson).toBe(b.exportJson);
    expect(a.citations).toEqual(b.citations);
    expect(a.answer).toBe(b.answer);
    expect(a.confidence).toBe(b.confidence);
    expect(a.frames).toEqual(b.frames);

    // Canonical export carries no volatile fields.
    const parsed = JSON.parse(a.exportJson) as Record<string, unknown>;
    expect(parsed.demo).toBe("autosd-demo");
    expect(JSON.stringify(parsed)).not.toMatch(/created|generatedAt|indexedAt|sess-/i);

    // Full canonical path coverage: corpus → citations → frames → diagnostics.
    expect(a.corpusIds).toEqual(DEMO_CORPUS.map(d => d.id));
    expect(a.citations.length).toBeGreaterThan(0);
    expect(a.frames.length).toBeGreaterThan(0);
    expect(a.diagnostics.provider.id).toBe("mock");
    expect(a.diagnostics.device.active?.kind).toBe("virtual");
  });

  it("requires no hardware, API key, or network — virtual device only", async () => {
    const device = new VirtualDevice();
    await device.connect();
    const result = await runDemo({ device });

    expect(device.info.kind).toBe("virtual");
    expect(result.diagnostics.provider.model).toBe("mock-384");
    // Frames were actually rendered onto the framebuffer: last snapshot
    // matches the final frame's pattern.
    const snapshot = await device.read();
    const fb = Array.from(snapshot ?? new Uint8Array());
    expect(fb.length).toBeGreaterThan(0);
    const lastFrame = result.frames[result.frames.length - 1];
    expect(fb).toEqual(lastFrame.framebuffer);
    expect(lastFrame.pattern.length).toBe(device.info.capabilities.dotCount ?? 40);
    // Export embeds the same tactile data — no external service involved.
    const parsed = JSON.parse(result.exportJson) as {
      tactile: { frames: { pattern: number[] }[] };
    };
    expect(parsed.tactile.frames.at(-1)?.pattern).toEqual(lastFrame.pattern);
  });

  it("emits ordered progress transitions for every step", async () => {
    const events: { step: DemoStepId; status: string }[] = [];
    await runDemo({
      onProgress: (step, status) => events.push({ step, status }),
    });
    const stepsSeen = [...new Set(events.map(e => e.step))];
    expect(stepsSeen).toEqual([...DEMO_STEPS]);
    for (const step of DEMO_STEPS) {
      const statuses = events.filter(e => e.step === step).map(e => e.status);
      expect(statuses[0]).toBe("running");
      expect(statuses.at(-1)).toBe("done");
    }
  });
});

describe("DemoPanel", () => {
  it("runs the demo from the button, renders citations/frames/diagnostics, enables export", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const panel = new DemoPanel();
    panel.mount(parent);

    const runBtn = parent.querySelector<HTMLButtonElement>(
      'button[aria-label="Run the AutoSD demonstration"]',
    )!;
    expect(runBtn).not.toBeNull();
    expect(panel.getExportJson()).toBeNull();

    runBtn.click();
    expect(runBtn.disabled).toBe(true);
    await vi.waitFor(
      () => {
        expect(panel.isRunning()).toBe(false);
        expect(panel.getExportJson()).not.toBeNull();
      },
      { timeout: 5000 },
    );

    const results = parent.querySelector('[aria-label="Demo results"]')!;
    expect(results.querySelector('[aria-label="Grounded citations"]')).not.toBeNull();
    expect(results.querySelectorAll('[role="img"]').length).toBeGreaterThan(0);
    expect(results.querySelector('[aria-label="Demo diagnostics"]')).not.toBeNull();

    // Progress list fully done + live region announced completion.
    for (const li of Array.from(parent.querySelectorAll<HTMLElement>("li[data-step]"))) {
      expect(li.dataset.status).toBe("done");
    }
    const live = parent.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toContain("Demo complete");

    // Focus moved to results heading for keyboard users.
    expect(document.activeElement?.hasAttribute("data-demo-results-heading")).toBe(true);

    // Copy button works without throwing (clipboard may be absent in jsdom).
    const buttons = Array.from(parent.querySelectorAll("button"));
    const exportCopy = buttons.find(b => b.textContent === "Copy demo JSON")!;
    expect(exportCopy).toBeDefined();
    exportCopy.click();

    panel.unmount();
    parent.remove();
  });
});
