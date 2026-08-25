/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AppRouter, matchHash } from "../../src/app/router.js";
import type { ResearchWorkflow } from "../../src/workflows/research.js";
import type { ViewContext } from "../../src/app/router.js";

const workspaceGate = vi.hoisted(() => {
  let release: (() => void) | undefined;
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, release: () => release?.() };
});

const readerFailure = vi.hoisted(() => ({ armed: true }));

vi.mock("../../src/app/views/workspaceView.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/views/workspaceView.js")>(
    "../../src/app/views/workspaceView.js",
  );
  return {
    createWorkspaceView: (ctx: ViewContext) =>
      workspaceGate.promise.then(() => actual.createWorkspaceView(ctx)),
  };
});

vi.mock("../../src/app/views/readerView.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/views/readerView.js")>(
    "../../src/app/views/readerView.js",
  );
  return {
    createReaderView: (ctx: ViewContext) => {
      if (readerFailure.armed) {
        readerFailure.armed = false;
        return Promise.reject(new Error("chunk failed"));
      }
      return actual.createReaderView(ctx);
    },
  };
});

function fakeWorkflow(): ResearchWorkflow {
  return {
    listDocuments: () => [],
    getManifest: () => null,
    getSnapshotHash: () => "test-hash",
    listSessions: () => [],
    exportSession: () => "{}",
    deleteSession: () => false,
    run: async ({ question }: { id: string; question: string }) => ({
      queryId: "q1",
      question,
      answer: `answer for ${question}`,
      confidence: 0.9,
      citations: [],
    }),
  } as unknown as ResearchWorkflow;
}

async function goTo(hash: string): Promise<void> {
  window.location.hash = hash;
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe("AppRouter lazy routes", () => {
  let container: HTMLElement;
  let router: AppRouter;

  beforeEach(() => {
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    window.location.hash = "#/home";
    router = new AppRouter({ container, workflow: fakeWorkflow() });
  });

  afterEach(() => {
    router.stop();
    workspaceGate.release();
    readerFailure.armed = true;
  });

  it("matchHash still resolves lazy route paths", () => {
    expect(matchHash("#/workspace")).toEqual({
      kind: "route",
      route: expect.objectContaining({ id: "workspace" }),
    });
    expect(matchHash("#/nope").kind).toBe("unknown");
  });

  it("mounts an accessible loading shell, then the real research view", async () => {
    window.location.hash = "#/research";
    router.start();

    const shell = container.querySelector("[data-autosd-lazy]");
    expect(shell).not.toBeNull();
    expect(shell?.getAttribute("aria-label")).toBe("Research");
    const status = shell?.querySelector('p[role="status"]');
    expect(status?.textContent).toContain("Loading Research");

    await vi.waitFor(() => {
      expect(container.querySelector('input[aria-label="Research question"]')).toBeTruthy();
    });
    expect(container.querySelector("[data-autosd-lazy]")).toBeNull();
    expect(document.activeElement?.textContent).toBe("Research");

    const live = container.querySelector('[aria-live="polite"][aria-label="Route announcements"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toContain("Research ready");
  });

  it("devices view loads lazily without a device manager", async () => {
    window.location.hash = "#/devices";
    router.start();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("No device manager available.");
    });
    expect(container.querySelector("[data-autosd-lazy]")).toBeNull();
  });

  it("serves cached heavy views synchronously on revisit", async () => {
    window.location.hash = "#/research";
    router.start();
    await vi.waitFor(() => {
      expect(container.querySelector('input[aria-label="Research question"]')).toBeTruthy();
    });

    await goTo("#/home");
    expect(container.querySelector('section[aria-label="Home"]')).toBeTruthy();

    await goTo("#/research");
    await vi.waitFor(() => {
      expect(container.querySelector('input[aria-label="Research question"]')).toBeTruthy();
    });
    expect(container.querySelector("[data-autosd-lazy]")).toBeNull();
  });

  it("does not swap a stale lazy view after navigating away", async () => {
    window.location.hash = "#/workspace";
    router.start();
    expect(container.querySelector("[data-autosd-lazy]")).not.toBeNull();

    await goTo("#/home");
    workspaceGate.release();

    await vi.waitFor(() => {
      expect(container.querySelector('section[aria-label="Home"]')).toBeTruthy();
    });
    await new Promise(resolve => setTimeout(resolve, 30));

    expect(container.querySelector('[aria-label="Research workspace"]')).toBeNull();
    expect(router.getCurrentRoute()?.id).toBe("home");

    await goTo("#/workspace");
    await vi.waitFor(() => {
      expect(container.querySelector('[aria-label="Research workspace"]')).toBeTruthy();
    });
    expect(container.querySelector("[data-autosd-lazy]")).toBeNull();
  });

  it("offers an alert with retry when a chunk fails to load", async () => {
    window.location.hash = "#/reader";
    router.start();

    await vi.waitFor(() => {
      expect(container.querySelector('[role="alert"]')).toBeTruthy();
    });
    const retryBtn = container.querySelector<HTMLButtonElement>('[role="alert"] button');
    expect(retryBtn?.getAttribute("aria-label")).toBe("Retry loading Reader");

    retryBtn?.click();
    await vi.waitFor(() => {
      expect(container.querySelector('[aria-label="Reader with grounded citations"]')).toBeTruthy();
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
