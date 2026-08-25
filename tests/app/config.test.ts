import { describe, it, expect, afterEach } from "vitest";
import { loadConfig, resetConfigCache } from "../../src/app/config.js";

describe("config", () => {
  afterEach(() => {
    resetConfigCache();
    delete process.env.VITE_LOG_LEVEL;
    delete process.env.VITE_EMBEDDING_PROVIDER;
  });

  it("falls back to safe defaults when env is empty", () => {
    resetConfigCache();
    const { config, warnings } = loadConfig();
    expect(config.corpusDir).toBe("corpus");
    expect(config.embeddingProvider).toBe("mock");
    expect(config.openaiBaseUrl).toBe("https://api.openai.com/v1");
    expect(warnings).toEqual([]);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("records invalid values as variable names only (never values)", () => {
    resetConfigCache();
    process.env.VITE_LOG_LEVEL = "LOUD";
    const { config, warnings } = loadConfig();
    // Vitest runs with MODE=test → non-production default level applies.
    expect(config.logLevel).toBe("debug");
    expect(warnings).toContain("VITE_LOG_LEVEL");
    expect(JSON.stringify(warnings)).not.toContain("LOUD");
  });

  it("never exposes secret material", () => {
    resetConfigCache();
    const { config } = loadConfig();
    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain("OPENAI_API_KEY");
    expect(serialized.toLowerCase()).not.toContain("apikey=");
  });

  it("strips credentials from base URLs", () => {
    resetConfigCache();
    process.env.VITE_OPENAI_BASE_URL = "https://user:pass@proxy.example.com/v1/";
    const { config } = loadConfig();
    expect(config.openaiBaseUrl).toBe("https://proxy.example.com/v1");
  });
});
