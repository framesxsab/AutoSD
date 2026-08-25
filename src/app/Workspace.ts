import { ResearchWorkflow } from "../workflows/research.js";
import { SessionBrowser } from "../ui/SessionBrowser.js";
import { VirtualList } from "../ui/VirtualList.js";
import type { RetrievalResult } from "../retrieval/types.js";
import { createLiveRegion } from "../accessibility/a11y.js";
import type { LiveSync, SyncStatus } from "./LiveSync.js";
import { DiagnosticsPanel } from "../ui/DiagnosticsPanel.js";
import type { DiagnosticsInput } from "./diagnostics.js";
import { LoadingIndicator } from "../ui/LoadingStates.js";
import { classifyError, createEmptyState, ErrorStateView } from "../ui/ErrorStates.js";

export type WorkspaceOptions = {
  corpusDir?: string;
};

export class Workspace {
  private container: HTMLElement;
  private sessionBrowser: SessionBrowser;
  private searchInput?: HTMLInputElement;
  private chunksList?: VirtualList<RetrievalResult>;
  private inspector?: HTMLElement;
  private exportHistory: string[] = [];
  private liveSync?: LiveSync;
  private unsubscribeLiveSync?: () => void;
  private corpusStatus?: HTMLElement;
  private diagnosticsPanel?: DiagnosticsPanel;
  private searchLoading?: LoadingIndicator;
  private searchErrorView?: ErrorStateView;

