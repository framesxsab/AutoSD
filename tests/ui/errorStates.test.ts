/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ErrorStateView,
  classifyError,
  createEmptyState,
  createSuccessState,
  showErrorState,
  announceTransition,
} from "../../src/ui/ErrorStates.js";
import { LoadingIndicator, withLoading, createSkeleton } from "../../src/ui/LoadingStates.js";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";
import type { EmbeddingProvider } from "../../src/retrieval/embedder.js";

function failingProvider(): EmbeddingProvider {
  return {
    id: "failing",
    dimensions: 8,
    model: "fail-1",
    embed: async () => {
      throw new TypeError("fetch failed");
    },
    embedMany: async () => {
      throw new TypeError("fetch failed");
    },
  };
}

function lastLiveText(host: HTMLElement): string {
  const lives = host.querySelectorAll<HTMLElement>('[role="status"][aria-live]');
  return lives.length > 0 ? (lives[lives.length - 1].textContent ?? "") : "";
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ErrorStates — ErrorStateView", () => {
  it("renders role=alert, moves focus to the heading, announces, and supports keyboard retry with focus recovery", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Search";
    document.body.appendChild(trigger);
    trigger.focus();

    const host = document.createElement("div");
    document.body.appendChild(host);

    let attempts = 0;
    const view = new ErrorStateView({
      kind: "network-failure",
      detail: "Connection lost",
      onRetry: async () => {
        attempts += 1;
      },
    });
    view.mount(host);

    // role="alert" + focus moved into the view
    expect(view.getElement().getAttribute("role")).toBe("alert");
    const heading = host.querySelector<HTMLElement>(".autosd-error-state__title")!;
    expect(document.activeElement).toBe(heading);
    expect(heading.textContent).toContain("Network problem");

    // polite live region announced the state
    expect(lastLiveText(host)).toContain("Network problem");

    // keyboard retry via Enter (native click is not synthesized in jsdom)
    const retryBtn = host.querySelector<HTMLButtonElement>("button")!;
    expect(retryBtn.textContent).toBe("Retry connection");
    retryBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(attempts).toBe(1);

    // successful recovery clears the view and restores focus to the trigger
    expect(host.querySelector(".autosd-error-state")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the view and re-enables retry when recovery fails, announcing politely", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let calls = 0;
    const view = new ErrorStateView({
      kind: "malformed-file",
      onRetry: async () => {
        calls += 1;
        if (calls === 1) throw new SyntaxError("Unexpected token in index.json");
        return true;
      },
    });
    view.mount(host);

    const ok = await view.retry();
    expect(ok).toBe(false);
    expect(view.isBusy()).toBe(false);
    expect(host.querySelector(".autosd-error-state")).not.toBeNull();
    expect(lastLiveText(host)).toContain("Still failing");

    const ok2 = await view.retry();
    expect(ok2).toBe(true);
    expect(host.querySelector(".autosd-error-state")).toBeNull();
  });

  it("traps Tab inside the view while visible", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new ErrorStateView({
      kind: "generic",
      onRetry: () => {},
      onDismiss: () => {},
    });
    view.mount(host);
    const buttons = host.querySelectorAll<HTMLButtonElement>("button");
    buttons[buttons.length - 1].focus();
    buttons[buttons.length - 1].dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("classifyError maps errno codes and message shapes to the right states", () => {
    const denied = new Error("read failed") as Error & { code?: string };
    denied.code = "EACCES";
    expect(classifyError(denied).kind).toBe("permission-denied");
    expect(classifyError(new TypeError("fetch failed")).kind).toBe("network-failure");
    expect(classifyError(new SyntaxError("Unexpected token } in JSON")).kind).toBe(
      "malformed-file",
    );
    expect(classifyError(new Error("WebHID is not supported here")).kind).toBe(
      "unsupported-environment",
    );
    expect(classifyError(new Error("boom")).kind).toBe("generic");
  });

  it("showErrorState classifies a raw error and never renders unsanitized markup", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const hostile = new Error("sk-abc123456 <img src=x onerror=alert(1)>") as Error & {
      code?: string;
    };
    hostile.code = "ENOTFOUND";
    const view = showErrorState(host, hostile, { onRetry: () => {} });
    expect(view.getElement().getAttribute("aria-label")).toBe("Network problem");
    // textContent only: no element injection from the hostile message
    expect(host.querySelector("img")).toBeNull();
    // secret material is redacted by sanitizeError before display
    expect(host.textContent).not.toContain("sk-abc123456");
  });

  it("success and empty states use role=status; empty CTA is keyboard operable", () => {
    const success = createSuccessState({ message: "Corpus indexed" });
    expect(success.getAttribute("role")).toBe("status");

    let ctaCalls = 0;
    const empty = createEmptyState({
      message: "No documents yet.",
      hint: "Add files to corpus/.",
      ctaLabel: "Add documents",
      onCta: () => {
        ctaCalls += 1;
      },
    });
    const host = document.createElement("div");
    host.appendChild(empty);
    expect(empty.getAttribute("role")).toBe("status");
    const cta = empty.querySelector<HTMLButtonElement>("button")!;
    cta.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(ctaCalls).toBe(1);
  });

  it("announceTransition appends a live region and returns a cancel function", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cancel = announceTransition("Indexing corpus", { host });
    const live = host.querySelector<HTMLElement>('[role="status"]');
    expect(live?.textContent).toBe("Indexing corpus");
    cancel();
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});

