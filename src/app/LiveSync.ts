import { CorpusWatcher, type WatcherEvent } from "../retrieval/CorpusWatcher.js";
import type { ResearchWorkflow } from "../workflows/research.js";
import { createLiveRegion } from "../accessibility/a11y.js";

export type SyncStatus = "Idle" | "Indexing" | "Updated" | "Error";

/**
 * v0.9 additive: structured error event from the ingest/save cycle.
 * `error` is raw — UI layers must sanitize (sanitizeError()) before display.
 */
export type SyncErrorEvent = {
  scope: "live-sync";
  operation: "ingest" | "save";
  error: unknown;
};

export class LiveSync {
  private watcher: CorpusWatcher;
  private status: SyncStatus = "Idle";
  private statusEl?: HTMLElement;
  private liveEl?: HTMLElement;
  private queueTail: Promise<void> = Promise.resolve();
  private inFlight = 0;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private statusListeners = new Set<(s: SyncStatus) => void>();
  private errorListeners = new Set<(e: SyncErrorEvent) => void>();
  private lastErrorEvent: SyncErrorEvent | null = null;

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
    this.clearIdleTimer();
    this.setStatus("Idle");
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  isRunning(): boolean {
    return this.watcher.isRunning();
  }

  /** True while any queued sync task is in flight (additive, v0.9 diagnostics). */
  isPending(): boolean {
    return this.inFlight > 0;
  }

  onStatusChange(fn: (s: SyncStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /** Subscribe to ingest/save failures; returns an unsubscribe function. */
  onError(fn: (e: SyncErrorEvent) => void): () => void {
    this.errorListeners.add(fn);
    return () => {
      this.errorListeners.delete(fn);
    };
  }

  getLastError(): SyncErrorEvent | null {
    return this.lastErrorEvent;
  }

  /** Recovery path after an Error status: full rescan + re-ingest cycle. */
  async rescan(): Promise<void> {
    const ev = await this.watcher.trigger();
    await this.handleChange(ev);
  }

  /**
   * Run a browser-driven corpus/persistence update through the live status pill.
   * Queued behind any in-flight sync so writes land in call order (an older
   * snapshot can never overwrite a newer one).
   */
  runManualSync(action: () => Promise<void> | void): Promise<void> {
    return this.enqueue(async () => {
      try {
        await action();
        this.finishTask("Updated");
      } catch (err) {
        this.reportError({ scope: "live-sync", operation: "save", error: err });
      }
    });
  }

  mountStatusIndicator(parent: HTMLElement): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "autosd-sync-indicator";
    wrapper.setAttribute("role", "status");
    wrapper.setAttribute("aria-live", "polite");
    wrapper.setAttribute("aria-label", "Corpus sync status");
    wrapper.tabIndex = 0;

    const badge = document.createElement("span");
    badge.className = "autosd-sync-badge";
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
    for (const fn of this.statusListeners) {
      try {
        fn(next);
      } catch (listenerError) {
        console.error("LiveSync: status listener threw", listenerError);
      }
    }
  }

  private async handleChange(ev: WatcherEvent): Promise<void> {
    const hasWork = ev.added.length > 0 || ev.modified.length > 0 || ev.deleted.length > 0;
    if (!hasWork) return;
    // Never drop an event: CorpusWatcher has already advanced its hash map, so
    // a skipped event would never be re-emitted. Queue it behind in-flight work.
    return this.enqueue(async () => {
      let phase: SyncErrorEvent["operation"] = "ingest";
      try {
        const docs = [...ev.added, ...ev.modified];
        if (docs.length > 0) {
          await this.workflow.ingest(docs);
        }
        for (const id of ev.deleted) {
          await this.workflow.removeDocument(id);
        }
        phase = "save";
        await this.workflow.saveToDisk(
          this.dir.replace(/\/docs$/, "").replace(/\/$/, "") || "corpus",
        );
        this.finishTask("Updated");
      } catch (err) {
        this.reportError({ scope: "live-sync", operation: phase, error: err });
      }
    });
  }

  /** Serialize sync tasks in arrival order; status shows Indexing while any run. */
  private enqueue(task: () => Promise<void>): Promise<void> {
    this.inFlight++;
    this.clearIdleTimer();
    this.setStatus("Indexing");
    const run = this.queueTail.then(task).finally(() => {
      this.inFlight--;
    });
    // task() handles its own errors; the tail only preserves ordering.
    this.queueTail = run;
    return run;
  }

  private finishTask(next: "Updated" | "Error"): void {
    // Only the last queued task settles the pill, so it never flickers to
    // Idle while another sync is still waiting to run.
    if (this.inFlight > 1) return;
    this.setStatus(next);
    this.clearIdleTimer();
    this.idleTimer = setTimeout(
      () => {
        this.idleTimer = undefined;
        if (this.inFlight === 0 && this.status === next) this.setStatus("Idle");
      },
      next === "Updated" ? 1200 : 2000,
    );
  }

  private reportError(event: SyncErrorEvent): void {
    this.lastErrorEvent = event;
    for (const fn of this.errorListeners) {
      try {
        fn(event);
      } catch (listenerError) {
        console.error("LiveSync: error listener threw", listenerError);
      }
    }
    if (this.inFlight > 1) {
      // A later task is queued; keep the failure visible until it completes.
      this.setStatus("Error");
      return;
    }
    this.finishTask("Error");
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }
}
