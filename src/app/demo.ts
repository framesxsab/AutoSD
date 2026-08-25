/**
 * Demo — deterministic, software-only showcase of the full AutoSD pipeline.
 *
 * Canonical path: ingest fixed corpus → search → citations → tactile output
 * (VirtualDevice framebuffer) → diagnostics → session export.
 *
 * Guarantees:
 * - Deterministic: seeded MockEmbeddingProvider + fixed corpus + fixed query.
 *   The canonical export JSON contains no timestamps, random ids, or
 *   environment-dependent values — two runs produce byte-identical exports.
 * - No hardware: renders through VirtualDevice only.
 * - No API key / no network / no backend: MockEmbeddingProvider never calls
 *   out; diagnostics are metadata-only.
 *
 * Additive: v0.8 flows are untouched. By default runDemo() builds its own
 * isolated workflow + device; passing `workflow`/`device` reuses caller
 * instances (determinism then depends on their state).
 */
import { ResearchWorkflow } from "../workflows/research.js";
import type { ResearchCitation, ResearchResult } from "../workflows/research.js";
import { MockEmbeddingProvider } from "../retrieval/providers/MockEmbeddingProvider.js";
import { VirtualDevice } from "../devices/VirtualDevice.js";
import { textToDots } from "../workflows/tactile.js";
import { collectDiagnostics, APP_VERSION } from "./diagnostics.js";
import type { Document } from "../retrieval/types.js";
import type { Device } from "../core/Device.js";

export const DEMO_ID = "autosd-demo";
export const DEMO_VERSION = 1;
export const DEMO_QUERY = "How do refreshable braille displays render braille dots?";

/** Fixed demo corpus — 4 documents, each small enough for a single chunk. */
export const DEMO_CORPUS: readonly Document[] = [
  {
    id: "braille-basics",
    path: "demo/braille-basics.md",
    content:
      "Braille is a tactile writing system used by blind and low-vision readers. " +
      "Each braille character, called a cell, is built from six dot positions arranged in a " +
      "two-column by three-row matrix. Combinations of raised dots encode letters, digits, " +
      "punctuation, and contractions. Grade 1 braille spells every word letter by letter, " +
      "while Grade 2 braille uses contractions to shorten common words and improve reading " +
      "speed. Learning braille starts with the alphabet cells, then moves to numbers and " +
      "punctuation marks. Consistent dot spacing and cell height are essential so fingers " +
      "can travel across a line of text without losing position.",
  },
  {
    id: "tactile-patterns",
    path: "demo/tactile-patterns.md",
    content:
      "Designing tactile patterns for refreshable surfaces requires mapping content to dot " +
      "cells that a device can raise and lower. A pattern is a sequence of cell values; each " +
      "value selects which of the six dots in a cell are active. Good patterns preserve " +
      "rhythm and spacing so the reader can parse word boundaries by touch. When rendering " +
      "text on a one-line display, designers chunk the message into pages and step through " +
      "them at a comfortable refresh rate. Haptic emphasis, such as briefly pulsing all " +
      "dots, can signal page changes or alerts without adding visual elements.",
  },
  {
    id: "refreshable-displays",
    path: "demo/refreshable-displays.md",
    content:
      "A refreshable braille display renders braille electronically. Rows of piezoelectric " +
      " actuators move pins up and down to form braille cells under the reader's fingertips. " +
      "The device receives a buffer of cell values from software, sets each pin accordingly, " +
      "and holds the pattern until the next refresh. Refresh rate, pin count, and cell " +
      "height determine how much text fits on the line and how quickly pages change. " +
      "Because the pins are mechanical, firmware limits how often the line can refresh to " +
      "keep the hardware reliable. Screen reader software drives the display by sending " +
      "the current focus context as braille cells.",
  },
  {
    id: "screen-readers",
    path: "demo/screen-readers.md",
    content:
      "Screen readers provide non-visual access to computers by speaking interface content " +
      "and driving braille displays. They rely on semantic structure: headings, landmarks, " +
      "lists, and live regions let users jump between sections and hear updates without " +
      "seeing the screen. Keyboard navigation mirrors this structure, moving focus in a " +
      "predictable order. For web content, accessible rich internet applications roles and " +
      "labels expose widgets to the reader. Well-structured documents therefore benefit " +
      "both speech output and refreshable braille, since both channels consume the same " +
      "accessibility tree.",
  },
];

