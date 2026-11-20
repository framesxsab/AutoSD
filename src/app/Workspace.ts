import { ResearchWorkflow, type ResearchResult } from "../workflows/research.js";
import { SessionBrowser } from "../ui/SessionBrowser.js";
import { VirtualList } from "../ui/VirtualList.js";
import type { RetrievalResult } from "../retrieval/types.js";
import { createLiveRegion } from "../accessibility/a11y.js";
import type { LiveSync, SyncStatus } from "./LiveSync.js";
import { DiagnosticsPanel } from "../ui/DiagnosticsPanel.js";
import type { DiagnosticsInput } from "./diagnostics.js";
import { LoadingIndicator } from "../ui/LoadingStates.js";
import { classifyError, createEmptyState, ErrorStateView } from "../ui/ErrorStates.js";
import { STARTER_CORPUS } from "./starterCorpus.js";
import type { ReaderSelection } from "./router.js";

export type WorkspaceOptions = {
  corpusDir?: string;
  onOpenInReader?: (selection: ReaderSelection) => void;
  onMutate?: () => void;
};

export const ALLOWED_UPLOAD_EXT = /\.(md|txt|json)$/i;
export const MAX_UPLOAD_FILES = 25;
export const MAX_UPLOAD_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB per file
export const MAX_PASTED_DOC_CHARS = 500_000;
export const MAX_SEARCH_QUERY_CHARS = 500;
export const MAX_SEARCHES_PER_MINUTE = 20;

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
  private searchInFlight = false;
  private searchTimestamps: number[] = [];
  private lastSearchResult?: ResearchResult;

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
      onDelete: () => this.opts.onMutate?.(),
      onOpenCitation: (sessionId, chunkId) => {
        const sess = this.workflow.getSession(sessionId);
        const docId = chunkId.split("#")[0];
        if (docId && this.opts.onOpenInReader) {
          this.opts.onOpenInReader({ documentId: docId, chunkId, result: sess?.results });
        }
        this.announce(`Opened citation ${chunkId}`);
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
        this.refreshCorpusSection();
        this.sessionBrowser.render();
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
    heading.dataset.autosdViewHeading = "true";
    this.container.appendChild(heading);

    const corpusMgr = this.renderCorpusManager();
    this.container.appendChild(corpusMgr);

    const searchPanel = this.renderSearchPanel();
    this.container.appendChild(searchPanel);

    const chunksPanel = document.createElement("section");
    chunksPanel.setAttribute("aria-label", "Retrieved chunks");
    const chunksHeading = document.createElement("h2");
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
        el.className = "autosd-chunk-item";
        el.setAttribute("role", "listitem");
        el.tabIndex = 0;
        el.dataset.chunk = r.chunk.id;
        const strong = document.createElement("strong");
        strong.textContent = r.chunk.documentId;
        const code = document.createElement("code");
        code.textContent = r.chunk.id;
        const score = document.createElement("span");
        score.className = "autosd-score-badge";
        score.textContent = String(Math.round(r.score * 100) / 100);
        const preview = document.createElement("p");
        preview.style.margin = "4px 0 0";
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
    const inspectorHeading = document.createElement("h2");
    inspectorHeading.textContent = "Citation inspector";
    const inspectorHint = document.createElement("p");
    inspectorHint.textContent = "Select a chunk to inspect.";
    this.inspector.append(inspectorHeading, inspectorHint);
    this.container.appendChild(this.inspector);

    const browserWrap = document.createElement("section");
    browserWrap.setAttribute("aria-label", "Session history");
    this.sessionBrowser.mount(browserWrap);
    this.container.appendChild(browserWrap);
  }

  private refreshCorpusSection(): void {
    const corpusSec = this.container.querySelector('section[aria-label="Corpus manager"]');
    if (corpusSec) {
      const newMgr = this.renderCorpusManager();
      corpusSec.replaceWith(newMgr);
    }
  }

  private renderCorpusManager(): HTMLElement {
    const sec = document.createElement("section");
    sec.setAttribute("aria-label", "Corpus manager");
    const h = document.createElement("h2");
    h.textContent = "Corpus";
    sec.appendChild(h);
    const docs = this.workflow.listDocuments();
    const p = document.createElement("p");
    p.setAttribute("role", "status");
    p.textContent = `${docs.length} documents · ${this.workflow.getManifest()?.chunkCount ?? 0} chunks · ${this.workflow.getManifest()?.version ?? "0.0.0"}`;
    sec.appendChild(p);

    const toolbar = document.createElement("div");
    toolbar.className = "autosd-toolbar";
    toolbar.setAttribute("role", "group");
    toolbar.setAttribute("aria-label", "Corpus management actions");

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".md,.txt,.json";
    fileInput.multiple = true;
    fileInput.setAttribute("aria-label", "Upload corpus files");
    fileInput.addEventListener("change", () => {
      const rawFiles = Array.from(fileInput.files ?? []);
      if (rawFiles.length === 0) return;
      const validFiles = rawFiles
        .slice(0, MAX_UPLOAD_FILES)
        .filter(
          f =>
            ALLOWED_UPLOAD_EXT.test(f.name) &&
            (typeof f.size !== "number" || (f.size >= 0 && f.size <= MAX_UPLOAD_FILE_BYTES)),
        );
      if (validFiles.length === 0) {
        this.announce("Upload rejected: only .md, .txt, or .json files up to 2 MB are allowed");
        fileInput.value = "";
        return;
      }
      const existingIds = new Set(this.workflow.listDocuments().map(d => d.id));
      void Promise.all(
        validFiles.map(async file => {
          const content = (await file.text()).slice(0, MAX_UPLOAD_FILE_BYTES);
          const rawBase = file.name.replace(/\.[^.]+$/, "") || file.name;
          const base =
            rawBase
              .toLowerCase()
              .replace(/[^a-z0-9_-]+/g, "-")
              .replace(/^-+|-+$/g, "") || rawBase;
          let uniqueId = base;
          let suffix = 2;
          while (existingIds.has(uniqueId)) {
            uniqueId = `${base}-${suffix++}`;
          }
          existingIds.add(uniqueId);
          return { id: uniqueId, path: file.name, content };
        }),
      ).then(async uploaded => {
        await this.workflow.ingest(uploaded);
        fileInput.value = "";
        this.refreshCorpusSection();
        this.opts.onMutate?.();
        this.announce(`Ingested ${uploaded.length} uploaded file(s)`);
      });
    });

    const sampleBtn = document.createElement("button");
    sampleBtn.type = "button";
    sampleBtn.textContent = "Load sample corpus";
    sampleBtn.addEventListener("click", () => {
      void this.workflow.ingest([...STARTER_CORPUS]).then(() => {
        this.refreshCorpusSection();
        this.opts.onMutate?.();
        this.announce(`Loaded ${STARTER_CORPUS.length} sample documents`);
      });
    });

    toolbar.append(fileInput, sampleBtn);
    sec.appendChild(toolbar);

    const addDetails = document.createElement("details");
    const addSummary = document.createElement("summary");
    addSummary.textContent = "Add or paste document";
    addDetails.appendChild(addSummary);

    const addForm = document.createElement("form");
    addForm.className = "autosd-add-doc-form";
    const idInput = document.createElement("input");
    idInput.type = "text";
    idInput.placeholder = "Document title or id";
    idInput.setAttribute("aria-label", "Document title");
    const contentInput = document.createElement("textarea");
    contentInput.rows = 3;
    contentInput.placeholder = "Paste document text…";
    contentInput.setAttribute("aria-label", "Document content");
    const saveDocBtn = document.createElement("button");
    saveDocBtn.type = "submit";
    saveDocBtn.textContent = "Add document";
    addForm.append(idInput, contentInput, saveDocBtn);
    addForm.addEventListener("submit", e => {
      e.preventDefault();
      const rawTitle = idInput.value.trim().slice(0, 120);
      const content = contentInput.value.trim().slice(0, MAX_PASTED_DOC_CHARS);
      if (!rawTitle || !content) return;
      const slug = rawTitle
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const docId = slug || `doc-${Date.now()}`;
      void this.workflow.ingest([{ id: docId, path: rawTitle, content }]).then(() => {
        idInput.value = "";
        contentInput.value = "";
        addDetails.open = false;
        this.refreshCorpusSection();
        this.opts.onMutate?.();
        this.announce(`Added document ${rawTitle}`);
      });
    });
    addDetails.appendChild(addForm);
    sec.appendChild(addDetails);

    const list = document.createElement("ul");
    list.setAttribute("role", "list");
    for (const d of docs) {
      const li = document.createElement("li");
      li.setAttribute("role", "listitem");
      const label = document.createElement("span");
      label.textContent = `${d.id} ${d.path ?? ""}`.trim();
      li.appendChild(label);

      const docActions = document.createElement("div");
      docActions.setAttribute("role", "group");
      docActions.setAttribute("aria-label", `Actions for ${d.id}`);

      if (this.opts.onOpenInReader) {
        const readBtn = document.createElement("button");
        readBtn.type = "button";
        readBtn.textContent = "Open in Reader";
        readBtn.setAttribute("aria-label", `Open ${d.id} in Reader`);
        readBtn.addEventListener("click", () => {
          this.opts.onOpenInReader?.({ documentId: d.id });
        });
        docActions.appendChild(readBtn);
      }

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "Remove";
      removeBtn.setAttribute("aria-label", `Remove document ${d.id}`);
      removeBtn.addEventListener("click", () => {
        void this.workflow.removeDocument(d.id).then(removed => {
          if (!removed) return;
          this.refreshCorpusSection();
          this.opts.onMutate?.();
          this.announce(`Removed document ${d.id}`);
        });
      });
      docActions.appendChild(removeBtn);
      li.appendChild(docActions);
      list.appendChild(li);
    }
    sec.appendChild(list);
    return sec;
  }

  private renderSearchPanel(): HTMLElement {
    const sec = document.createElement("section");
    sec.setAttribute("aria-label", "Search panel");
    const h = document.createElement("h2");
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

  private async doSearch(rawQuery: string): Promise<void> {
    const query = rawQuery.trim().slice(0, MAX_SEARCH_QUERY_CHARS);
    if (!query || this.searchInFlight) return;
    const now = Date.now();
    this.searchTimestamps = this.searchTimestamps.filter(t => now - t < 60_000);
    if (this.searchTimestamps.length >= MAX_SEARCHES_PER_MINUTE) {
      this.announce("Search rate limit reached. Please wait before running more queries.");
      return;
    }
    this.searchTimestamps.push(now);
    this.searchInFlight = true;

    try {
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
        this.lastSearchResult = undefined;
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

      this.lastSearchResult = result;
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
      this.opts.onMutate?.();
    } finally {
      this.searchInFlight = false;
    }
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
    const sectionHeading = document.createElement("h2");
    sectionHeading.textContent = "Citation inspector";
    const heading = document.createElement("h3");
    heading.textContent = `${r.chunk.documentId} — ${r.chunk.id}`;
    const meta = document.createElement("p");
    meta.textContent = `Score ${Math.round(r.score * 100) / 100} · Source ${r.source}`;
    const pre = document.createElement("pre");
    pre.textContent = r.chunk.content;
    this.inspector.append(sectionHeading, heading, meta, pre);

    if (this.opts.onOpenInReader) {
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.textContent = "Open chunk in Reader";
      openBtn.setAttribute("aria-label", `Open cited chunk ${r.chunk.id} in Reader`);
      openBtn.addEventListener("click", () => {
        this.opts.onOpenInReader?.({
          documentId: r.chunk.documentId,
          chunkId: r.chunk.id,
          result: this.lastSearchResult,
        });
        this.announce(`Opened citation ${r.chunk.id} in Reader`);
      });
      this.inspector.appendChild(openBtn);
    }

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
