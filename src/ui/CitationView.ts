import type { ResearchCitation, ResearchResult } from "../workflows/research.js";
import { auditFocusOrder, auditTargetSize, createLiveRegion } from "../accessibility/a11y.js";

export type CitationOpenHandler = (citation: ResearchCitation) => void;

export function renderCitation(c: ResearchCitation, confidence: number): string {
  const pct = Math.round(confidence * 100);
  return (
    `<li role="listitem" tabindex="0" data-chunk="${c.chunkId}" data-doc="${c.documentId}" aria-label="Citation ${c.chunkId} from ${c.documentId} confidence ${pct} percent">` +
    `<strong>${c.documentId}</strong> <code>${c.chunkId}</code> ` +
    `<span aria-label="confidence ${pct} percent">${pct}%</span>` +
    `<p>${escapeHtml(c.content)}</p>` +
    `</li>`
  );
}

export function renderCitations(result: ResearchResult, _onOpen?: CitationOpenHandler): string {
  const items = result.citations.map(c => renderCitation(c, result.confidence)).join("");
  return (
    `<section aria-label="Grounded citations" role="region">` +
    `<h3>Citations — confidence ${Math.round(result.confidence * 100)}%</h3>` +
    `<ol role="list">${items}</ol>` +
    `</section>`
  );
}

export function createCitationList(
  result: ResearchResult,
  onOpen: CitationOpenHandler,
): HTMLElement {
  const section = document.createElement("section");
  section.setAttribute("aria-label", "Grounded citations");
  section.setAttribute("role", "region");

  const heading = document.createElement("h3");
  heading.textContent = `Citations — confidence ${Math.round(result.confidence * 100)}%`;
  section.appendChild(heading);

  const list = document.createElement("ol");
  list.setAttribute("role", "list");
  list.setAttribute("aria-label", "Citations");

  result.citations.forEach((c, idx) => {
    const li = document.createElement("li");
    li.setAttribute("role", "listitem");
    li.tabIndex = 0;
    li.dataset.chunk = c.chunkId;
    li.dataset.doc = c.documentId;
    li.setAttribute(
      "aria-label",
      `Citation ${c.chunkId} from ${c.documentId} confidence ${Math.round(result.confidence * 100)} percent`,
    );

    const targetAudit = auditTargetSize(120, 32);
    if (!targetAudit.passed) li.setAttribute("data-a11y-warn", targetAudit.message);

    li.innerHTML = `<strong>${escapeHtml(c.documentId)}</strong> <code>${escapeHtml(c.chunkId)}</code> <span>${Math.round(c.score * 100) / 100}</span><p>${escapeHtml(c.content)}</p>`;

    const activate = () => {
      const msg = createLiveRegion(`Opened citation ${c.chunkId}`);
      const live = document.createElement("div");
      live.setAttribute("role", msg.role);
      live.setAttribute("aria-live", msg.ariaLive);
      live.textContent = msg.message;
      live.style.position = "absolute";
      live.style.left = "-9999px";
      section.appendChild(live);
      setTimeout(() => live.remove(), 1000);
      onOpen(c);
    };

    li.addEventListener("click", activate);
    li.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
      const items = Array.from(list.querySelectorAll<HTMLElement>("li[role='listitem']"));
      const current = items.indexOf(li);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        items[(current + 1) % items.length]?.focus();
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        items[(current - 1 + items.length) % items.length]?.focus();
      }
    });

    list.appendChild(li);
    if (idx === 0) {
      const orderAudit = auditFocusOrder(
        result.citations.map(x => x.chunkId),
        result.citations.map(x => x.chunkId),
      );
      void orderAudit;
    }
  });

  section.appendChild(list);
  return section;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
