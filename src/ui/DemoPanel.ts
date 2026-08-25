/**
 * DemoPanel — accessible UI for the deterministic AutoSD demo (v0.9).
 *
 * One button runs the canonical path (ingest → search → citations → tactile
 * → diagnostics → export) and renders every stage below it.
 *
 * A11y guarantees (WCAG 2.2 AA):
 * - Landmark region labelled by its heading; native <button> controls.
 * - Progress is a real list mirrored into a polite live region.
 * - Citations reuse CitationView (roving arrow-key focus, Enter/Space).
 * - Tactile frames expose role="img" labels with active-dot counts.
 * - Focus moves to the results heading on completion; run button is
 *   disabled while running; no motion beyond text updates (reduced-motion
 *   safe by construction).
 */
import { createLiveRegion } from "../accessibility/a11y.js";
import { createCitationList } from "./CitationView.js";
import { copyText } from "./DiagnosticsPanel.js";
import {
  DEMO_STEPS,
  DEMO_QUERY,
  demoResearchResult,
  formatDemoReport,
  runDemo,
} from "../app/demo.js";
import type { DemoResult, DemoStepId, DemoStepStatus } from "../app/demo.js";
import type { ResearchWorkflow } from "../workflows/research.js";
import type { Device } from "../core/Device.js";

export type DemoPanelOptions = {
  /** Reuse an existing workflow (defaults to an isolated fresh one). */
  workflow?: ResearchWorkflow;
  /** Reuse an existing device (defaults to a fresh VirtualDevice). */
  device?: Device;
  /** Extra announcement sink (e.g., the app router live region). */
  announce?: (message: string) => void;
};

const STEP_LABELS: Record<DemoStepId, string> = {
  ingest: "Ingest corpus",
  search: "Search",
  citations: "Collect citations",
  tactile: "Render tactile output",
  diagnostics: "Collect diagnostics",
  export: "Export session JSON",
};

export class DemoPanel {
  private container!: HTMLElement;
  private liveEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private runBtn!: HTMLButtonElement;
  private stepsEl!: HTMLElement;
  private resultsEl!: HTMLElement;
  private stepItems = new Map<DemoStepId, HTMLElement>();
  private headingId = `demo-heading-${Math.random().toString(36).slice(2, 8)}`;
  private running = false;
  private lastResult: DemoResult | null = null;
  private readonly opts: DemoPanelOptions;

  constructor(opts: DemoPanelOptions = {}) {
    this.opts = opts;
  }

  mount(parent: HTMLElement): HTMLElement {
    this.container = document.createElement("section");
    this.container.setAttribute("role", "region");
    this.container.setAttribute("aria-labelledby", this.headingId);
    this.container.setAttribute("aria-label", "Demo showcase");

    const heading = document.createElement("h2");
    heading.id = this.headingId;
    heading.textContent = "Demo";
    this.container.appendChild(heading);

    const intro = document.createElement("p");
    intro.textContent =
      "Runs the full pipeline end to end — corpus ingest, search, grounded citations, " +
      "tactile output on a virtual device, diagnostics, and session export. " +
      "Deterministic and software-only: no hardware, API key, or network required.";
    this.container.appendChild(intro);

    this.runBtn = document.createElement("button");
    this.runBtn.type = "button";
    this.runBtn.textContent = "Run demo";
    this.runBtn.setAttribute("aria-label", "Run the AutoSD demonstration");
    this.runBtn.style.minHeight = "32px";
    this.runBtn.addEventListener("click", () => {
      void this.start();
    });
    this.container.appendChild(this.runBtn);

    this.statusEl = document.createElement("p");
    this.statusEl.setAttribute("role", "status");
    this.statusEl.textContent = "Demo not started yet.";
    this.container.appendChild(this.statusEl);

    this.stepsEl = document.createElement("ol");
    this.stepsEl.setAttribute("role", "list");
    this.stepsEl.setAttribute("aria-label", "Demo progress");
    for (const step of DEMO_STEPS) {
      const li = document.createElement("li");
      li.setAttribute("role", "listitem");
      li.dataset.step = step;
      li.dataset.status = "pending";
      li.textContent = `${STEP_LABELS[step]} — pending`;
      this.stepItems.set(step, li);
      this.stepsEl.appendChild(li);
    }
    this.container.appendChild(this.stepsEl);

    this.resultsEl = document.createElement("div");
    this.resultsEl.setAttribute("aria-label", "Demo results");
    this.container.appendChild(this.resultsEl);

    const liveMsg = createLiveRegion("");
    this.liveEl = document.createElement("div");
    this.liveEl.setAttribute("role", liveMsg.role);
    this.liveEl.setAttribute("aria-live", liveMsg.ariaLive);
    this.liveEl.style.position = "absolute";
    this.liveEl.style.left = "-9999px";
    this.container.appendChild(this.liveEl);

    parent.appendChild(this.container);
    return this.container;
  }

