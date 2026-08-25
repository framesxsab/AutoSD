import { container, DIContainer } from "../core/DIContainer.js";
import { ResearchWorkflow, EMBEDDING_TOKEN } from "../workflows/research.js";
import { MockEmbeddingProvider } from "../retrieval/providers/MockEmbeddingProvider.js";
import { LiveSync } from "./LiveSync.js";

export const WORKFLOW_TOKEN = "research:workflow";
export const LIVE_SYNC_TOKEN = "liveSync";

export type BootstrapOptions = {
  corpusDir?: string;
  di?: DIContainer;
};

export type BootstrapResult = {
  workflow: ResearchWorkflow;
  liveSync: LiveSync;
  restored: boolean;
  corpusDir: string;
  di: DIContainer;
  stop: () => void;
};

export async function bootstrapApp(opts: BootstrapOptions = {}): Promise<BootstrapResult> {
  const di = opts.di ?? container;
  const corpusDir = opts.corpusDir ?? "corpus";

  if (!di.has(EMBEDDING_TOKEN)) {
    di.register(EMBEDDING_TOKEN, () => new MockEmbeddingProvider());
  }

  let workflow: ResearchWorkflow;
  let restored = false;

  if (di.has(WORKFLOW_TOKEN)) {
    workflow = di.resolve<ResearchWorkflow>(WORKFLOW_TOKEN);
  } else {
    workflow = new ResearchWorkflow({ di });
    di.registerInstance(WORKFLOW_TOKEN, workflow, () => workflow.clear());
    try {
      restored = await workflow.loadFromDisk(corpusDir);
    } catch {
      restored = false;
    }
  }

  let liveSync: LiveSync;
  if (di.has(LIVE_SYNC_TOKEN)) {
    liveSync = di.resolve<LiveSync>(LIVE_SYNC_TOKEN);
  } else {
    const docsDir = `${corpusDir.replace(/\/$/, "")}/docs`;
    liveSync = new LiveSync(workflow, docsDir);
    di.registerInstance(LIVE_SYNC_TOKEN, liveSync, () => liveSync.stop());
    try {
      await liveSync.start();
    } catch {
      // missing corpus directory handled gracefully
    }
  }

  const stop = (): void => {
    liveSync.stop();
  };

  return { workflow, liveSync, restored, corpusDir, di, stop };
}

export async function createResearchSingleton(
  di: DIContainer = container,
  corpusDir = "corpus",
): Promise<ResearchWorkflow> {
  const { workflow } = await bootstrapApp({ di, corpusDir });
  return workflow;
}
