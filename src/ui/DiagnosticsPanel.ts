/**
 * DiagnosticsPanel — accessible observability panel (v0.9).
 * Renders the safe diagnostics report with a copy-to-clipboard button.
 *
 * A11y guarantees:
 * - Landmark region (role="region") labelled by its heading.
 * - Copy button is a native <button> (keyboard operable by default).
 * - Live region announces copy success/failure via createLiveRegion().
 */
import { createLiveRegion } from "../accessibility/a11y.js";
import {
  collectDiagnostics,
  formatDiagnosticsReport,
  type DiagnosticsInput,
  type DiagnosticsReport,
} from "../app/diagnostics.js";

export type DiagnosticsPanelOptions = {
  /** Collector override (tests / custom wiring). Defaults to collectDiagnostics(input). */
  collect?: () => DiagnosticsReport;
  input?: DiagnosticsInput;
};

export async function copyText(text: string): Promise<boolean> {
  try {
    const clip = (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
    if (clip && typeof clip.writeText === "function") {
      await clip.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export class DiagnosticsPanel {
  private container!: HTMLElement;
  private liveEl!: HTMLElement;
  private rowsEl!: HTMLElement;
  private reportPre!: HTMLElement;
  private headingId = `diagnostics-heading-${Math.random().toString(36).slice(2, 8)}`;
  private latest: DiagnosticsReport | null = null;

  constructor(private opts: DiagnosticsPanelOptions = {}) {}

  mount(parent: HTMLElement): HTMLElement {
    this.container = document.createElement("section");
    this.container.setAttribute("role", "region");
    this.container.setAttribute("aria-labelledby", this.headingId);
    this.container.setAttribute("aria-label", "Diagnostics");

    const heading = document.createElement("h3");
    heading.id = this.headingId;
    heading.textContent = "Diagnostics";
    this.container.appendChild(heading);

    this.rowsEl = document.createElement("dl");
    this.rowsEl.setAttribute("role", "list");
    this.container.appendChild(this.rowsEl);

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "Copy diagnostics report";
    copyBtn.setAttribute("aria-label", "Copy diagnostics report to clipboard");
    copyBtn.addEventListener("click", () => {
      void this.copyToClipboard();
    });
    this.container.appendChild(copyBtn);

    this.reportPre = document.createElement("pre");
    this.reportPre.setAttribute("aria-label", "Diagnostics report JSON");
    this.container.appendChild(this.reportPre);

    const liveMsg = createLiveRegion("");
    this.liveEl = document.createElement("div");
    this.liveEl.setAttribute("role", liveMsg.role);
    this.liveEl.setAttribute("aria-live", liveMsg.ariaLive);
    this.liveEl.style.position = "absolute";
    this.liveEl.style.left = "-9999px";
    this.container.appendChild(this.liveEl);

    parent.appendChild(this.container);
    this.refresh();
    return this.container;
  }

  refresh(): DiagnosticsReport {
    this.latest = this.opts.collect ? this.opts.collect() : collectDiagnostics(this.opts.input);
    this.renderRows(this.latest);
    this.reportPre.textContent = formatDiagnosticsReport(this.latest);
    return this.latest;
  }

  getReport(): string {
    if (!this.latest) this.refresh();
    return formatDiagnosticsReport(this.latest!);
  }

  async copyToClipboard(): Promise<boolean> {
    const ok = await copyText(this.getReport());
    this.liveEl.textContent = ok
      ? "Diagnostics report copied to clipboard"
      : "Copy failed — select the report text manually";
    return ok;
  }

  unmount(): void {
    this.container?.remove();
    this.latest = null;
  }

  getElement(): HTMLElement {
    return this.container;
  }

  private renderRows(r: DiagnosticsReport): void {
    this.rowsEl.innerHTML = "";
    const rows: [string, string][] = [
      ["Version", r.version],
      ["Build", r.build],
      [
        "Retrieval provider",
        r.provider ? `${r.provider.id} · ${r.provider.model} · ${r.provider.dimensions}d` : "none",
      ],
      [
        "Active device",
        r.device.active
          ? `${r.device.active.name} (${r.device.active.kind}) · ${r.device.active.status} · ${r.device.active.id}`
          : "none",
      ],
      [
        "Corpus",
        `${r.corpus.documentCount} documents · ${r.corpus.chunkCount} chunks · index ${r.corpus.version}`,
      ],
      ["Watcher", `${r.watcher.isRunning ? "running" : "stopped"} · status ${r.watcher.status}`],
      ["Indexing", r.indexing.pending ? "pending" : "idle"],
      [
        "Services",
        `HID ${r.services.hidAvailable ? "available" : "unavailable"} · OpenAI ${
          r.services.openAIConfigured ? "configured" : "not configured"
        }`,
      ],
    ];
    for (const [term, desc] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = desc;
      this.rowsEl.appendChild(dt);
      this.rowsEl.appendChild(dd);
    }
  }
}
