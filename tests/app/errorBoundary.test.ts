/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { ErrorBoundary } from "../../src/app/ErrorBoundary.js";

describe("ErrorBoundary", () => {
  it("shows accessible fallback with sanitized message and retry", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const boundary = new ErrorBoundary({ host, label: "test failure" });

    boundary.show(new Error('boom <img src=x onerror="alert(1)"> sk-abc123def456'));

    const alert = host.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.getAttribute("aria-label")).toBe("test failure");
    // Raw markup must not be parsed: no img element may exist.
    expect(host.querySelector("img")).toBeNull();
    // Secret-shaped strings are redacted.
    expect(alert!.textContent).not.toContain("sk-abc123def456");
    expect(boundary.isActive).toBe(true);

    let retried = false;
    const host2 = document.createElement("div");
    document.body.appendChild(host2);
    const b2 = new ErrorBoundary({ host: host2, onRetry: () => (retried = true) });
    b2.show(new Error("second"));
    host2.querySelector<HTMLButtonElement>("button")!.click();
    expect(retried).toBe(true);
    expect(b2.isActive).toBe(false);
    host.remove();
    host2.remove();
  });

  it("wrap catches sync throws and guard catches rejections", async () => {
    const host = document.createElement("div");
    const boundary = new ErrorBoundary({ host });
    expect(boundary.wrap(() => JSON.parse("{bad"))).toBeNull();
    await expect(
      boundary.guard(async () => {
        throw new Error("async fail");
      }),
    ).resolves.toBeNull();
    expect(boundary.lastErrorSummary?.message).toContain("async fail");
  });
});
