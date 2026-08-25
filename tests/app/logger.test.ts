import { describe, it, expect, afterEach } from "vitest";
import {
  redact,
  sanitizeError,
  registerSecret,
  clearRegisteredSecrets,
} from "../../src/app/logger.js";

describe("logger redaction", () => {
  afterEach(() => {
    clearRegisteredSecrets();
  });

  it("redacts sk-style API keys", () => {
    const out = redact("failed with key sk-abc123def456ghi789");
    expect(out).not.toContain("sk-abc123def456ghi789");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts bearer tokens and key params", () => {
    expect(redact("Authorization: Bearer abc.def.ghi12345")).not.toContain("abc.def.ghi12345");
    const q = redact("https://x/y?api_key=supersecret99&ok=1");
    expect(q).not.toContain("supersecret99");
    expect(q).toContain("api_key=[REDACTED]");
  });

  it("redacts registered literal secrets", () => {
    registerSecret("my-literal-secret-value");
    expect(redact("token is my-literal-secret-value!")).not.toContain("my-literal-secret-value");
  });

  it("truncates oversized messages", () => {
    expect(redact("x".repeat(1000)).length).toBeLessThan(600);
  });

  it("sanitizeError keeps name + message, drops stack by default", () => {
    const err = new Error("boom with sk-abcdefghijklmnop1234");
    const safe = sanitizeError(err);
    expect(safe.name).toBe("Error");
    expect(safe.message).toContain("boom");
    expect(safe.stack).toBeUndefined();
    expect(safe.message).not.toContain("sk-abcdefghijklmnop1234");
  });
});
