/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";
import { Workspace } from "../../src/app/Workspace.js";
import { renderCitation } from "../../src/ui/CitationView.js";

/**
 * Security regression: corpus content and filenames are untrusted. They must
 * render as inert text — never executable markup (stored-XSS vector, F-1/F-2).
 */
describe("untrusted corpus rendering", () => {
  const payload = '<img src=x onerror="window.__xss=1">';

  it("Workspace renders hostile document content without executing markup", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([{ id: "d1", content: `intro ${payload} tail` }]);
    await wf.run({ id: "q1", question: "intro" });

    const ws = new Workspace(wf);
    const parent = document.createElement("div");
    ws.mount(parent);

    const input = parent.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = "intro";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise(r => setTimeout(r, 200));

    // Open the inspector for the first rendered chunk.
    const chunkEl = parent.querySelector<HTMLElement>("[data-chunk]");
    expect(chunkEl).not.toBeNull();
    chunkEl!.click();

    expect((window as unknown as { __xss?: unknown }).__xss).toBeUndefined();
    expect(parent.querySelector("img")).toBeNull();
  });

  it("renderCitation escapes ids so attributes cannot be broken out of", () => {
    const html = renderCitation(
      {
        source: 'x" onmouseover="alert(1)',
        chunkId: 'c"><script>',
        documentId: `${payload}-doc`,
        content: "body",
        score: 0.5,
      },
      0.5,
    );
    expect(html).not.toContain('onmouseover="alert(1)"');
    expect(html).not.toContain("<script>");
  });
});
