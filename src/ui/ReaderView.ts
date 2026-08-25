import { ReaderWorkflow, type ReaderDocument } from "../workflows/reader.js";
import { createCitationList } from "./CitationView.js";
import type { ResearchResult, ResearchCitation } from "../workflows/research.js";
import { createLiveRegion, prefersReducedMotion } from "../accessibility/a11y.js";
import { escapeSelector } from "../utils/sanitize.js";

export type ReaderViewOptions = {
  charsPerPage?: number;
  onCitationOpen?: (citation: ResearchCitation) => void;
};

export class ReaderView {
  private reader = new ReaderWorkflow();
  private container: HTMLElement;
  private doc?: ReaderDocument;
  private result?: ResearchResult;
  private highlightedId?: string;

  constructor(private opts: ReaderViewOptions = {}) {
    this.container = document.createElement("div");
    this.container.setAttribute("role", "region");
    this.container.setAttribute("aria-label", "Reader with grounded citations");
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.container);
  }

  render(doc: ReaderDocument, result?: ResearchResult): void {
    this.doc = doc;
    this.result = result;
    this.container.innerHTML = "";

    const header = document.createElement("h2");
    header.textContent = doc.title;
    header.id = "reader-title";
    this.container.appendChild(header);

    if (result) {
      const badge = document.createElement("div");
      badge.setAttribute("role", "status");
      badge.setAttribute(
        "aria-label",
        `Confidence ${Math.round(result.confidence * 100)} percent from ${result.citations.length} sources`,
      );
      badge.style.display = "inline-block";
      badge.style.padding = "4px 8px";
      badge.style.border = "1px solid";
      badge.style.borderRadius = "4px";
      badge.textContent = `Confidence ${Math.round(result.confidence * 100)}% · ${result.citations.length} sources`;
      this.container.appendChild(badge);

      const meta = document.createElement("dl");
      meta.setAttribute("aria-label", "Source metadata");
      for (const c of result.citations) {
        const dt = document.createElement("dt");
        dt.textContent = c.documentId;
        const dd = document.createElement("dd");
        dd.textContent = `${c.chunkId} — score ${Math.round(c.score * 100) / 100}`;
        meta.appendChild(dt);
        meta.appendChild(dd);
      }
      this.container.appendChild(meta);
    }

    const pages = this.reader.paginate(doc, this.opts.charsPerPage ?? 1000);
    const pageList = document.createElement("div");
    pageList.setAttribute("role", "list");
    pageList.setAttribute("aria-labelledby", "reader-title");

    pages.forEach(page => {
      const article = document.createElement("article");
      article.setAttribute("role", "listitem");
      article.setAttribute("aria-label", page.ariaLabel);
      article.tabIndex = 0;
      article.dataset.page = String(page.index);
      article.textContent = page.text;

      if (result) {
        for (const cit of result.citations) {
          if (page.text.includes(cit.content.slice(0, 30))) {
            article.dataset.cited = cit.chunkId;
            article.style.outline = this.highlightedId === cit.chunkId ? "2px solid" : "";
            break;
          }
        }
      }

      pageList.appendChild(article);
    });

    this.container.appendChild(pageList);

    if (result) {
      const citationSection = createCitationList(result, cit => {
        this.highlight(cit.chunkId);
        this.opts.onCitationOpen?.(cit);
        const target = pageList.querySelector<HTMLElement>(
          `[data-cited="${escapeSelector(cit.chunkId)}"]`,
        );
        if (target && typeof target.scrollIntoView === "function")
          target.scrollIntoView({
            behavior: prefersReducedMotion() ? "auto" : "smooth",
            block: "center",
          });
        target?.focus();
      });
      this.container.appendChild(citationSection);

      const nav = document.createElement("div");
      nav.setAttribute("role", "group");
      nav.setAttribute("aria-label", "Citation navigation");
      const prev = document.createElement("button");
      prev.textContent = "Previous citation";
      prev.addEventListener("click", () => this.focusCitation(-1));
      const next = document.createElement("button");
      next.textContent = "Next citation";
      next.addEventListener("click", () => this.focusCitation(1));
      nav.appendChild(prev);
      nav.appendChild(next);
      this.container.appendChild(nav);
    }
  }

  highlight(chunkId: string): void {
    this.highlightedId = chunkId;
    const articles = this.container.querySelectorAll<HTMLElement>("[data-cited]");
    articles.forEach(el => {
      el.style.outline = el.dataset.cited === chunkId ? "2px solid" : "";
    });
    const msg = createLiveRegion(`Highlighted citation ${chunkId}`);
    const live = document.createElement("div");
    live.setAttribute("role", msg.role);
    live.setAttribute("aria-live", msg.ariaLive);
    live.textContent = msg.message;
    live.style.position = "absolute";
    live.style.left = "-9999px";
    this.container.appendChild(live);
    setTimeout(() => live.remove(), 1000);
  }

  focusCitation(dir: number): void {
    if (!this.result) return;
    const ids = this.result.citations.map(c => c.chunkId);
    const current = this.highlightedId ? ids.indexOf(this.highlightedId) : -1;
    const next = (current + dir + ids.length) % ids.length;
    const target = ids[next];
    if (target) {
      this.highlight(target);
      const el = this.container.querySelector<HTMLElement>(
        `[data-chunk="${escapeSelector(target)}"]`,
      );
      el?.focus();
    }
  }

  getElement(): HTMLElement {
    return this.container;
  }
}
