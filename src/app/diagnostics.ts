/**
 * Diagnostics — safe, metadata-only observability surface for AutoSD v0.9.
 * Collects version/build/provider/device/corpus/watcher/indexing/service info.
 *
 * Guarantees:
 * - Never includes API keys, tokens, secrets, file contents, or stack traces.
 * - Output is plain JSON-serializable data (safe to paste into GitHub issues).
 */
import packageJson from "../../package.json";
import type { ResearchWorkflow } from "../workflows/research.js";
import type { EmbeddingProvider } from "../retrieval/embedder.js";
import { OpenAIEmbeddingProvider } from "../retrieval/providers/OpenAIEmbeddingProvider.js";
import type { DeviceManager } from "../core/DeviceManager.js";
import type { DeviceInfo } from "../core/Device.js";
import type { LiveSync, SyncStatus } from "./LiveSync.js";

export const APP_VERSION: string = packageJson.version;

/** Build stamp — injectable at build time via `__AUTOSD_BUILD__` (vite define). Falls back to "dev". */
export function getBuildVersion(): string {
  const injected = (globalThis as unknown as { __AUTOSD_BUILD__?: unknown }).__AUTOSD_BUILD__;
  return typeof injected === "string" && injected.length > 0 ? injected : "dev";
}

export type ProviderDiagnostics = {
  id: string;
  model: string;
  dimensions: number;
};

export type DeviceDiagnostics = {
  active: Pick<DeviceInfo, "id" | "kind" | "name" | "status"> | null;
};

export type CorpusDiagnostics = {
  documentCount: number;
  chunkCount: number;
  version: string;
};

export type WatcherDiagnostics = {
  isRunning: boolean;
  status: SyncStatus;
};

export type IndexingDiagnostics = {
  pending: boolean;
};

export type ServiceDiagnostics = {
  hidAvailable: boolean;
  openAIConfigured: boolean;
};

export type EnvironmentDiagnostics = {
  platform: string;
  userAgent: string | null;
};

export type DiagnosticsReport = {
  version: string;
  build: string;
  provider: ProviderDiagnostics | null;
  device: DeviceDiagnostics;
  corpus: CorpusDiagnostics;
  watcher: WatcherDiagnostics;
  indexing: IndexingDiagnostics;
  services: ServiceDiagnostics;
  environment: EnvironmentDiagnostics;
  generatedAt: string;
};

export type DiagnosticsInput = {
  workflow?: ResearchWorkflow | null;
  liveSync?: LiveSync | null;
  deviceManager?: DeviceManager | null;
  provider?: EmbeddingProvider | null;
};

const SENSITIVE_KEY_PATTERN =
  /(api[-_]?key|apikey|token|secret|password|passwd|authorization|credential|bearer|cookie|session[-_]?id)/i;

function readEnv(name: string): string | undefined {
  const proc = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process;
  try {
    return proc?.env?.[name];
  } catch {
    return undefined;
  }
}

/** WebHID (browser) or any registered HID-kind device counts as "available". */
function isHidAvailable(deviceManager?: DeviceManager | null): boolean {
  try {
    const nav = (globalThis as unknown as { navigator?: { hid?: unknown } }).navigator;
    if (nav?.hid) return true;
  } catch {}
  if (deviceManager) {
    try {
      return deviceManager.list().some(d => d.kind === "hid");
    } catch {}
  }
  return false;
}

function isOpenAIConfigured(provider?: EmbeddingProvider | null): boolean {
  if (provider instanceof OpenAIEmbeddingProvider) {
    try {
      return provider.isConfigured();
    } catch {
      return false;
    }
  }
  // Boolean only — never reads or reports the key value.
  return (readEnv("OPENAI_API_KEY") ?? "").length > 0;
}

function collectProvider(provider?: EmbeddingProvider | null): ProviderDiagnostics | null {
  if (!provider) return null;
  return {
    id: String(provider.id ?? "unknown"),
    model: String(provider.model ?? "unknown"),
    dimensions: Number(provider.dimensions ?? 0),
  };
}

function collectActiveDevice(deviceManager?: DeviceManager | null): DeviceDiagnostics {
  let active: DeviceDiagnostics["active"] = null;
  if (deviceManager) {
    try {
      const info = deviceManager.getActive()?.info;
      if (info) {
        active = { id: info.id, kind: info.kind, name: info.name, status: info.status };
      }
    } catch {}
  }
  return { active };
}

function collectCorpus(workflow?: ResearchWorkflow | null): CorpusDiagnostics {
  if (!workflow) return { documentCount: 0, chunkCount: 0, version: "0.0.0" };
  let documentCount = 0;
  let chunkCount = 0;
  let version = "0.0.0";
  try {
    documentCount = workflow.listDocuments().length;
    const manifest = workflow.getManifest();
    chunkCount = manifest?.chunkCount ?? 0;
    version = manifest?.version ?? "0.0.0";
  } catch {}
  return { documentCount, chunkCount, version };
}

function collectWatcher(liveSync?: LiveSync | null): WatcherDiagnostics {
  if (!liveSync) return { isRunning: false, status: "Idle" };
  let isRunning = false;
  let status: SyncStatus = "Idle";
  try {
    isRunning = liveSync.isRunning();
    status = liveSync.getStatus();
  } catch {}
  return { isRunning, status };
}

function collectIndexing(liveSync?: LiveSync | null): IndexingDiagnostics {
  if (!liveSync) return { pending: false };
  try {
    return { pending: liveSync.isPending() || liveSync.getStatus() === "Indexing" };
  } catch {
    return { pending: false };
  }
}

function collectEnvironment(): EnvironmentDiagnostics {
  let platform = "unknown";
  let userAgent: string | null = null;
  try {
    const proc = (globalThis as unknown as { process?: { platform?: string } }).process;
    platform = proc?.platform ?? "browser";
  } catch {}
  try {
    const nav = (globalThis as unknown as { navigator?: { userAgent?: string } }).navigator;
    userAgent = nav?.userAgent ?? null;
  } catch {}
  return { platform, userAgent };
}

/**
 * Deep-sanitize arbitrary data before serialization:
 * drops keys that look sensitive, replaces functions, never throws.
 */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value;
  if (t === "function" || t === "symbol" || t === "bigint") return `[${t}]`;
  if (depth > 8) return "[truncated]";
  if (Array.isArray(value)) return value.map(v => sanitize(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message }; // no stack
  if (t === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** Collect a safe diagnostics snapshot. All inputs optional; never throws. */
export function collectDiagnostics(input: DiagnosticsInput = {}): DiagnosticsReport {
  return sanitize({
    version: APP_VERSION,
    build: getBuildVersion(),
    provider: collectProvider(input.provider),
    device: collectActiveDevice(input.deviceManager),
    corpus: collectCorpus(input.workflow),
    watcher: collectWatcher(input.liveSync),
    indexing: collectIndexing(input.liveSync),
    services: {
      hidAvailable: isHidAvailable(input.deviceManager),
      openAIConfigured: isOpenAIConfigured(input.provider),
    },
    environment: collectEnvironment(),
    generatedAt: new Date().toISOString(),
  }) as DiagnosticsReport;
}

/** Format the copyable report for GitHub issues (pretty JSON, sanitized). */
export function formatDiagnosticsReport(report: DiagnosticsReport): string {
  return JSON.stringify(sanitize(report), null, 2);
}
