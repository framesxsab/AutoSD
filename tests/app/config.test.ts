import { describe, it, expect, afterEach } from "vitest";
import { loadConfig, resetConfigCache } from "../../src/app/config.js";

const ENV_KEYS = [
  "VITE_LOG_LEVEL",
  "VITE_EMBEDDING_PROVIDER",
  "VITE_MODE",
  "VITE_OPENAI_BASE_URL",
  "VITE_OPENAI_MODEL",
  "VITE_OPENAI_API_KEY",
  "OPENAI_API_KEY",
] as const;

function cleanEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

describe("config", () => {
  afterEach(() => {
    resetConfigCache();
    cleanEnv();
  });

  it("falls back to safe defaults when env is empty", () => {
    resetConfigCache();
    const { config, warnings } = loadConfig();
    expect(config.corpusDir).toBe("corpus");
    expect(config.embeddingProvider).toBe("mock");
    expect(config.openaiBaseUrl).toBe("https://api.openai.com/v1");
    expect(config.openaiMode).toBe("none");
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

  it("strips credentials from base URLs and flags them", () => {
    resetConfigCache();
    process.env.VITE_OPENAI_BASE_URL = "https://user:pass@proxy.example.com/v1/";
    const { config, warnings } = loadConfig();
    expect(config.openaiBaseUrl).toBe("https://proxy.example.com/v1");
    expect(warnings).toContain("VITE_OPENAI_BASE_URL");
  });

  // --- Three-mode resolution -------------------------------------------------

  it("mode none: no endpoint and no server key resolves to mock wiring", () => {
    resetConfigCache();
    delete process.env.OPENAI_API_KEY;
    const { config } = loadConfig();
    expect(config.openaiMode).toBe("none");
  });

  it("mode browser-endpoint: valid public https URL activates mode 2", () => {
    resetConfigCache();
    process.env.VITE_OPENAI_BASE_URL = "https://gateway.example.com/v1";
    const { config, warnings } = loadConfig();
    expect(config.openaiMode).toBe("browser-endpoint");
    expect(config.openaiBaseUrl).toBe("https://gateway.example.com/v1");
    expect(warnings).toEqual([]);
  });

  it("mode server-side: process-env key activates mode 3", () => {
    resetConfigCache();
    process.env.OPENAI_API_KEY = "sk-test-server-key-000000";
    const { config } = loadConfig();
    expect(config.openaiMode).toBe("server-side");
  });

  it("browser-endpoint wins over server-side when both are configured", () => {
    resetConfigCache();
    process.env.VITE_OPENAI_BASE_URL = "https://gateway.example.com/v1";
    process.env.OPENAI_API_KEY = "sk-test-server-key-000000";
    const { config } = loadConfig();
    expect(config.openaiMode).toBe("browser-endpoint");
  });

  it("official api.openai.com can never be a keyless browser endpoint", () => {
    resetConfigCache();
    process.env.VITE_OPENAI_BASE_URL = "https://api.openai.com/v1";
    const { config, warnings } = loadConfig();
    expect(config.openaiMode).toBe("none");
    expect(config.openaiBaseUrl).toBe("https://api.openai.com/v1");
    expect(warnings).toEqual([]);
  });

  // --- Base URL validation ---------------------------------------------------

  it("rejects malformed URLs: fallback + name-only warning", () => {
    resetConfigCache();
    process.env.VITE_OPENAI_BASE_URL = "not-a-url";
    const { config, warnings } = loadConfig();
    expect(config.openaiBaseUrl).toBe("https://api.openai.com/v1");
    expect(config.openaiMode).toBe("none");
    expect(warnings).toContain("VITE_OPENAI_BASE_URL");
  });

  it("rejects http in production; allows it outside production", () => {
    resetConfigCache();
    process.env.VITE_MODE = "production";
    process.env.VITE_OPENAI_BASE_URL = "http://gateway.example.com/v1";
    const prod = loadConfig();
    expect(prod.config.openaiBaseUrl).toBe("https://api.openai.com/v1");
    expect(prod.config.openaiMode).toBe("none");
    expect(prod.warnings).toContain("VITE_OPENAI_BASE_URL");

    resetConfigCache();
    process.env.VITE_MODE = "development";
    process.env.VITE_OPENAI_BASE_URL = "http://localhost:8080/v1";
    const dev = loadConfig();
    expect(dev.config.openaiBaseUrl).toBe("http://localhost:8080/v1");
    expect(dev.config.openaiMode).toBe("browser-endpoint");
  });

  it("rejects credential-bearing query params and never stores their values", () => {
    resetConfigCache();
    const secret = "supersecret123";
    process.env.VITE_OPENAI_BASE_URL = `https://gateway.example.com/v1?api_key=${secret}`;
    const { config, warnings } = loadConfig();
    expect(config.openaiBaseUrl).toBe("https://api.openai.com/v1");
    expect(config.openaiMode).toBe("none");
    expect(warnings).toContain("VITE_OPENAI_BASE_URL");
    expect(JSON.stringify({ config, warnings })).not.toContain(secret);
  });

  it("rejects embedded sk- key material anywhere in the URL", () => {
    resetConfigCache();
    const secret = "sk-abcdef1234567890";
    process.env.VITE_OPENAI_BASE_URL = `https://gateway.example.com/${secret}/v1`;
    const { config, warnings } = loadConfig();
    expect(config.openaiBaseUrl).toBe("https://api.openai.com/v1");
    expect(warnings).toContain("VITE_OPENAI_BASE_URL");
    expect(JSON.stringify({ config, warnings })).not.toContain(secret);
  });

  it("warns when a secret-looking VITE_ variable is set (would ship publicly)", () => {
    resetConfigCache();
    const secret = "sk-leaky-key-000000";
    process.env.VITE_OPENAI_API_KEY = secret;
    const { config, warnings } = loadConfig();
    expect(warnings).toContain("VITE_OPENAI_API_KEY");
    expect(JSON.stringify({ config, warnings })).not.toContain(secret);
    expect(JSON.stringify(config)).not.toContain("OPENAI_API_KEY");
  });
});
