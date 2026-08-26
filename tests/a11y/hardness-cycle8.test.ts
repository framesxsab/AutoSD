/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { VirtualList } from "../../src/ui/VirtualList.js";
import { createCitationList } from "../../src/ui/CitationView.js";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";
import {
  createLiveRegion,
  auditTargetSize,
  auditFocusOrder,
} from "../../src/accessibility/a11y.js";
import { SessionBrowser } from "../../src/ui/SessionBrowser.js";

describe("accessibility hardness — synthetic stress (C8.3)", () => {
  it("VirtualList — grid semantics and aria-rowcount", () => {
    const list = new VirtualList<string>({
      itemHeight: 20,
      containerHeight: 100,
      renderItem: item => {
        const el = document.createElement("div");
        el.textContent = item;
        return el;
      },
    });
    list.setItems(["a", "b", "c"]);
    const el = list.getElement();
    expect(el.getAttribute("role")).toBe("list");
    expect(el.getAttribute("aria-rowcount")).toBe("3");
  });
  it("live-region — createLiveRegion returns polite", () => {
    const r1 = createLiveRegion("loading");
    expect(r1.message).toContain("loading");
    expect(r1.ariaLive).toBe("polite");
  });
  it("auditTargetSize — detects too small target", () => {
    const ok = auditTargetSize(44, 44);
    const bad = auditTargetSize(20, 20);
    expect(ok.passed).toBe(true);
    expect(bad.passed).toBe(false);
  });
  it("auditFocusOrder — detects correct order", () => {
    const ok = auditFocusOrder(["a", "b", "c"], ["a", "b", "c"]);
    const bad = auditFocusOrder(["a", "b"], ["b", "a"]);
    expect(ok.passed).toBe(true);
    expect(bad.passed).toBe(false);
  });
  it("virtualized list — aria-posinset and setsize", () => {
    const list = new VirtualList<string>({
      itemHeight: 20,
      containerHeight: 60,
      renderItem: item => {
        const el = document.createElement("div");
        el.textContent = item;
        return el;
      },
    });
    list.setItems(Array.from({ length: 5 }, (_, i) => `item ${i}`));
    const el = list.getElement();
    document.body.appendChild(el);
    const items = el.querySelectorAll("[aria-posinset]");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].getAttribute("aria-setsize")).toBe("5");
    el.remove();
  });
  it("CitationView — creates list with citations", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([{ id: "a", path: "a.md", content: "hello world" }]);
    const res = await wf.run({ id: "q", question: "hello" });
    const el = createCitationList(res, () => {});
    expect(el.getAttribute("aria-label")).toBe("Grounded citations");
    expect(el.querySelector("ol[role='list']")).not.toBeNull();
  });
  it("reduced motion — media query boolean", () => {
    if (!window.matchMedia) {
      (window as any).matchMedia = (q: string) =>
        ({
          matches: false,
          media: q,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
        }) as any;
    }
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    expect(typeof media.matches).toBe("boolean");
  });
  it("SessionBrowser empty state", () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    const browser = new SessionBrowser(wf);
    const parent = document.createElement("div");
    browser.mount(parent);
    expect(browser.getElement().textContent?.toLowerCase()).toContain("no retrieval sessions");
  });
  it("SessionBrowser with sessions", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([{ id: "s", path: "s.md", content: "hello" }]);
    await wf.run({ id: "q", question: "hello" });
    const browser = new SessionBrowser(wf);
    const parent = document.createElement("div");
    browser.mount(parent);
    expect(browser.getElement().textContent).toContain("hello");
  });
  it("Reader + Citation integration", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([{ id: "r", path: "r.md", content: "reader citation test content here" }]);
    const res = await wf.run({ id: "q", question: "reader" });
    expect(res.citations.length).toBeGreaterThan(0);
    const el = createCitationList(res, () => {});
    expect(el.textContent).toContain(res.citations[0].documentId);
  });
  it("DemoPanel mounts", async () => {
    const { DemoPanel } = await import("../../src/ui/DemoPanel.js");
    const panel = new DemoPanel();
    const parent = document.createElement("div");
    panel.mount(parent);
    expect(parent.textContent?.toLowerCase()).toContain("demo");
  });
});
