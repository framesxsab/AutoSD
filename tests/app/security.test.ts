/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";
import { OpenAIEmbeddingProvider } from "../../src/retrieval/providers/OpenAIEmbeddingProvider.js";
import { Workspace } from "../../src/app/Workspace.js";
import { createCitationList, renderCitation } from "../../src/ui/CitationView.js";
import { sanitize } from "../../src/app/diagnostics.js";
import { assertSafePath, loadManifest } from "../../src/retrieval/persistence.js";
import { clearRegisteredSecrets } from "../../src/app/logger.js";

/**
 * Security regression: corpus content and filenames are untrusted. They must
 * render as inert text — never executable markup (stored-XSS vector, F-1/F-2).
 */
describe("untrusted corpus rendering", () => {
  const payload = '<img src=x onerror="window.__xss=1">';
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch as unknown as typeof fetch;
    clearRegisteredSecrets();
    vi.restoreAllMocks();
  });

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

  it("renderCitation and createCitationList escape ids and avoid executable markup", () => {
    const cit = {
      source: 'x" onmouseover="alert(1)',
      chunkId: 'c"><script>',
      documentId: `${payload}-doc`,
      content: payload,
      score: 0.5,
    };
    const html = renderCitation(cit, 0.5);
    expect(html).not.toContain('onmouseover="alert(1)"');
    expect(html).not.toContain("<script>");

    const dom = createCitationList(
      { queryId: "q", answer: "a", confidence: 0.5, citations: [cit] },
      () => {},
    );
    expect(dom.querySelector("img")).toBeNull();
    expect(dom.querySelector("script")).toBeNull();
    expect(dom.textContent).toContain(payload);
  });

  it("OpenAIEmbeddingProvider hides #apiKey from instance inspection, redacts custom secrets, and enforces rate & batch limits", async () => {
    const customSecret = "custom-gateway-secret-998877";
    const provider = new OpenAIEmbeddingProvider(
      "text-embedding-3-small",
      3,
      customSecret,
      "https://gateway.example.com/v1",
      false,
      2,
      2,
    );
    expect((provider as unknown as { apiKey?: string }).apiKey).toBeUndefined();
    expect(JSON.stringify(provider)).not.toContain(customSecret);

    // Batch limit enforcement
    await expect(provider.embedMany(["a", "b", "c"])).rejects.toThrow("batch size 3 exceeds limit");

    // Rate limit enforcement (max 2 requests/min)
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({ data: [{ embedding: [1, 0, 0] }] }),
        }) as Response,
    ) as unknown as typeof fetch;

    await provider.embed("first");
    await provider.embed("second");
    await expect(provider.embed("third")).rejects.toThrow("rate limit exceeded");

    // Custom registered secret redaction in error body
    const errProvider = new OpenAIEmbeddingProvider(
      "text-embedding-3-small",
      3,
      customSecret,
      "https://gateway.example.com/v1",
    );
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: false,
          status: 403,
          text: async () => `invalid key ${customSecret}`,
        }) as Response,
    ) as unknown as typeof fetch;

    await expect(errProvider.embed("test")).rejects.not.toThrow(customSecret);
  });

  it("diagnostics.sanitize redacts secret patterns inside string values even under non-sensitive keys", () => {
    const out = sanitize({
      note: "failed calling gateway with sk-live1234567890abcdef",
      url: "https://example.com/v1?api_key=mytopsecret123",
    }) as Record<string, string>;
    expect(out.note).not.toContain("sk-live1234567890abcdef");
    expect(out.note).toContain("[REDACTED]");
    expect(out.url).not.toContain("mytopsecret123");
  });

  it("assertSafePath and persistence reject path traversal and null bytes", async () => {
    expect(() => assertSafePath("../outside/index.json")).toThrow("path traversal");
    expect(() => assertSafePath("corpus/../../etc/passwd")).toThrow("path traversal");
    expect(() => assertSafePath("corpus/index.json\0.txt")).toThrow("path traversal");
    expect(await loadManifest("../outside/index.json")).toBeNull();
  });

  it("fromPersistedState filters malformed sessions missing createdAt or citations array", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.fromPersistedState({
      documents: [{ id: "d1", content: "safe content" }],
      sessions: [
        // malformed: createdAt is numeric, citations is not an array
        {
          id: "bad-1",
          createdAt: 12345 as unknown as string,
          query: { id: "q", question: "q" },
          results: { queryId: "q", answer: "a", confidence: 0.5, citations: null as unknown as [] },
          manifest: { version: "1.0.0", snapshotHash: "h", chunkCount: 1 },
          topK: [],
        },
        {
          id: "good-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          query: { id: "q2", question: "valid question" },
          results: { queryId: "q2", answer: "valid", confidence: 0.8, citations: [] },
          manifest: { version: "1.0.0", snapshotHash: "h", chunkCount: 1 },
          topK: [],
        },
      ],
    });
    expect(wf.listSessions()).toHaveLength(1);
    expect(wf.listSessions()[0].id).toBe("good-1");
  });
});
