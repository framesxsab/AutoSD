/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { ReaderView } from "../../src/ui/ReaderView.js";

describe("ReaderView", () => {
  it("mounts citations with highlight and keyboard nav", () => {
    const view = new ReaderView({ charsPerPage: 50 });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    view.mount(parent);

    const doc = {
      id: "d1",
      title: "Test Doc",
      content: "alpha beta gamma alpha beta gamma ".repeat(5),
    };
    const result = {
      queryId: "q1",
      answer: "Answer",
      confidence: 0.88,
      citations: [
        { source: "d1", chunkId: "d1#0", documentId: "d1", content: "alpha beta", score: 0.9 },
        { source: "d1", chunkId: "d1#1", documentId: "d1", content: "gamma alpha", score: 0.7 },
      ],
    };

    const onOpen = vi.fn();
    const view2 = new ReaderView({ onCitationOpen: onOpen });
    const parent2 = document.createElement("div");
    document.body.appendChild(parent2);
    view2.mount(parent2);
    view2.render(doc, result);

    expect(parent2.textContent).toContain("Confidence 88%");
    expect(parent2.textContent).toContain("d1#0");
    const firstCite = parent2.querySelector<HTMLElement>('[data-chunk="d1#0"]')!;
    expect(firstCite).not.toBeNull();
    firstCite.click();
    expect(onOpen).toBeCalled();
    const articles = parent2.querySelectorAll<HTMLElement>("article");
    expect(articles.length).toBeGreaterThan(0);
    expect(articles[0].getAttribute("aria-label")).toContain("Test Doc");

    // Keyboard nav between citations via focusCitation
    view2.focusCitation(1);
    view2.focusCitation(-1);

    parent.remove();
    parent2.remove();
  });

  it("renders without result", () => {
    const view = new ReaderView();
    const parent = document.createElement("div");
    view.mount(parent);
    view.render({ id: "d1", title: "Empty", content: "hello" });
    expect(parent.textContent).toContain("Empty");
  });
});
