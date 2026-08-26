/**
 * health.ts — health/readiness reporting.
 *
 * Returns a secret-free snapshot of application state suitable for
 * readiness probes, support diagnostics and the /health endpoint pattern.
 * Never includes: API keys, file contents, absolute paths, stack traces.
 */

import { getConfig } from "./config.js";
import type { ResearchWorkflow } from "../workflows/research.js";
import type { LiveSync, SyncStatus } from "./LiveSync.js";

export type HealthStatus = "ok" | "degraded";

export type HealthReport = {
  status: HealthStatus;
  version: string;
  environment: string;
  build: {
    mode: string;
    /** ISO timestamp of when this process/report started. */
    startedAt: string;
  };
  corpus: {
    documents: number;
    chunks: number;
    manifestVersion: string;
    /** Directory NAME only (never an absolute path). */
    dir: string;
  };
  watcher: {
    running: boolean;
    status: SyncStatus;
  };
  device: {
    id: string;
    kind: string;
  } | null;
  embedding: {
    /** Provider id only — never key material or full endpoint URLs. */
    provider: string;
    configured: boolean;
  };
  uptimeMs: number;
};

export type HealthDeps = {
  workflow?: ResearchWorkflow;
  liveSync?: LiveSync;
  device?: { id: string; kind: string } | null;
};

const startedAt = new Date().toISOString();
const startMs = Date.now();

/** Build a readiness report from optional live dependencies. Never throws. */
export function getHealth(deps: HealthDeps = {}): HealthReport {
  const config = getConfig();

  let documents = 0;
  let chunks = 0;
  let manifestVersion = "0.0.0";
  try {
    if (deps.workflow) {
      documents = deps.workflow.listDocuments().length;
      chunks = deps.workflow.getManifest()?.chunkCount ?? 0;
      manifestVersion = deps.workflow.getManifest()?.version ?? deps.workflow.getSnapshotHash();
    }
  } catch {
    /* degraded — keep defaults */
  }

  let watcherRunning = false;
  let watcherStatus: SyncStatus = "Idle";
  try {
    if (deps.liveSync) {
      watcherRunning = deps.liveSync.isRunning();
      watcherStatus = deps.liveSync.getStatus();
    }
  } catch {
    /* degraded */
  }

  const providerId =
    config.embeddingProvider === "openai"
      ? config.openaiMode !== "none"
        ? "openai"
        : "mock (fallback: no safe endpoint or server key)"
      : config.embeddingProvider;

  // Degraded when a workflow exists but the corpus failed to index anything,
  // or when the watcher was expected but is not running.
  const degraded =
    (deps.workflow !== undefined && documents === 0) ||
    (deps.liveSync !== undefined && !watcherRunning);

  return Object.freeze({
    status: degraded ? "degraded" : "ok",
    version: config.version,
    environment: config.environment,
    build: { mode: config.environment, startedAt },
    corpus: {
      documents,
      chunks,
      manifestVersion,
      dir: sanitizeDirName(config.corpusDir),
    },
    watcher: { running: watcherRunning, status: watcherStatus },
    device: deps.device ? { id: String(deps.device.id), kind: String(deps.device.kind) } : null,
    embedding: { provider: providerId, configured: providerId.startsWith("openai") },
    uptimeMs: Date.now() - startMs,
  });
}

/** Keep only the final path segment; strip anything that looks like a filesystem path. */
function sanitizeDirName(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(p => p.length > 0 && p !== "." && p !== "..");
  return parts[parts.length - 1] ?? "corpus";
}