  unmount(): void {
    this.container?.remove();
    this.lastResult = null;
    this.running = false;
  }

  getElement(): HTMLElement {
    return this.container;
  }

  isRunning(): boolean {
    return this.running;
  }

  getExportJson(): string | null {
    return this.lastResult?.exportJson ?? null;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.runBtn.disabled = true;
    this.lastResult = null;
    this.resultsEl.replaceChildren();
    for (const step of DEMO_STEPS) this.setStep(step, "pending");

    try {
      const result = await runDemo({
        workflow: this.opts.workflow,
        device: this.opts.device,
        onProgress: (step, status, detail) => {
          this.setStep(step, status, detail);
          if (status === "running") this.announce(`${STEP_LABELS[step]} started`);
          if (status === "done")
            this.announce(`${STEP_LABELS[step]} done${detail ? `: ${detail}` : ""}`);
        },
      });
      this.lastResult = result;
      this.renderResults(result);
      this.statusEl.textContent = `Demo complete — ${result.citations.length} citations, confidence ${Math.round(result.confidence * 100)}%.`;
      this.announce("Demo complete");
      this.opts.announce?.("Demo complete");
      // Move focus to the results so keyboard users land on fresh content.
      const resultsHeading = this.resultsEl.querySelector<HTMLElement>(
        "[data-demo-results-heading]",
      );
      if (resultsHeading) resultsHeading.focus();
    } catch (err) {
      this.statusEl.textContent = `Demo failed: ${err instanceof Error ? err.message : String(err)}`;
      this.announce("Demo failed");
      this.opts.announce?.("Demo failed");
    } finally {
      this.running = false;
      this.runBtn.disabled = false;
    }
  }

  private setStep(step: DemoStepId, status: DemoStepStatus, detail?: string): void {
    const li = this.stepItems.get(step);
    if (!li) return;
    li.dataset.status = status;
    li.textContent = `${STEP_LABELS[step]} — ${status}${detail ? ` (${detail})` : ""}`;
  }

  private announce(message: string): void {
    const spec = createLiveRegion(message);
    this.liveEl.setAttribute("role", spec.role);
    this.liveEl.setAttribute("aria-live", spec.ariaLive);
    this.liveEl.textContent = spec.message;
  }

