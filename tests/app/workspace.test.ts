/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";
import { Workspace } from "../../src/app/Workspace.js";

describe("Workspace", () => {
  it("renders corpus manager, search, chunks, inspector, export history", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([{ id: "d1", content: "knowledge base for autonomous workspace testing" }]);
    await wf.run({ id: "q1", question: "autonomous workspace" });

    const ws = new Workspace(wf);
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    ws.mount(parent);

    expect(parent.textContent).toContain("Autonomous Knowledge Workspace");
    expect(parent.textContent).toContain("Corpus");
    expect(parent.textContent).toContain("Search");
    expect(parent.textContent).toContain("Retrieved chunks");
    expect(parent.querySelector('[aria-label="Citation inspector"]')).not.toBeNull();
    expect(parent.querySelector('[aria-label="Session history"]')).not.toBeNull();

    const input = parent.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(input.getAttribute("aria-label")).toBe("Search corpus");
    input.value = "autonomous";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    // Wait for async search
    await new Promise(r => setTimeout(r, 200));
    expect(wf.listSessions().length).toBeGreaterThanOrEqual(1);

    // Inspector lazy
    const inspector = parent.querySelector('[aria-label="Citation inspector"]')!;
    expect(inspector.textContent).toContain("Select a chunk");

    parent.remove();
  });

  it("handles empty query gracefully", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    const ws = new Workspace(wf);
    const parent = document.createElement("div");
    ws.mount(parent);
    const input = parent.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = "   ";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    expect(wf.listSessions()).toHaveLength(0);
    parent.remove();
  });
});
