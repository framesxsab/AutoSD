/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../../package.json";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";
import { OpenAIEmbeddingProvider } from "../../src/retrieval/providers/OpenAIEmbeddingProvider.js";
import { LiveSync } from "../../src/app/LiveSync.js";
import { DeviceManager } from "../../src/core/DeviceManager.js";
import { MockDevice } from "../../src/devices/MockDevice.js";
import {
  collectDiagnostics,
  formatDiagnosticsReport,
  sanitize,
} from "../../src/app/diagnostics.js";
import { DiagnosticsPanel } from "../../src/ui/DiagnosticsPanel.js";

describe("diagnostics", () => {
  let dir: string;
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "autosd-diag-"));
    delete process.env.OPENAI_API_KEY;
  });
  afterEach(async () => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("collects the full diagnostics surface", async () => {
    const provider = new MockEmbeddingProvider();
    const wf = new ResearchWorkflow({ provider });
    await wf.ingest([{ id: "doc-1", content: "alpha beta gamma delta" }]);
    const sync = new LiveSync(wf, dir);
    await sync.start();

    const dm = new DeviceManager();
    dm.register(new MockDevice());

    const report = collectDiagnostics({
      workflow: wf,
      liveSync: sync,
      deviceManager: dm,
      provider,
    });

    expect(report.version).toBe(packageJson.version);
    expect(typeof report.build).toBe("string");
    expect(report.build.length).toBeGreaterThan(0);
    expect(report.provider).toEqual({ id: "mock", model: "mock-384", dimensions: 384 });
    expect(report.device.active).toMatchObject({ id: "mock-1", kind: "mock", name: "MockDevice" });
    expect(report.corpus.documentCount).toBe(1);
    expect(report.corpus.chunkCount).toBeGreaterThan(0);
    expect(report.corpus.version).toBe(wf.getManifest()?.version);
    expect(report.watcher.isRunning).toBe(true);
    expect(report.watcher.status).toBe("Idle");
    expect(report.indexing.pending).toBe(false);
    expect(report.services.hidAvailable).toBe(false);
    expect(report.services.openAIConfigured).toBe(false);

    sync.stop();
    expect(collectDiagnostics({ liveSync: sync }).watcher.isRunning).toBe(false);
  });

  it("never includes secrets in the report", async () => {
    process.env.OPENAI_API_KEY = "sk-super-secret-value-123";
    const secretProvider = new OpenAIEmbeddingProvider();
    const wf = new ResearchWorkflow({ provider: secretProvider });

    const report = collectDiagnostics({
      workflow: wf,
      provider: secretProvider,
      deviceManager: null,
    });
    report.services.openAIConfigured = true;

    const json = formatDiagnosticsReport(report);
    expect(json).not.toContain("sk-super-secret-value-123");
    expect(json).not.toContain("sk-");

    const walk = (value: unknown, path = ""): string[] => {
      if (value === null || typeof value !== "object") return [];
      return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
        ...(/(key|token|secret|password|authorization)/i.test(k) ? [`${path}.${k}`] : []),
        ...walk(v, `${path}.${k}`),
      ]);
    };
    expect(walk(JSON.parse(json))).toEqual([]);
  });

  it("sanitize redacts sensitive keys and strips stacks/functions", () => {
    const err = new Error("boom");
    const out = sanitize({
      apiKey: "k",
      accessToken: "t",
      nested: { clientSecret: "s", ok: 1 },
      fn: () => 1,
      err,
    }) as Record<string, unknown>;
    expect(out.apiKey).toBe("[redacted]");
    expect(out.accessToken).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).clientSecret).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).ok).toBe(1);
    expect(out.fn).toBe("[function]");
    expect(JSON.stringify(out.err)).not.toContain("stack");
  });

  it("copies the report via clipboard and announces success", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const panel = new DiagnosticsPanel({
      collect: () =>
        collectDiagnostics({
          workflow: null,
          provider: new MockEmbeddingProvider(),
        }),
    });
    panel.mount(host);

    const btn = host.querySelector('button[aria-label="Copy diagnostics report to clipboard"]');
    expect(btn).not.toBeNull();
    (btn as HTMLButtonElement).click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

    const copied = writeText.mock.calls[0][0];
    expect(() => JSON.parse(copied)).not.toThrow();
    expect(copied).toContain('"version"');
    expect(copied).toContain('"provider"');

    await vi.waitFor(() =>
      expect(host.querySelector('[role="status"][aria-live="polite"]')?.textContent).toContain(
        "copied to clipboard",
      ),
    );
    panel.unmount();
  });

  it("falls back to execCommand when clipboard API is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const execCopy = vi.fn<() => boolean>().mockReturnValue(true);
    document.execCommand = execCopy as unknown as typeof document.execCommand;

    const host = document.createElement("div");
    document.body.appendChild(host);
    const panel = new DiagnosticsPanel({ collect: () => collectDiagnostics() });
    panel.mount(host);

    const ok = await panel.copyToClipboard();
    expect(ok).toBe(true);
    expect(execCopy).toHaveBeenCalledWith("copy");
    panel.unmount();
  });
});