  constructor(
    private workflow: ResearchWorkflow,
    private opts: WorkspaceOptions = {},
  ) {
    this.container = document.createElement("div");
    this.container.setAttribute("role", "region");
    this.container.setAttribute("aria-label", "Research workspace");
    this.sessionBrowser = new SessionBrowser(workflow, {
      onExport: json => {
        this.exportHistory.push(json);
        this.announce("Exported session");
      },
    });
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.container);
    this.render();
    this.lazyLoad();
  }

  attachLiveSync(sync: LiveSync): void {
    if (this.unsubscribeLiveSync) this.unsubscribeLiveSync();
    this.liveSync = sync;
    this.unsubscribeLiveSync = sync.onStatusChange(status => this.handleSyncStatus(status));
  }

  attachDiagnostics(input: DiagnosticsInput = {}): HTMLElement {
    if (this.diagnosticsPanel) this.diagnosticsPanel.unmount();
    const sec = document.createElement("section");
    sec.setAttribute("aria-label", "Diagnostics");
    this.diagnosticsPanel = new DiagnosticsPanel({ input });
    this.diagnosticsPanel.mount(sec);
    this.container.appendChild(sec);
    return sec;
  }

  detachLiveSync(): void {
    if (this.unsubscribeLiveSync) {
      this.unsubscribeLiveSync();
      this.unsubscribeLiveSync = undefined;
      this.liveSync = undefined;
    }
  }

  unmount(): void {
    this.detachLiveSync();
    this.diagnosticsPanel?.unmount();
    this.diagnosticsPanel = undefined;
    this.container.remove();
  }

  getElement(): HTMLElement {
    return this.container;
  }

  private handleSyncStatus(status: SyncStatus): void {
    if (status === "Updated") {
      queueMicrotask(() => {
        const corpusSec = this.container.querySelector('section[aria-label="Corpus manager"]');
        if (corpusSec) {
          const newMgr = this.renderCorpusManager();
          corpusSec.replaceWith(newMgr);
        }
        this.announce("Corpus updated — retrieval index refreshed");
      });
    } else if (status === "Indexing") {
      this.announce("Indexing corpus changes");
    } else if (status === "Error") {
      this.announce("Corpus indexing failed");
    }
  }

  private render(): void {
    this.container.innerHTML = "";

    const heading = document.createElement("h1");
    heading.textContent = "Autonomous Knowledge Workspace";
    heading.id = "workspace-heading";
    this.container.appendChild(heading);

    const corpusMgr = this.renderCorpusManager();
    this.container.appendChild(corpusMgr);

    const searchPanel = this.renderSearchPanel();
    this.container.appendChild(searchPanel);

    const chunksPanel = document.createElement("section");
    chunksPanel.setAttribute("aria-label", "Retrieved chunks");
    const chunksHeading = document.createElement("h3");
    chunksHeading.textContent = "Retrieved chunks";
    chunksPanel.appendChild(chunksHeading);
    const chunksContainer = document.createElement("div");
    chunksPanel.appendChild(chunksContainer);
    this.chunksList = new VirtualList<RetrievalResult>({
      itemHeight: 72,
      containerHeight: 240,
      renderItem: r => {
        // Security: corpus content/ids are untrusted — build with DOM APIs
        // (textContent), never innerHTML string interpolation.
        const el = document.createElement("div");
        el.setAttribute("role", "listitem");
        el.tabIndex = 0;
        el.dataset.chunk = r.chunk.id;
        const strong = document.createElement("strong");
        strong.textContent = r.chunk.documentId;
        const code = document.createElement("code");
        code.textContent = r.chunk.id;
        const score = document.createElement("span");
        score.textContent = String(Math.round(r.score * 100) / 100);
        const preview = document.createElement("p");
        preview.textContent = r.chunk.content.slice(0, 120);
        el.append(strong, " ", code, " ", score, preview);
        el.addEventListener("click", () => this.inspect(r));
        el.addEventListener("keydown", e => {
          if (e.key === "Enter") this.inspect(r);
        });
        return el;
      },
    });
    // Lazy mount virtual list only when first search happens
    (chunksPanel as unknown as { _chunksContainer: HTMLElement })._chunksContainer =
      chunksContainer;
    this.container.appendChild(chunksPanel);

    this.inspector = document.createElement("section");
    this.inspector.setAttribute("aria-label", "Citation inspector");
    this.inspector.setAttribute("role", "region");
    this.inspector.tabIndex = 0;
    this.inspector.textContent = "Select a chunk to inspect.";
    this.container.appendChild(this.inspector);

    const browserWrap = document.createElement("section");
    browserWrap.setAttribute("aria-label", "Session history");
    this.sessionBrowser.mount(browserWrap);
    this.container.appendChild(browserWrap);
  }

  private renderCorpusManager(): HTMLElement {
    const sec = document.createElement("section");
    sec.setAttribute("aria-label", "Corpus manager");
    const h = document.createElement("h3");
    h.textContent = "Corpus";
    sec.appendChild(h);
    const docs = this.workflow.listDocuments();
    const p = document.createElement("p");
    p.setAttribute("role", "status");
    p.textContent = `${docs.length} documents · ${this.workflow.getManifest()?.chunkCount ?? 0} chunks · ${this.workflow.getManifest()?.version ?? "0.0.0"}`;
    sec.appendChild(p);
    const list = document.createElement("ul");
    list.setAttribute("role", "list");
    for (const d of docs) {
      const li = document.createElement("li");
      li.textContent = `${d.id} ${d.path ?? ""}`;
      list.appendChild(li);
    }
    sec.appendChild(list);
    return sec;
  }

  private renderSearchPanel(): HTMLElement {
    const sec = document.createElement("section");
    sec.setAttribute("aria-label", "Search panel");
    const h = document.createElement("h3");
    h.textContent = "Search";
    sec.appendChild(h);

    const input = document.createElement("input");
    input.type = "search";
    input.setAttribute("aria-label", "Search corpus");
    input.placeholder = "Search knowledge…";
    this.searchInput = input;

    const btn = document.createElement("button");
    btn.textContent = "Search";
    btn.addEventListener("click", () => this.doSearch(input.value));

    input.addEventListener("keydown", e => {
      if (e.key === "Enter") this.doSearch(input.value);
    });

    sec.appendChild(input);
    sec.appendChild(btn);
    return sec;
  }

  private async doSearch(query: string): Promise<void> {
    if (!query.trim()) return;
    this.clearSearchFeedback();
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const chunksSection = this.container.querySelector<HTMLElement>(
      'section[aria-label="Retrieved chunks"]',
    );
    this.searchLoading = new LoadingIndicator({
      label: "Searching corpus",
      message: `Searching for ${query}…`,
    });
    this.searchLoading.mount(chunksSection ?? this.container);

    const result = await this.workflow.runSafe({ id: `search-${Date.now()}`, question: query });

    this.searchLoading.unmount();
    this.searchLoading = undefined;

    if (!result) {
      const lastErr = this.workflow.getLastError();
      const classified = classifyError(lastErr?.error ?? new Error("Search failed"));
      const view = new ErrorStateView({
        kind: classified.kind,
        title: classified.title,
        detail: classified.detail || classified.title,
        returnFocusTo: trigger,
        onRetry: () => this.doSearch(query),
      });
      view.mount(chunksSection ?? this.container);
      this.searchErrorView = view;
      return;
    }

    // Feed retrieved chunks into virtual list lazily
    const results: RetrievalResult[] = result.citations.map(c => ({
      chunk: {
        id: c.chunkId,
        documentId: c.documentId,
        content: c.content,
        start: 0,
        end: c.content.length,
        hash: c.chunkId,
      },
      score: c.score,
      source: "hybrid" as const,
    }));
    if (this.chunksList) {
      if (!this.chunksList.getElement().parentElement) {
        const wrap = this.container.querySelector(
          "section[aria-label='Retrieved chunks']",
        ) as HTMLElement;
        const cont = wrap?.querySelector("div");
        if (cont) this.chunksList.mount(cont);
      }
      this.chunksList.setItems(results);
    }

    if (this.workflow.listDocuments().length === 0 && chunksSection) {
      const empty = createEmptyState({
        message: "No documents indexed yet.",
        hint: "Add .md or .txt files to your corpus folder — AutoSD watches it and indexes automatically.",
        ctaLabel: "Open corpus folder help",
        onCta: () => {
          const corpusSec = this.container.querySelector<HTMLElement>(
            'section[aria-label="Corpus manager"]',
          );
          corpusSec?.focus();
          this.announce("Corpus section focused");
        },
      });
      empty.dataset.autosdFeedback = "true";
      chunksSection.appendChild(empty);
    }

    this.announce(`Found ${results.length} results for ${query}`);
    // Refresh session browser to show new session
    this.sessionBrowser.render();
  }

  private clearSearchFeedback(): void {
    this.searchLoading?.unmount();
    this.searchLoading = undefined;
    this.searchErrorView?.clear(false);
    this.searchErrorView = undefined;
    for (const el of Array.from(this.container.querySelectorAll('[data-autosd-feedback="true"]'))) {
      el.remove();
    }
  }

  private inspect(r: RetrievalResult): void {
    if (!this.inspector) return;
    // Security: untrusted corpus data — DOM APIs only, no innerHTML.
    this.inspector.textContent = "";
    const heading = document.createElement("h4");
    heading.textContent = `${r.chunk.documentId} — ${r.chunk.id}`;
    const meta = document.createElement("p");
    meta.textContent = `Score ${Math.round(r.score * 100) / 100} · Source ${r.source}`;
    const pre = document.createElement("pre");
    pre.textContent = r.chunk.content;
    this.inspector.append(heading, meta, pre);
    this.inspector.focus();
  }

  private lazyLoad(): void {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.setAttribute("data-lazy", "loaded");
          }
        }
      },
      { rootMargin: "100px" },
    );
    observer.observe(this.container);
  }

  private announce(message: string): void {
    const msg = createLiveRegion(message);
    const el = document.createElement("div");
    el.setAttribute("role", msg.role);
    el.setAttribute("aria-live", msg.ariaLive);
    el.textContent = msg.message;
    el.style.position = "absolute";
    el.style.left = "-9999px";
    this.container.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }
}
