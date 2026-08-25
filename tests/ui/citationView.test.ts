/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { renderCitation, renderCitations, createCitationList } from "../../src/ui/CitationView.js";
import type { ResearchResult } from "../../src/workflows/research.js";

function makeResult(): ResearchResult {
  return {
    queryId: "q1",
    answer: "Answer grounded",
    confidence: 0.82,
    citations: [
      { source: "doc1", chunkId: "doc1#0", documentId: "doc1", content: "hello world", score: 0.9 },
      {
        source: "doc2",
        chunkId: "doc2#1",
        documentId: "doc2",
        content: "second chunk",
        score: 0.7,
      },
    ],
  };
}

describe("CitationView", () => {
  it("renderCitation string contains a11y attrs", () => {
    const html = renderCitation(makeResult().citations[0], 0.82);
    expect(html).toContain('role="listitem"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("doc1#0");
    expect(html).toContain("82%");
  });

  it("renderCitations wraps", () => {
    const html = renderCitations(makeResult());
    expect(html).toContain('aria-label="Grounded citations"');
    expect(html).toContain("<ol");
  });

  it("createCitationList DOM with click and keyboard", () => {
    const result = makeResult();
    const onOpen = vi.fn();
    const el = createCitationList(result, onOpen);
    document.body.appendChild(el);
    expect(el.getAttribute("role")).toBe("region");
    const items = el.querySelectorAll<HTMLElement>("li[role='listitem']");
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute("aria-label")).toContain("doc1#0");
    items[0].click();
    expect(onOpen).toHaveBeenCalledWith(result.citations[0]);
    const before = onOpen.mock.calls.length;
    items[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onOpen.mock.calls.length).toBe(before + 1);
    items[0].focus();
    items[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
    items[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(document.activeElement).toBe(items[0]);
    el.remove();
  });

  it("space key activates", () => {
    const result = makeResult();
    const onOpen = vi.fn();
    const el = createCitationList(result, onOpen);
    document.body.appendChild(el);
    const item = el.querySelector<HTMLElement>("li")!;
    item.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(onOpen).toHaveBeenCalled();
    el.remove();
  });
});
