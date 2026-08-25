import type { ResearchWorkflow } from "../workflows/research.js";
import { createCitationList } from "./CitationView.js";
import { createLiveRegion } from "../accessibility/a11y.js";

export type SessionBrowserOptions = {
  onExport?: (json: string) => void;
  onDelete?: (id: string) => void;
  onOpenCitation?: (sessionId: string, chunkId: string) => void;
};

export class SessionBrowser {
  private container: HTMLElement;

  constructor(
    private workflow: ResearchWorkflow,
    private opts: SessionBrowserOptions = {},
  ) {
    this.container = document.createElement("div");
    this.container.setAttribute("role", "region");
    this.container.setAttribute("aria-label", "Retrieval session history");
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.container);
    this.render();
  }

  render(): void {
    this.container.innerHTML = "";
    const sessions = this.workflow.listSessions();

    const heading = document.createElement("h2");
    heading.textContent = `Sessions (${sessions.length})`;
    heading.id = "session-browser-heading";
    this.container.appendChild(heading);

    if (sessions.length === 0) {
      const empty = document.createElement("p");
      empty.setAttribute("role", "status");
      empty.textContent = "No retrieval sessions yet.";
      this.container.appendChild(empty);
      return;
    }

    const list = document.createElement("ul");
    list.setAttribute("role", "list");
    list.setAttribute("aria-labelledby", "session-browser-heading");

    for (const s of sessions) {
      const li = document.createElement("li");
      li.setAttribute("role", "listitem");
      li.tabIndex = 0;
      li.dataset.session = s.id;
      li.setAttribute(
        "aria-label",
        `Session ${s.query.question} confidence ${Math.round(s.results.confidence * 100)} percent`,
      );

      const title = document.createElement("strong");
      title.textContent = s.query.question;
      li.appendChild(title);

      const meta = document.createElement("div");
      meta.textContent = `${s.results.citations.length} citations · ${Math.round(s.results.confidence * 100)}% · ${s.manifest.version}`;
      meta.setAttribute(
        "aria-label",
        `Confidence breakdown ${Math.round(s.results.confidence * 100)} percent from ${s.results.citations.length} sources`,
      );
      li.appendChild(meta);

      const breakdown = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Confidence breakdown";
      summary.tabIndex = 0;
      breakdown.appendChild(summary);
      for (const cit of s.results.citations) {
        const row = document.createElement("div");
        row.textContent = `${cit.documentId} ${cit.chunkId}: score ${Math.round(cit.score * 100) / 100}`;
        breakdown.appendChild(row);
      }
      breakdown.appendChild(
        createCitationList(s.results, cit => this.opts.onOpenCitation?.(s.id, cit.chunkId)),
      );
      li.appendChild(breakdown);

      const actions = document.createElement("div");
      actions.setAttribute("role", "group");
      actions.setAttribute("aria-label", "Session actions");

      const exportBtn = document.createElement("button");
      exportBtn.textContent = "Export JSON";
      exportBtn.setAttribute("aria-label", `Export session ${s.id} as JSON`);
      exportBtn.addEventListener("click", () => {
        const json = this.workflow.exportSession(s.id);
        this.opts.onExport?.(json);
        this.announce(`Exported session ${s.id}`);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Delete";
      deleteBtn.setAttribute("aria-label", `Delete session ${s.id}`);
      deleteBtn.addEventListener("click", () => {
        this.deleteSession(s.id);
      });

      actions.appendChild(exportBtn);
      actions.appendChild(deleteBtn);
      li.appendChild(actions);

      li.addEventListener("keydown", e => {
        if (e.key === "Delete") {
          e.preventDefault();
          this.deleteSession(s.id);
        }
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "LI") {
          (li.querySelector("details") as HTMLDetailsElement)?.toggleAttribute("open");
        }
        const items = Array.from(list.children) as HTMLElement[];
        const idx = items.indexOf(li);
        if (e.key === "ArrowDown") {
          e.preventDefault();
          items[(idx + 1) % items.length]?.focus();
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          items[(idx - 1 + items.length) % items.length]?.focus();
        }
      });

      list.appendChild(li);
    }

    this.container.appendChild(list);
  }

  deleteSession(id: string): void {
    const ok = this.workflow.deleteSession(id);
    if (!ok) return;
    this.opts.onDelete?.(id);
    this.announce(`Deleted session ${id}`);
    this.render();
  }

  private announce(message: string): void {
    const live = createLiveRegion(message);
    const el = document.createElement("div");
    el.setAttribute("role", live.role);
    el.setAttribute("aria-live", live.ariaLive);
    el.textContent = live.message;
    el.style.position = "absolute";
    el.style.left = "-9999px";
    this.container.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  getElement(): HTMLElement {
    return this.container;
  }
}
