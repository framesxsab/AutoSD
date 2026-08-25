/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { SessionBrowser } from "../../src/ui/SessionBrowser.js";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";

async function makeWorkflowWithSessions(): Promise<ResearchWorkflow> {
  const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
  await wf.ingest([{ id: "d1", content: "alpha beta gamma document for testing citations" }]);
  await wf.run({ id: "q1", question: "alpha beta" });
  await wf.run({ id: "q2", question: "gamma" });
  return wf;
}

describe("SessionBrowser", () => {
  it("renders empty state", () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    const browser = new SessionBrowser(wf);
    const parent = document.createElement("div");
    browser.mount(parent);
    expect(parent.textContent).toContain("No retrieval sessions");
  });

  it("lists sessions with citations and confidence breakdown", async () => {
    const wf = await makeWorkflowWithSessions();
    const browser = new SessionBrowser(wf);
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    browser.mount(parent);
    expect(parent.textContent).toContain("Sessions (2)");
    const items = parent.querySelectorAll(
      "ul[aria-labelledby='session-browser-heading'] > li[role='listitem']",
    );
    expect(items).toHaveLength(2);
    expect(parent.textContent).toContain("Confidence breakdown");
    const details = parent.querySelector("details");
    expect(details).not.toBeNull();
    parent.remove();
  });

  it("export and delete actions", async () => {
    const wf = await makeWorkflowWithSessions();
    const onExport = vi.fn();
    const onDelete = vi.fn();
    const browser = new SessionBrowser(wf, { onExport, onDelete });
    const parent = document.createElement("div");
    browser.mount(parent);

    const exportBtn = parent.querySelector<HTMLButtonElement>("button")!;
    expect(exportBtn.textContent).toContain("Export JSON");
    exportBtn.click();
    expect(onExport).toHaveBeenCalled();
    expect(JSON.parse(onExport.mock.calls[0][0]).id).toBeDefined();

    const sessionsBefore = wf.listSessions().length;
    const deleteBtn = Array.from(parent.querySelectorAll<HTMLButtonElement>("button")).find(
      b => b.textContent === "Delete",
    )!;
    deleteBtn.click();
    expect(onDelete).toHaveBeenCalled();
    expect(wf.listSessions()).toHaveLength(sessionsBefore - 1);
  });

  it("keyboard navigation ArrowDown/Up and Delete key", async () => {
    const wf = await makeWorkflowWithSessions();
    const browser = new SessionBrowser(wf);
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    browser.mount(parent);
    const items = Array.from(
      parent.querySelectorAll<HTMLElement>(
        "ul[aria-labelledby='session-browser-heading'] > li[role='listitem']",
      ),
    );
    items[0].focus();
    items[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
    items[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(document.activeElement).toBe(items[0]);
    const before = wf.listSessions().length;
    items[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(wf.listSessions()).toHaveLength(before - 1);
    parent.remove();
  });

  it("handles delete on non-existent gracefully", async () => {
    const wf = await makeWorkflowWithSessions();
    const browser = new SessionBrowser(wf);
    const parent = document.createElement("div");
    browser.mount(parent);
    // directly call deleteSession with bad id
    browser.deleteSession("nope");
    expect(wf.listSessions()).toHaveLength(2);
  });

  it("getElement returns container", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    const browser = new SessionBrowser(wf);
    expect(browser.getElement().getAttribute("role")).toBe("region");
  });
});