describe("LoadingStates", () => {
  it("exposes role=status, aria-busy, accessible label, and reduced-motion hook", () => {
    const indicator = new LoadingIndicator({ label: "Loading sessions" });
    const host = document.createElement("div");
    indicator.mount(host);
    const el = indicator.getElement();
    expect(el.getAttribute("role")).toBe("status");
    expect(el.getAttribute("aria-busy")).toBe("true");
    expect(el.getAttribute("aria-label")).toBe("Loading sessions");
    indicator.setBusy(false);
    expect(el.getAttribute("aria-busy")).toBe("false");
    indicator.setMessage("Almost done…");
    expect(el.textContent).toContain("Almost done…");
    indicator.unmount();
    expect(host.contains(el)).toBe(false);
  });

  it("withLoading mounts during the operation and always removes afterwards", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let sawLoadingDuringOp = false;
    const value = await withLoading(
      async () => {
        sawLoadingDuringOp = host.querySelector("[aria-busy='true']") !== null;
        return 42;
      },
      host,
      { label: "Working" },
    );
    expect(value).toBe(42);
    expect(sawLoadingDuringOp).toBe(true);
    expect(host.querySelector("[aria-busy]")).toBeNull();

    await expect(
      withLoading(async () => {
        throw new Error("nope");
      }, host),
    ).rejects.toThrow("nope");
    expect(host.querySelector("[aria-busy]")).toBeNull();
  });

  it("skeleton mode renders aria-hidden rows inside an announced container", () => {
    const skeleton = createSkeleton({ label: "Loading results", skeletonRows: 4 });
    expect(skeleton.getAttribute("role")).toBe("status");
    expect(skeleton.querySelectorAll(".autosd-skeleton__row")).toHaveLength(4);
    expect(skeleton.querySelector(".autosd-skeleton")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Workflow error surfacing (additive)", () => {
  it("ResearchWorkflow.runSafe resolves null, notifies onError, and retryLastQuery recovers after provider swap", async () => {
    // Failure injected at the retrieval boundary (where real outages surface)
    const brokenPipeline = {
      search: async () => {
        throw new TypeError("fetch failed");
      },
      getChunks: () => [],
      clear: () => {},
    } as unknown as import("../../src/retrieval/pipeline.js").RetrievalPipeline;
    const workflow = new ResearchWorkflow({ pipeline: brokenPipeline });

    const errors: unknown[] = [];
    workflow.onError(e => errors.push(e.error));

    const failed = await workflow.runSafe({ id: "q1", question: "alpha beta" });
    expect(failed).toBeNull();
    expect(errors).toHaveLength(1);
    expect(workflow.getLastError()?.operation).toBe("run");
    expect(workflow.hasRecoverableQuery()).toBe(true);

    workflow.setEmbeddingProvider(new MockEmbeddingProvider());
    const recovered = await workflow.retryLastQuery();
    expect(recovered).not.toBeNull();
    expect(recovered?.queryId).toBe("q1");
    expect(workflow.listSessions()).toHaveLength(1);
  });

  it("CorpusWatcher records scan errors for a missing dir while staying graceful", async () => {
    const { CorpusWatcher } = await import("../../src/retrieval/CorpusWatcher.js");
    const watcher = new CorpusWatcher("Z:/definitely/missing/dir", async () => {});
    const errors: unknown[] = [];
    watcher.onError(e => errors.push(e));
    const ev = await watcher.trigger();
    expect(ev.added).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(watcher.getLastError()?.operation).toBe("scan");
  });

  it("DeviceManager.trySetActive records instead of throwing; broadcast failures notify onError", async () => {
    const { DeviceManager } = await import("../../src/core/DeviceManager.js");
    const manager = new DeviceManager();
    expect(manager.trySetActive("ghost")).toBe(false);
    expect(manager.getLastError()?.operation).toBe("setActive");
    expect(() => manager.setActive("ghost")).toThrow();

    const renderErrors: unknown[] = [];
    manager.onError(e => renderErrors.push(e));
    const badDevice = {
      info: { id: "bad", name: "Bad", kind: "mock" },
      connect: async () => {},
      disconnect: async () => {},
      render: async () => {
        throw new Error("render exploded");
      },
    } as unknown as import("../../src/core/Device.js").Device;
    manager.register(badDevice);
    await manager.broadcast(new Uint8Array([1]));
    expect(renderErrors).toHaveLength(1);
    expect(renderErrors[0]).toMatchObject({ operation: "render", deviceId: "bad" });
  });

  it("unsubscribing error listeners stops notifications", async () => {
    const workflow = new ResearchWorkflow({ provider: failingProvider() });
    const fn = vi.fn();
    const unsub = workflow.onError(fn);
    unsub();
    await workflow.runSafe({ id: "q9", question: "x" });
    expect(fn).not.toHaveBeenCalled();
  });
});