export const DEMO_STEPS = [
  "ingest",
  "search",
  "citations",
  "tactile",
  "diagnostics",
  "export",
] as const;

export type DemoStepId = (typeof DEMO_STEPS)[number];
export type DemoStepStatus = "pending" | "running" | "done";

export type DemoProgressFn = (step: DemoStepId, status: DemoStepStatus, detail?: string) => void;

export type DemoFrame = {
  readonly label: string;
  readonly chunkId: string;
  /** Dot values rendered onto the device (length = dotCount). */
  readonly pattern: number[];
  /** Device framebuffer snapshot captured right after render. */
  readonly framebuffer: number[];
};

export type DemoDiagnostics = {
  readonly version: string;
  readonly provider: { id: string; model: string; dimensions: number };
  readonly device: {
    active: { id: string; kind: string; name: string; status: string } | null;
  };
  readonly corpus: { documentCount: number; chunkCount: number; version: string };
};

export type DemoResult = {
  readonly demoId: typeof DEMO_ID;
  readonly query: string;
  readonly corpusIds: string[];
  readonly answer: string;
  readonly confidence: number;
  readonly citations: ResearchCitation[];
  /** Live session id inside the workflow history (volatile — not part of exportJson). */
  readonly sessionId: string;
  /** Canonical, byte-identical-across-runs JSON export of the whole demo run. */
  readonly exportJson: string;
  readonly frames: DemoFrame[];
  readonly diagnostics: DemoDiagnostics;
};

export type RunDemoOptions = {
  /** Reuse an existing workflow instead of an isolated fresh one. */
  workflow?: ResearchWorkflow;
  /** Reuse an existing device instead of a fresh VirtualDevice. */
  device?: Device;
  /** Override the fixed demo query (changes determinism baseline). */
  query?: string;
  /** Progress sink for UI/CLI — receives ordered step transitions. */
  onProgress?: DemoProgressFn;
};

function makeFreshWorkflow(provider: MockEmbeddingProvider): ResearchWorkflow {
  return new ResearchWorkflow({ provider, topK: 5 });
}

/**
 * Build the canonical export object. Only stable, derived-from-fixed-inputs
 * fields are included: no Date.now/Math.random/env-dependent values.
 */
export function buildDemoExport(parts: {
  query: string;
  corpusIds: string[];
  answer: string;
  confidence: number;
  citations: ResearchCitation[];
  frames: DemoFrame[];
  diagnostics: DemoDiagnostics;
}): Record<string, unknown> {
  return {
    demo: DEMO_ID,
    demoVersion: DEMO_VERSION,
    appVersion: parts.diagnostics.version,
    query: parts.query,
    corpus: parts.corpusIds,
    answer: parts.answer,
    confidence: Math.round(parts.confidence * 1000) / 1000,
    citations: parts.citations.map(c => ({
      documentId: c.documentId,
      chunkId: c.chunkId,
      source: c.source,
      score: Math.round(c.score * 1e6) / 1e6,
      content: c.content,
    })),
    tactile: {
      device: parts.diagnostics.device.active
        ? {
            id: parts.diagnostics.device.active.id,
            kind: parts.diagnostics.device.active.kind,
            dotCount: parts.frames[0]?.pattern.length ?? 0,
          }
        : null,
      frames: parts.frames.map(f => ({ label: f.label, chunkId: f.chunkId, pattern: f.pattern })),
    },
    diagnostics: parts.diagnostics,
  };
}

/** Adapt a DemoResult into the ResearchResult shape consumed by CitationView. */
export function demoResearchResult(result: DemoResult): ResearchResult {
  return {
    queryId: `${DEMO_ID}-query`,
    answer: result.answer,
    citations: result.citations,
    confidence: result.confidence,
  };
}