  private renderResults(result: DemoResult): void {
    this.resultsEl.replaceChildren();

    const heading = document.createElement("h3");
    heading.textContent = "Demo results";
    heading.dataset.demoResultsHeading = "true";
    heading.tabIndex = -1;
    this.resultsEl.appendChild(heading);

    const answerP = document.createElement("p");
    answerP.setAttribute("role", "status");
    answerP.textContent = result.answer;
    this.resultsEl.appendChild(answerP);

    // Grounded citations with built-in keyboard navigation.
    this.resultsEl.appendChild(
      createCitationList(demoResearchResult(result), () => {
        this.announce("Citation opened in demo inspector");
      }),
    );

    // Tactile output — one accessible frame block per rendered pattern.
    const tactileSec = document.createElement("section");
    tactileSec.setAttribute("aria-label", "Tactile output");
    tactileSec.setAttribute("role", "region");
    const tactileHeading = document.createElement("h4");
    tactileHeading.textContent = `Tactile output — ${result.frames.length} frames`;
    tactileSec.appendChild(tactileHeading);
    result.frames.forEach((frame, idx) => {
      const wrap = document.createElement("div");
      const active = frame.pattern.filter(v => v > 0).length;
      wrap.setAttribute("role", "img");
      wrap.setAttribute(
        "aria-label",
        `Frame ${idx + 1} from ${frame.label}: ${active} of ${frame.pattern.length} dots active`,
      );
      const label = document.createElement("strong");
      label.textContent = `${idx + 1}. ${frame.label}`;
      const glyphs = document.createElement("pre");
      glyphs.setAttribute("aria-hidden", "true");
      glyphs.textContent = frame.pattern.map(v => (v > 0 ? "●" : "·")).join("");
      const values = document.createElement("code");
      values.textContent = frame.pattern.join(",");
      wrap.append(label, document.createElement("br"), glyphs, values);
      tactileSec.appendChild(wrap);
    });
    this.resultsEl.appendChild(tactileSec);

    // Diagnostics summary + report.
    const diagSec = document.createElement("section");
    diagSec.setAttribute("aria-label", "Demo diagnostics");
    diagSec.setAttribute("role", "region");
    const diagHeading = document.createElement("h4");
    diagHeading.textContent = "Diagnostics";
    diagSec.appendChild(diagHeading);
    const dl = document.createElement("dl");
    const d = result.diagnostics;
    const rows: [string, string][] = [
      ["Version", d.version],
      ["Provider", `${d.provider.id} · ${d.provider.model} · ${d.provider.dimensions}d`],
      [
        "Device",
        d.device.active
          ? `${d.device.active.name} (${d.device.active.kind}) · ${d.device.active.status}`
          : "none",
      ],
      [
        "Corpus",
        `${d.corpus.documentCount} documents · ${d.corpus.chunkCount} chunks · index ${d.corpus.version}`,
      ],
    ];
    for (const [term, desc] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = desc;
      dl.append(dt, dd);
    }
    diagSec.appendChild(dl);
    const reportPre = document.createElement("pre");
    reportPre.setAttribute("aria-label", "Demo report text");
    reportPre.textContent = formatDemoReport(result);
    diagSec.appendChild(reportPre);
    this.resultsEl.appendChild(diagSec);

    // Export actions — copy and download the deterministic session JSON.
    const actions = document.createElement("div");
    actions.setAttribute("role", "group");
    actions.setAttribute("aria-label", "Demo export actions");
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "Copy demo JSON";
    copyBtn.style.minHeight = "32px";
    copyBtn.addEventListener("click", () => {
      void copyText(result.exportJson).then(ok => {
        this.announce(
          ok ? "Demo JSON copied to clipboard" : "Copy failed — select the report manually",
        );
      });
    });
    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.textContent = "Download demo JSON";
    downloadBtn.style.minHeight = "32px";
    downloadBtn.addEventListener("click", () => {
      const ok = this.downloadJson(result.exportJson);
      this.announce(ok ? "Demo JSON download started" : "Download unavailable in this environment");
    });
    actions.append(copyBtn, downloadBtn);
    this.resultsEl.appendChild(actions);
  }

  private downloadJson(json: string): boolean {
    try {
      const blobApi = globalThis as unknown as {
        Blob?: new (parts: BlobPart[], opts?: { type?: string }) => Blob;
        URL?: { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };
      };
      if (!blobApi.Blob || !blobApi.URL?.createObjectURL) return false;
      const blob = new blobApi.Blob([json], { type: "application/json" });
      const url = blobApi.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "autosd-demo.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      blobApi.URL.revokeObjectURL?.(url);
      return true;
    } catch {
      return false;
    }
  }
}

// Re-exported for convenience so integrations can show the fixed query.
export { DEMO_QUERY };
