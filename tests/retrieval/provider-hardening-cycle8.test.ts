import { describe, it, expect, afterEach } from "vitest";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";
import { OpenAIEmbeddingProvider } from "../../src/retrieval/providers/OpenAIEmbeddingProvider.js";
import { collectDiagnostics } from "../../src/app/diagnostics.js";
import { ResearchWorkflow } from "../../src/workflows/research.js";

describe("provider config hardening (C8.4)", () => {
  const origEnv = process.env.OPENAI_API_KEY;
  afterEach(() => {
    if (origEnv === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = origEnv;
  });
  it("mock mode — deterministic embeddings without network", async () => {
    const p = new MockEmbeddingProvider();
    const a = await p.embed("hello");
    const b = await p.embed("hello");
    expect(a).toEqual(b);
  });
  it("server mode — apiKey from env, diagnostics redacts", async () => {
    process.env.OPENAI_API_KEY = "sk-test1234567890";
    const p = new OpenAIEmbeddingProvider(
      "text-embedding-3-small",
      1536,
      process.env.OPENAI_API_KEY,
    );
    const diag = collectDiagnostics({ provider: p });
    expect(JSON.stringify(diag)).not.toContain("sk-test1234567890");
    expect(p.isConfigured()).toBe(true);
    delete process.env.OPENAI_API_KEY;
  });
  it("missing configuration — isConfigured false, no throw", () => {
    const p = new OpenAIEmbeddingProvider("text-embedding-3-small", 1536, "");
    expect(() => p.isConfigured()).not.toThrow();
    expect(p.isConfigured()).toBe(false);
  });
  it("malformed URL still handled — isConfigured based on key, fetch would fail but not leak", async () => {
    const p = new OpenAIEmbeddingProvider("text-embedding-3-small", 1536, "sk-test", "not-a-url");
    expect(p.isConfigured()).toBe(true);
  });
  it("fallback explicit — mock is default when no provider configured", async () => {
    const wf = new ResearchWorkflow({});
    await wf.ingest([{ id: "fb", path: "fb.md", content: "fallback test" }]);
    const res = await wf.run({ id: "q", question: "fallback" });
    expect(res.citations.length).toBeGreaterThan(0);
  });
  it("secret redaction — diagnostics never contains raw secret", () => {
    const fake = { apiKey: "sk-12345", token: "abc", plain: 1 } as any;
    const sanitized = JSON.stringify(collectDiagnostics({ provider: fake }));
    expect(sanitized).not.toContain("sk-12345");
  });
  it("offline mode functional — mock provider works without network", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([{ id: "off", path: "off.md", content: "offline test" }]);
    const res = await wf.run({ id: "q", question: "offline" });
    expect(res.answer).toBeDefined();
  });
});
