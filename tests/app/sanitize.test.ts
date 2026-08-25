/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { escapeHtml, escapeSelector, safeJsonParse, truncate } from "../../src/utils/sanitize.js";

describe("sanitize utils", () => {
  it("escapeHtml neutralizes markup and attribute breakouts", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    expect(escapeHtml("a&b'c")).toBe("a&amp;b&#39;c");
  });

  it("escapeSelector prevents CSS attribute-selector breakout", () => {
    const hostile = 'x"],[data-cited="y';
    const safe = escapeSelector(hostile);
    expect(() => document.querySelector(`[data-cited="${safe}"]`)).not.toThrow();
  });

  it("safeJsonParse returns null on malformed input and honors guards", () => {
    expect(safeJsonParse("{not json")).toBeNull();
    expect(
      safeJsonParse(
        '{"a":1}',
        (v): v is { a: number } => typeof v === "object" && v !== null && "a" in v,
      ),
    ).toEqual({ a: 1 });
    expect(
      safeJsonParse(
        '{"b":1}',
        (v): v is { a: number } => typeof v === "object" && v !== null && "a" in v,
      ),
    ).toBeNull();
  });

  it("truncate caps length", () => {
    expect(truncate("abcdef", 3)).toBe("abc…[truncated]");
    expect(truncate("ab", 3)).toBe("ab");
  });
});
