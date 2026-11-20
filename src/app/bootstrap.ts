import { container, DIContainer } from "../core/DIContainer.js";
import { ResearchWorkflow, EMBEDDING_TOKEN } from "../workflows/research.js";
import { MockEmbeddingProvider } from "../retrieval/providers/MockEmbeddingProvider.js";
import { LexicalHashEmbeddingProvider } from "../retrieval/providers/LexicalHashEmbeddingProvider.js";
import { LocalEmbeddingProvider } from "../retrieval/providers/LocalEmbeddingProvider.js";
import { OpenAIEmbeddingProvider } from "../retrieval/providers/OpenAIEmbeddingProvider.js";
import { LiveSync } from "./LiveSync.js";
import { DeviceManager } from "../core/DeviceManager.js";
import { MockDevice } from "../devices/MockDevice.js";
import { PluginHost } from "../plugins/PluginHost.js";
import { createCatalogPlugins, DEFAULT_ENABLED_PLUGINS } from "../workflows/marketplace.js";
import { getConfig } from "./config.js";
import { logger } from "./logger.js";
import {
  loadPreferences,
  loadWorkspaceState,
  saveWorkspaceState,
  type EmbeddingProviderPreference,
} from "./BrowserStore.js";

export const WORKFLOW_TOKEN = "research:workflow";
export const LIVE_SYNC_TOKEN = "liveSync";
export const DEVICE_MANAGER_TOKEN = "devices:manager";
export const PLUGIN_HOST_TOKEN = "plugins:host";

export type BootstrapOptions = {
  corpusDir?: string;
  di?: DIContainer;
  /**
   * v0.9 perf: resolve bootstrapApp without awaiting corpus load / live sync
   * start; they run detached and settle into `ready`. Default (false) keeps
   * the fully-awaited v0.8 semantics.
   */
  background?: boolean;
  /**
   * v1.2 interactive browser mode: defaults to LexicalHashEmbeddingProvider +
   * LexicalReranker (unless overridden by saved UserPreferences or env) and
   * restores/persists workspace state via BrowserStore when disk FS is absent.
   */
  interactiveDefaults?: boolean;
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
  pluginHost: PluginHost;
  stop: () => void;
  /** Present only with opts.background — never rejects. */
  ready?: Promise<BootstrapBackgroundOutcome>;
};

export function createDefaultPluginHost(appVersion = getConfig().version): PluginHost {
  const host = new PluginHost(appVersion);
  for (const plugin of createCatalogPlugins()) {
    host.registry.register(plugin);
  }
  return host;
}

export function isOpenAIProviderConfigured(): boolean {
  return getConfig().openaiMode !== "none";
}

export function createProviderById(id: EmbeddingProviderPreference) {
  if (id === "lexical") return new LexicalHashEmbeddingProvider();
  if (id === "local") return new LocalEmbeddingProvider();
  if (id === "openai") {
    const config = getConfig();
    if (config.openaiMode === "browser-endpoint") {
      return new OpenAIEmbeddingProvider(config.openaiModel, 1536, "", config.openaiBaseUrl, true);
    }
    if (config.openaiMode === "server-side") {
      return new OpenAIEmbeddingProvider(config.openaiModel, 1536, undefined, config.openaiBaseUrl);
    }
    logger.warn(
      "embeddingProvider=openai requested but no safe endpoint or server-side OPENAI_API_KEY — using mock",
    );
  }
  return new MockEmbeddingProvider();
}

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
  if (config.embeddingProvider === "lexical") {
    return new LexicalHashEmbeddingProvider();
  }
  if (config.embeddingProvider === "local") {
    return new LocalEmbeddingProvider();
  }
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
  const prefs = opts.interactiveDefaults ? loadPreferences() : {};

  if (!di.has(EMBEDDING_TOKEN)) {
    if (opts.interactiveDefaults) {
      di.register(EMBEDDING_TOKEN, () => {
        if (prefs.embeddingProvider) return createProviderById(prefs.embeddingProvider);
        const configured = getConfig().embeddingProvider;
        return configured !== "mock"
          ? resolveEmbeddingProvider()
          : new LexicalHashEmbeddingProvider();
      });
    } else {
      di.register(EMBEDDING_TOKEN, () => resolveEmbeddingProvider());
    }
  }

  let workflow: ResearchWorkflow;
  let restored = false;
  let workflowReady: Promise<boolean>;

  const restoreState = async (): Promise<boolean> => {
    const diskOk = await workflow.loadFromDisk(corpusDir).catch(() => false);
    if (diskOk) return true;
    if (!opts.interactiveDefaults) return false;
    const browserSaved = await loadWorkspaceState().catch(() => null);
    if (!browserSaved) return false;
    await workflow.fromPersistedState(browserSaved.workflowState);
    return true;
  };

  if (di.has(WORKFLOW_TOKEN)) {
    workflow = di.resolve<ResearchWorkflow>(WORKFLOW_TOKEN);
    workflowReady = Promise.resolve(false);
  } else {
    workflow = opts.interactiveDefaults
      ? new ResearchWorkflow({
          di,
          mode: prefs.retrievalMode ?? "hybrid",
          reranker: prefs.rerankerEnabled ?? true,
        })
      : new ResearchWorkflow({ di });
    di.registerInstance(WORKFLOW_TOKEN, workflow, () => workflow.clear());
    if (opts.background) {
      workflowReady = restoreState().catch(() => false);
    } else {
      try {
        restored = await restoreState();
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
    ? Promise.all([workflowReady, syncReady]).then(async ([r, s]) => {
        if (r && opts.interactiveDefaults) {
          await liveSync.runManualSync(() => saveWorkspaceState(workflow.toPersistedState()));
        }
        return { restored: r, syncStarted: s };
      })
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

  let pluginHost: PluginHost;
  if (di.has(PLUGIN_HOST_TOKEN)) {
    pluginHost = di.resolve<PluginHost>(PLUGIN_HOST_TOKEN);
  } else {
    pluginHost = createDefaultPluginHost(getConfig().version);
    const enabledPlugins = prefs.installedPlugins ?? [...DEFAULT_ENABLED_PLUGINS];
    for (const id of enabledPlugins) {
      if (!pluginHost.registry.get(id)) {
        logger.warn(`Ignoring unknown saved plugin "${id}"`);
        continue;
      }
      try {
        await pluginHost.registry.activate(id);
      } catch (err) {
        logger.warn(`Failed to activate plugin "${id}"`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    di.registerInstance(PLUGIN_HOST_TOKEN, pluginHost, () => {
      for (const entry of pluginHost.registry.list()) {
        if (entry.state === "active") {
          void pluginHost.registry.deactivate(entry.plugin.id).catch(() => {});
        }
      }
    });
  }

  const stop = (): void => {
    liveSync.stop();
  };

  return { workflow, liveSync, restored, corpusDir, di, deviceManager, pluginHost, stop, ready };
}

export async function createResearchSingleton(
  di: DIContainer = container,
  corpusDir = "corpus",
): Promise<ResearchWorkflow> {
  const { workflow } = await bootstrapApp({ di, corpusDir });
  return workflow;
}
