import { ResearchWorkflow } from "../workflows/research.js";
import { SessionBrowser } from "../ui/SessionBrowser.js";
import { VirtualList } from "../ui/VirtualList.js";
import type { RetrievalResult } from "../retrieval/types.js";
import { createLiveRegion } from "../accessibility/a11y.js";

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

  getElement(): HTMLElement {
    return this.container;
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
        const el = document.createElement("div");
        el.setAttribute("role", "listitem");
        el.tabIndex = 0;
        el.dataset.chunk = r.chunk.id;
        el.innerHTML = `<strong>${r.chunk.documentId}</strong> <code>${r.chunk.id}</code> <span>${Math.round(r.score * 100) / 100}</span><p>${r.chunk.content.slice(0, 120)}</p>`;
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
    const res = await this.workflow.run({ id: `search-${Date.now()}`, question: query });
    // Feed retrieved chunks into virtual list lazily
    const results: RetrievalResult[] = res.citations.map(c => ({
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
    this.announce(`Found ${results.length} results for ${query}`);
    // Refresh session browser to show new session
    this.sessionBrowser.render();
  }

  private inspect(r: RetrievalResult): void {
    if (!this.inspector) return;
    this.inspector.innerHTML = `<h4>${r.chunk.documentId} — ${r.chunk.id}</h4><p>Score ${Math.round(r.score * 100) / 100} · Source ${r.source}</p><pre>${r.chunk.content}</pre>`;
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