/** Human-readable multi-line report (CLI + panel <pre>). Pure; no console use. */
export function formatDemoReport(result: DemoResult): string {
  const lines: string[] = [];
  lines.push(`AutoSD Demo (${DEMO_ID} v${DEMO_VERSION})`);
  lines.push(`Query: ${result.query}`);
  lines.push(
    `Corpus: ${result.corpusIds.length} documents · confidence ${Math.round(result.confidence * 100)}%`,
  );
  lines.push(`Answer: ${result.answer}`);
  lines.push("Citations:");
  result.citations.forEach((c, i) => {
    lines.push(
      `  ${i + 1}. ${c.documentId} · ${c.chunkId} · score ${Math.round(c.score * 100) / 100}`,
    );
  });
  lines.push("Tactile frames:");
  result.frames.forEach((f, i) => {
    const active = f.pattern.filter(v => v > 0).length;
    lines.push(`  ${i + 1}. ${f.label} · ${active}/${f.pattern.length} active dots`);
  });
  lines.push(
    `Diagnostics: provider ${result.diagnostics.provider.id} · device ${result.diagnostics.device.active?.name ?? "none"} · corpus ${result.diagnostics.corpus.chunkCount} chunks`,
  );
  return lines.join("\n");
}

/**
 * Run the canonical end-to-end demo.
 * Deterministic when left at defaults (fresh isolated instances).
 */
export async function runDemo(opts: RunDemoOptions = {}): Promise<DemoResult> {
  const progress: DemoProgressFn = opts.onProgress ?? (() => {});
  const provider = new MockEmbeddingProvider();
  const workflow = opts.workflow ?? makeFreshWorkflow(provider);
  const device = opts.device ?? new VirtualDevice();
  const query = opts.query ?? DEMO_QUERY;

  // 1. Ingest the fixed corpus (incremental; unchanged docs are skipped).
  progress("ingest", "running", `${DEMO_CORPUS.length} documents`);
  const ingestInfo = await workflow.ingest([...DEMO_CORPUS]);
  const corpusIds = DEMO_CORPUS.map(d => d.id);
  progress(
    "ingest",
    "done",
    `${corpusIds.length} documents · ${ingestInfo.chunkCount} chunks · index ${ingestInfo.manifestVersion}`,
  );

  // 2. Search — hybrid BM25 + vector retrieval via the mock provider.
  progress("search", "running", query);
  const result = await workflow.run({ id: `${DEMO_ID}-query`, question: query });
  progress("search", "done", `confidence ${Math.round(result.confidence * 100)}%`);

  // 3. Citations — grounded sources ranked by the pipeline.
  progress("citations", "running", `${result.citations.length} candidates`);
  if (result.citations.length === 0) throw new Error("Demo: retrieval returned no citations");
  progress("citations", "done", `${result.citations.length} citations`);

  // 4. Tactile output — render top citations onto the virtual framebuffer.
  progress("tactile", "running", device.info.name);
  if (device.info.status !== "connected") await device.connect();
  const dotCount = device.info.capabilities.dotCount ?? 40;
  const topCitations = result.citations.slice(0, 3);
  const frames: DemoFrame[] = [];
  for (const cit of topCitations) {
    const pattern = textToDots(cit.content, dotCount);
    await device.render(pattern);
    const snapshot = (await device.read()) ?? new Uint8Array(dotCount);
    frames.push({
      label: cit.documentId,
      chunkId: cit.chunkId,
      pattern: Array.from(pattern),
      framebuffer: Array.from(snapshot),
    });
  }
  progress("tactile", "done", `${frames.length} frames on ${device.info.name}`);

  // 5. Diagnostics — safe metadata-only snapshot (no secrets, no contents).
  progress("diagnostics", "running");
  const report = collectDiagnostics({ workflow, provider });
  const diagnostics: DemoDiagnostics = {
    version: APP_VERSION,
    provider: report.provider ?? {
      id: provider.id,
      model: provider.model,
      dimensions: provider.dimensions,
    },
    device: {
      active: {
        id: device.info.id,
        kind: device.info.kind,
        name: device.info.name,
        status: device.info.status,
      },
    },
    corpus: report.corpus,
  };
  progress("diagnostics", "done", `provider ${diagnostics.provider.id}`);

  // 6. Export — canonical deterministic session JSON.
  progress("export", "running");
  const sessions = workflow.listSessions();
  const sessionId = sessions[sessions.length - 1]?.id ?? "";
  const exportJson = JSON.stringify(
    buildDemoExport({
      query,
      corpusIds,
      answer: result.answer,
      confidence: result.confidence,
      citations: result.citations,
      frames,
      diagnostics,
    }),
    null,
    2,
  );
  progress("export", "done", `${exportJson.length} bytes`);

  return {
    demoId: DEMO_ID,
    query,
    corpusIds,
    answer: result.answer,
    confidence: result.confidence,
    citations: result.citations,
    sessionId,
    exportJson,
    frames,
    diagnostics,
  };
}
