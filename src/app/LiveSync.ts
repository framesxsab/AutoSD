import { CorpusWatcher, type WatcherEvent } from "../retrieval/CorpusWatcher.js";
import type { ResearchWorkflow } from "../workflows/research.js";
import { createLiveRegion } from "../accessibility/a11y.js";

export type SyncStatus = "Idle" | "Indexing" | "Updated" | "Error";

export class LiveSync {
  private watcher: CorpusWatcher;
  private status: SyncStatus = "Idle";
  private statusEl?: HTMLElement;
  private liveEl?: HTMLElement;
  private pending = false;
  private statusListeners = new Set<(s: SyncStatus) => void>();

  constructor(
    private workflow: ResearchWorkflow,
    private dir: string,
    private opts: { debounceMs?: number } = {},
  ) {
    this.watcher = new CorpusWatcher(dir, ev => this.handleChange(ev), {
      debounceMs: opts.debounceMs ?? 150,
    });
  }

  async start(): Promise<void> {
    await this.watcher.start();
    this.setStatus("Idle");
  }

  stop(): void {
    this.watcher.stop();
    this.setStatus("Idle");
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  isRunning(): boolean {
    return this.watcher.isRunning();
  }

  onStatusChange(fn: (s: SyncStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  mountStatusIndicator(parent: HTMLElement): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("role", "status");
    wrapper.setAttribute("aria-live", "polite");
    wrapper.setAttribute("aria-label", "Corpus sync status");
    wrapper.tabIndex = 0;

    const badge = document.createElement("span");
    badge.dataset.status = this.status;
    badge.textContent = this.status;
    wrapper.appendChild(badge);
    this.statusEl = badge;

    const live = document.createElement("div");
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    live.style.position = "absolute";
    live.style.left = "-9999px";
    wrapper.appendChild(live);
    this.liveEl = live;

    parent.appendChild(wrapper);
    return wrapper;
  }

  private setStatus(next: SyncStatus): void {
    this.status = next;
    if (this.statusEl) {
      this.statusEl.textContent = next;
      this.statusEl.dataset.status = next;
    }
    if (this.liveEl) {
      const msg = createLiveRegion(`Corpus ${next.toLowerCase()}`);
      this.liveEl.textContent = msg.message;
    }
  }

  private async handleChange(ev: WatcherEvent): Promise<void> {
    if (this.pending) return;
    const hasWork = ev.added.length > 0 || ev.modified.length > 0 || ev.deleted.length > 0;
    if (!hasWork) return;
    this.pending = true;
    this.setStatus("Indexing");
    try {
      const docs = [...ev.added, ...ev.modified];
      if (docs.length > 0) {
        await this.workflow.ingest(docs);
      }
      if (ev.deleted.length > 0) {
        const remaining = this.workflow.listDocuments().filter(d => !ev.deleted.includes(d.id));
        this.workflow.clear();
        if (remaining.length > 0) await this.workflow.ingest(remaining);
      }
      await this.workflow.saveToDisk(
        this.dir.replace(/\/docs$/, "").replace(/\/$/, "") || "corpus",
      );
      this.setStatus("Updated");
      setTimeout(() => this.setStatus("Idle"), 1200);
    } catch {
      this.setStatus("Error");
      setTimeout(() => this.setStatus("Idle"), 2000);
    } finally {
      this.pending = false;
    }
  }
}
