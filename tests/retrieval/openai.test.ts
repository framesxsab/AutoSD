import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAIEmbeddingProvider } from "../../src/retrieval/providers/OpenAIEmbeddingProvider.js";

describe("OpenAIEmbeddingProvider fetch", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch as unknown as typeof fetch;
    vi.restoreAllMocks();
  });

  it("embedMany calls fetch and returns embeddings", async () => {
    const mockFetch = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({
            data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }],
          }),
        }) as Response,
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    const p = new OpenAIEmbeddingProvider(
      "text-embedding-3-small",
      3,
      "sk-test",
      "https://api.openai.com/v1",
    );
    const res = await p.embedMany(["a", "b"]);
    expect(res).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalled();
    const single = await p.embed("hello");
    expect(single).toEqual([0.1, 0.2, 0.3]);
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = vi.fn(
      async () => ({ ok: false, status: 401, text: async () => "unauthorized" }) as Response,
    ) as unknown as typeof fetch;
    const p = new OpenAIEmbeddingProvider("text-embedding-3-small", 3, "sk-test");
    await expect(p.embedMany(["a"])).rejects.toThrow("401");
  });

  it("embed delegates to embedMany", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({ data: [{ embedding: [1, 2, 3] }] }),
        }) as Response,
    ) as unknown as typeof fetch;
    const p = new OpenAIEmbeddingProvider("m", 3, "sk-test");
    await expect(p.embed("hi")).resolves.toEqual([1, 2, 3]);
  });
});

describe("OpenAIEmbeddingProvider keyless (browser-endpoint) mode", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch as unknown as typeof fetch;
    vi.restoreAllMocks();
  });

  it("is configured without a key when keyless, and sends no Authorization header", async () => {
    const mockFetch = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({ data: [{ embedding: [7, 8, 9] }] }),
        }) as Response,
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    const p = new OpenAIEmbeddingProvider(
      "text-embedding-3-small",
      3,
      "",
      "https://gateway.example.com/v1",
      true,
    );
    expect(p.isConfigured()).toBe(true);
    await p.embedMany(["a"]);
    expect(mockFetch).toHaveBeenCalled();
    const init = (mockFetch.mock.calls as unknown as [string, RequestInit][])[0][1];
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("without a key and without keyless, reports unconfigured and throws", async () => {
    const p = new OpenAIEmbeddingProvider("text-embedding-3-small", 3, "");
    expect(p.isConfigured()).toBe(false);
    await expect(p.embedMany(["a"])).rejects.toThrow("OPENAI_API_KEY not set");
  });
});
