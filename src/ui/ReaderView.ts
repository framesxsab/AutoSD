import { ReaderWorkflow, type ReaderDocument, type ReaderPage } from "../workflows/reader.js";
import { createCitationList } from "./CitationView.js";
import type { ResearchResult, ResearchCitation } from "../workflows/research.js";
import { createLiveRegion, prefersReducedMotion } from "../accessibility/a11y.js";
import { escapeSelector } from "../utils/sanitize.js";

export type ReaderViewOptions = {
  charsPerPage?: number;
  wordBoundary?: boolean;
  paginationMode?: "chars" | "cells";
  cellCount?: number;
  linesPerPage?: number;
  tactileMode?: "braille" | "dots";
  brailleGrade?: 1 | 2;
  onCitationOpen?: (citation: ResearchCitation) => void;
  onPageChange?: (page: ReaderPage) => void;
  onSendToDevice?: (page: ReaderPage) => void;
};

export class ReaderView {
  private reader = new ReaderWorkflow();
  private container: HTMLElement;
  private doc?: ReaderDocument;
  private result?: ResearchResult;
  private highlightedId?: string;
  private pages: ReaderPage[] = [];
  private activePageIndex = 0;

  constructor(private opts: ReaderViewOptions = {}) {
    this.container = document.createElement("div");
    this.container.setAttribute("role", "region");
    this.container.setAttribute("aria-label", "Reader with grounded citations");
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.container);
  }

  getPages(): readonly ReaderPage[] {
    return this.pages;
  }

  getCurrentPage(): ReaderPage | undefined {
    return this.pages[this.activePageIndex];
  }

  getActivePageIndex(): number {
    return this.activePageIndex;
  }

  getDocument(): ReaderDocument | undefined {
    return this.doc;
  }

  getResult(): ResearchResult | undefined {
    return this.result;
  }

  setPaginationOptions(
    opts: Partial<
      Pick<
        ReaderViewOptions,
        | "charsPerPage"
        | "wordBoundary"
        | "paginationMode"
        | "cellCount"
        | "linesPerPage"
        | "tactileMode"
        | "brailleGrade"
      >
    >,
  ): void {
    this.opts = { ...this.opts, ...opts };
    if (this.doc) {
      this.render(this.doc, this.result);
    }
  }

  setActivePage(index: number): void {
    if (index < 0 || index >= this.pages.length) return;
    this.activePageIndex = index;
    const status = this.container.querySelector<HTMLElement>("[data-reader-page-status]");
    if (status) {
      status.textContent = `Page ${this.activePageIndex + 1} of ${this.pages.length}`;
    }
    const articles = this.container.querySelectorAll<HTMLElement>("article[data-page]");
    articles.forEach(a => {
      const isCurrent = Number(a.dataset.page) === this.activePageIndex;
      if (isCurrent) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    const currentPage = this.pages[this.activePageIndex];
    if (currentPage) this.opts.onPageChange?.(currentPage);
  }

  render(doc: ReaderDocument, result?: ResearchResult): void {
    this.doc = doc;
    this.result = result;
    this.activePageIndex = 0;
    this.container.innerHTML = "";

    const header = document.createElement("h2");
    header.textContent = doc.title;
    header.id = "reader-title";
    header.dataset.autosdViewHeading = "true";
    this.container.appendChild(header);

    if (result) {
      const badge = document.createElement("div");
      badge.className = "autosd-confidence-badge";
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

    let pages: ReaderPage[];
    if (this.opts.paginationMode === "cells") {
      const byCells = this.reader.paginateByCells(doc, {
        cellCount: this.opts.cellCount ?? 40,
        linesPerPage: this.opts.linesPerPage ?? 5,
        mode: this.opts.tactileMode ?? "braille",
        grade: this.opts.brailleGrade ?? 1,
      });
      pages =
        byCells.length > 0
          ? byCells
          : this.reader.paginate(doc, {
              charsPerPage: this.opts.charsPerPage ?? 1000,
              wordBoundary: this.opts.wordBoundary ?? true,
            });
    } else {
      pages = this.reader.paginate(doc, {
        charsPerPage: this.opts.charsPerPage ?? 1000,
        wordBoundary: this.opts.wordBoundary ?? true,
      });
    }
    this.pages = pages;

    if (pages.length > 0 && (pages.length > 1 || this.opts.onSendToDevice)) {
      const controls = document.createElement("div");
      controls.className = "autosd-toolbar";
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", "Reader page controls");

      const pageStatus = document.createElement("span");
      pageStatus.setAttribute("role", "status");
      pageStatus.dataset.readerPageStatus = "true";
      pageStatus.textContent = `Page 1 of ${pages.length}`;
      controls.appendChild(pageStatus);

      if (pages.length > 1) {
        const prevPageBtn = document.createElement("button");
        prevPageBtn.type = "button";
        prevPageBtn.textContent = "Previous page";
        prevPageBtn.addEventListener("click", () => {
          const nextIdx = Math.max(0, this.activePageIndex - 1);
          this.setActivePage(nextIdx);
          const target = this.container.querySelector<HTMLElement>(
            `article[data-page="${nextIdx}"]`,
          );
          target?.focus();
        });

        const nextPageBtn = document.createElement("button");
        nextPageBtn.type = "button";
        nextPageBtn.textContent = "Next page";
        nextPageBtn.addEventListener("click", () => {
          const nextIdx = Math.min(pages.length - 1, this.activePageIndex + 1);
          this.setActivePage(nextIdx);
          const target = this.container.querySelector<HTMLElement>(
            `article[data-page="${nextIdx}"]`,
          );
          target?.focus();
        });
        controls.append(prevPageBtn, nextPageBtn);
      }

      if (this.opts.onSendToDevice) {
        const sendPageBtn = document.createElement("button");
        sendPageBtn.type = "button";
        sendPageBtn.textContent = "Send page to tactile device";
        sendPageBtn.addEventListener("click", () => {
          const page = this.getCurrentPage();
          if (page) this.opts.onSendToDevice?.(page);
        });
        controls.appendChild(sendPageBtn);
      }

      this.container.appendChild(controls);
    }

    const pageList = document.createElement("div");
    pageList.setAttribute("role", "list");
    pageList.setAttribute("aria-labelledby", "reader-title");

    pages.forEach(page => {
      const article = document.createElement("article");
      article.className = "autosd-reader-page";
      article.setAttribute("role", "listitem");
      article.setAttribute("aria-label", page.ariaLabel);
      if (page.index === 0) article.setAttribute("aria-current", "page");
      article.tabIndex = 0;
      article.dataset.page = String(page.index);
      article.textContent = page.text;
      article.addEventListener("focus", () => {
        if (this.activePageIndex !== page.index) this.setActivePage(page.index);
      });
      article.addEventListener("click", () => {
        if (this.activePageIndex !== page.index) this.setActivePage(page.index);
      });

      if (result) {
        for (const cit of result.citations) {
          if (cit.content && page.text.includes(cit.content.slice(0, 30))) {
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
        if (target) {
          const pIdx = Number(target.dataset.page);
          if (Number.isFinite(pIdx)) this.setActivePage(pIdx);
        }
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
      const matched = el.dataset.cited === chunkId;
      el.style.outline = matched ? "2px solid" : "";
      if (matched) {
        const pIdx = Number(el.dataset.page);
        if (Number.isFinite(pIdx)) this.setActivePage(pIdx);
      }
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
