import { container, DIContainer } from "../core/DIContainer.js";
import { ResearchWorkflow, EMBEDDING_TOKEN } from "../workflows/research.js";
import { MockEmbeddingProvider } from "../retrieval/providers/MockEmbeddingProvider.js";
import { OpenAIEmbeddingProvider } from "../retrieval/providers/OpenAIEmbeddingProvider.js";
import { LiveSync } from "./LiveSync.js";
import { DeviceManager } from "../core/DeviceManager.js";
import { MockDevice } from "../devices/MockDevice.js";
import { getConfig } from "./config.js";
import { logger } from "./logger.js";

export const WORKFLOW_TOKEN = "research:workflow";
export const LIVE_SYNC_TOKEN = "liveSync";
export const DEVICE_MANAGER_TOKEN = "devices:manager";

export type BootstrapOptions = {
  corpusDir?: string;
  di?: DIContainer;
  /**
   * v0.9 perf: resolve bootstrapApp without awaiting corpus load / live sync
   * start; they run detached and settle into `ready`. Default (false) keeps
   * the fully-awaited v0.8 semantics.
   */
  background?: boolean;
};

export type BootstrapBackgroundOutcome = {
  restored: boolean;
  syncStarted: boolean;
};

export type BootstrapResult = {
  workflow: ResearchWorkflow;
  liveSync: LiveSync;
  restored: boolean;
  corpusDir: string;
  di: DIContainer;
  deviceManager: DeviceManager;
  stop: () => void;
  /** Present only with opts.background — never rejects. */
  ready?: Promise<BootstrapBackgroundOutcome>;
};

/**
 * Resolve the embedding provider from config (three modes, v1.0):
 *  - browser-endpoint: VITE_OPENAI_BASE_URL is a validated PUBLIC gateway →
 *    keyless provider against it; no secret exists client-side.
 *  - server-side: OPENAI_API_KEY in process env (Node/CLI/server only) →
 *    keyed provider; the key never leaves the provider and is never logged.
 *  - none: no safe external wiring → Mock — the app stays usable without
 *    optional external services.
 */
export function resolveEmbeddingProvider() {
  const config = getConfig();
  if (config.embeddingProvider === "openai") {
    if (config.openaiMode === "browser-endpoint") {
      return new OpenAIEmbeddingProvider(config.openaiModel, 1536, "", config.openaiBaseUrl, true);
    }
    if (config.openaiMode === "server-side") {
      return new OpenAIEmbeddingProvider(config.openaiModel, 1536, undefined, config.openaiBaseUrl);
    }
    logger.warn(
      "VITE_EMBEDDING_PROVIDER=openai but no safe endpoint or server-side OPENAI_API_KEY — using mock",
    );
  }
  return new MockEmbeddingProvider();
}

export async function bootstrapApp(opts: BootstrapOptions = {}): Promise<BootstrapResult> {
  const di = opts.di ?? container;
  const corpusDir = opts.corpusDir ?? getConfig().corpusDir;

  if (!di.has(EMBEDDING_TOKEN)) {
    di.register(EMBEDDING_TOKEN, () => resolveEmbeddingProvider());
  }

  let workflow: ResearchWorkflow;
  let restored = false;
  let workflowReady: Promise<boolean>;

  if (di.has(WORKFLOW_TOKEN)) {
    workflow = di.resolve<ResearchWorkflow>(WORKFLOW_TOKEN);
    workflowReady = Promise.resolve(false);
  } else {
    workflow = new ResearchWorkflow({ di });
    di.registerInstance(WORKFLOW_TOKEN, workflow, () => workflow.clear());
    if (opts.background) {
      workflowReady = workflow.loadFromDisk(corpusDir).catch(() => false);
    } else {
      try {
        restored = await workflow.loadFromDisk(corpusDir);
      } catch {
        restored = false;
      }
      workflowReady = Promise.resolve(restored);
    }
  }

  let liveSync: LiveSync;
  let syncReady: Promise<boolean>;

  if (di.has(LIVE_SYNC_TOKEN)) {
    liveSync = di.resolve<LiveSync>(LIVE_SYNC_TOKEN);
    syncReady = Promise.resolve(false);
  } else {
    const docsDir = `${corpusDir.replace(/\/$/, "")}/docs`;
    liveSync = new LiveSync(workflow, docsDir);
    di.registerInstance(LIVE_SYNC_TOKEN, liveSync, () => liveSync.stop());
    if (opts.background) {
      syncReady = liveSync
        .start()
        .then(() => true)
        .catch(() => false);
    } else {
      try {
        await liveSync.start();
      } catch {
        // missing corpus directory handled gracefully
      }
      syncReady = Promise.resolve(true);
    }
  }

  const ready: Promise<BootstrapBackgroundOutcome> | undefined = opts.background
    ? Promise.all([workflowReady, syncReady]).then(([r, s]) => ({
        restored: r,
        syncStarted: s,
      }))
    : undefined;

  let deviceManager: DeviceManager;
  if (di.has(DEVICE_MANAGER_TOKEN)) {
    deviceManager = di.resolve<DeviceManager>(DEVICE_MANAGER_TOKEN);
  } else {
    deviceManager = new DeviceManager(di);
    const mock = new MockDevice();
    await mock.connect();
    deviceManager.register(mock);
    di.registerInstance(DEVICE_MANAGER_TOKEN, deviceManager, () => {
      for (const id of deviceManager.registry.ids()) {
        void deviceManager
          .get(id)
          ?.disconnect()
          .catch(() => {});
      }
    });
  }

  const stop = (): void => {
    liveSync.stop();
  };

  return { workflow, liveSync, restored, corpusDir, di, deviceManager, stop, ready };
}

export async function createResearchSingleton(
  di: DIContainer = container,
  corpusDir = "corpus",
): Promise<ResearchWorkflow> {
  const { workflow } = await bootstrapApp({ di, corpusDir });
  return workflow;
}
