/**
 * Independent evaluation engine — deterministic, software-only task runner
 * backing `npm run evaluate`. Designed so external evaluators can produce a
 * reproducible, machine-readable evidence package without maintainer help.
 *
 * Guarantees:
 * - No timestamps or random values in the default report (timing fields are
 *   marked observed/nondeterministic; `--stamp` opts into a timestamp).
 * - Synthetic fixtures only: the bundled corpus never touches user documents.
 * - Metadata only: results carry counts, versions, and statuses — never file
 *   contents, absolute paths, or environment variables beyond an allowlist.
 * - Evidence honesty: validateEvaluation rejects any entry claiming
 *   HARDWARE-* or USER-VALIDATED status without supporting evidence text,
 *   so the schema cannot imply validation that did not happen.
 *
 * This module is SSR/Node-facing (the CLI loads it through Vite SSR); it is
 * intentionally NOT exported from the public barrel.
 */
import { ResearchWorkflow } from "../workflows/research.js";
import { MockEmbeddingProvider } from "../retrieval/providers/MockEmbeddingProvider.js";
import { ReaderWorkflow } from "../workflows/reader.js";
import { VirtualDevice } from "../devices/VirtualDevice.js";
import { textToDots } from "../workflows/tactile.js";
import { SnapshotIndex } from "../retrieval/snapshot.js";
import { collectDiagnostics, sanitize, APP_VERSION, getBuildVersion } from "./diagnostics.js";
import type { Document } from "../retrieval/types.js";
import { platform as osPlatform, release as osRelease, tmpdir as osTmpdir } from "node:os";

export { APP_VERSION };

export const EVALUATION_SCHEMA_VERSION = 1;
export const EVALUATION_SCHEMA_ID = "autosd-evaluation";
export const TASK_SET_VERSION = 2;

/** CI artifact allowlist — only these files may be uploaded (C4.2 contract). */
export const ARTIFACT_ALLOWLIST = ["evaluation.json", "evaluation.md", "environment.json"] as const;

/** Provenance for external report ingestion (C4.6). Maintainer CI must never be inferred. */
export const PROVENANCE_VALUES = ["external-self-reported", "maintainer-ci"] as const;
export type Provenance = (typeof PROVENANCE_VALUES)[number];

/** Evidence classes — C3.8 boundary vocabulary, shared with docs/EVALUATION_SCHEMA.md. */
export const VALIDATION_LEVELS = [
  "SOFTWARE-VERIFIED",
  "SOFTWARE-SCAFFOLDED",
  "HARDWARE-CONNECTED",
  "HARDWARE-VALIDATED",
  "USER-VALIDATED",
] as const;
export type ValidationLevel = (typeof VALIDATION_LEVELS)[number];

/** Top-level kinds of an evaluation record. */
export const EVALUATION_KINDS = [
  "AUTOMATED",
  "MANUAL",
  "USER-VALIDATED",
  "HARDWARE-VALIDATED",
] as const;
export type EvaluationKind = (typeof EVALUATION_KINDS)[number];

export const HARDWARE_STATUSES = [
  "NONE",
  "NOT-TESTED",
  "CONNECTED-UNVERIFIED",
  "HARDWARE-VALIDATED",
] as const;
export type HardwareStatus = (typeof HARDWARE_STATUSES)[number];

export type TaskId =
  | "T01-STARTUP"
  | "T02-INGEST"
  | "T03-RETRIEVAL"
  | "T04-CITATIONS"
  | "T05-READER"
  | "T06-SESSION-PERSIST"
  | "T07-EXPORT"
  | "T08-TACTILE-VIRTUAL"
  | "T09-DIAGNOSTICS"
  | "T10-RECOVERY"
  | "T11-RETRIEVAL-HARDNESS";

export const TASK_IDS: readonly TaskId[] = [
  "T01-STARTUP",
  "T02-INGEST",
  "T03-RETRIEVAL",
  "T04-CITATIONS",
  "T05-READER",
  "T06-SESSION-PERSIST",
  "T07-EXPORT",
  "T08-TACTILE-VIRTUAL",
  "T09-DIAGNOSTICS",
  "T10-RECOVERY",
  "T11-RETRIEVAL-HARDNESS",
];

export type TaskStatus = "pass" | "fail" | "skipped";

export type TaskResult = {
  readonly id: TaskId;
  readonly status: TaskStatus;
  readonly detail: string;
  readonly durationMs: number;
  readonly evidence?: Record<string, string | number | boolean | null>;
};

export type EvaluationEnvironment = {
  readonly osPlatform: string;
  readonly osRelease: string;
  readonly arch: string;
  readonly nodeVersion: string;
  readonly npmVersion: string | null;
};

export type EvaluationReportV1 = {
  readonly schema: typeof EVALUATION_SCHEMA_ID;
  readonly schemaVersion: number;
  readonly taskSetVersion: number;
  readonly evaluationKind: EvaluationKind;
  readonly appVersion: string;
  readonly build: string;
  readonly environment: EvaluationEnvironment;
  readonly hardwareStatus: HardwareStatus;
  readonly generatedAt?: string;
  readonly timingPolicy: "observed-nondeterministic";
  readonly provenance?: Provenance;
  readonly notes: readonly string[];
  readonly tasks: readonly (TaskResult & { readonly validationLevel: ValidationLevel })[];
  readonly privacyScan: { readonly status: "pass" | "fail"; readonly matches: readonly string[] };
  readonly summary: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
    readonly allPassed: boolean;
  };
};

/** Synthetic fixture corpus — written for this evaluator, distinct from the demo corpus. */
export const SYNTHETIC_CORPUS: readonly Document[] = [
  {
    id: "eval-indexing",
    path: "evaluation/eval-indexing.md",
    content:
      "AutoSD indexes local documents by splitting them into chunks and computing vector embeddings. " +
      "A hash-diffed snapshot keeps an index manifest, so unchanged documents are never re-embedded " +
      "and incremental ingestion stays fast.",
  },
  {
    id: "eval-citations",
    path: "evaluation/eval-citations.md",
    content:
      "Every AutoSD answer carries citations that point back to the source chunks. Each citation lists " +
      "a document id, chunk id, score, and a short content excerpt so readers can verify claims " +
      "against the original material.",
  },
  {
    id: "eval-devices",
    path: "evaluation/eval-devices.md",
    content:
      "AutoSD renders tactile patterns onto devices through one Device contract. A virtual framebuffer " +
      "device simulates dot cells for testing, while a mock device offers a deterministic fixture for " +
      "unit tests without any hardware.",
  },
];

export const EVALUATION_QUERY = "How are documents indexed and cited?";

/** Deterministic hardness fixtures — synthetic, never real user data. */
export const HARDNESS_FIXTURES = {
  correct: {
    id: "hard-correct",
    path: "hard/correct.md",
    content:
      "refreshable braille display rendering uses piezoelectric pins. The refreshable braille display rendering is fast and reliable for refreshable braille display rendering.",
  },
  typo: {
    id: "hard-typo",
    path: "hard/typo.md",
    content:
      "refresable braile display rendring uses piezo pins. The refresable braile display rendring is noted for refresable braile display rendring.",
  },
  distractor: {
    id: "hard-distractor",
    path: "hard/distractor.md",
    content:
      "tactile paper discusses display textures and paper grain. No refreshable mechanism is described here.",
  },
  overlap: {
    id: "hard-overlap",
    path: "hard/overlap.md",
    content:
      "braille display overview: generic braille display without refreshable mechanism, mentions display and braille but not rendering.",
  },
  contradictA: {
    id: "hard-contradict-a",
    path: "hard/contradict-a.md",
    content: "pins are piezoelectric actuators that move quickly for braille cells.",
  },
  contradictB: {
    id: "hard-contradict-b",
    path: "hard/contradict-b.md",
    content: "pins are electromagnetic actuators that move slowly for braille cells.",
  },
  renamedV1: {
    id: "hard-renamed",
    path: "hard/renamed-v1.md",
    content: "section renamed: indexing uses chunking and embeddings for retrieval.",
  },
  renamedV2: {
    id: "hard-renamed",
    path: "hard/renamed-v2.md",
    content: "section renamed: indexing uses chunking and embeddings for retrieval plus reranking.",
  },
} as const;

export const HARDNESS_QUERY = "refreshable braille display rendering";
export const HARDNESS_OVERLAP_QUERY = "braille display";
export const HARDNESS_CONTRADICT_QUERY = "what moves pins";

export type StartupProbe = () => Promise<{ ok: boolean; detail: string }>;

/**
 * T06 note for embedders: the internal persistence implementation relies on
 * node:fs, which Vite's browser aliases (and therefore its SSR transform)
 * replace with an empty shim. Hosts loading this module through Vite SSR
 * MUST supply persistenceProbe (the CLI runs it as a real-Node vitest
 * round-trip); plain Node/vitest contexts may rely on the default.
 */
export type RunEvaluationOptions = {
  /** Probe for T01 (wired to the e2e smoke test by the CLI). Omit to skip T01. */
  readonly startupProbe?: StartupProbe;
  /** Probe for T06 (real-Node disk round-trip). Omit to use the internal implementation. */
  readonly persistenceProbe?: StartupProbe;
  /** Self-test hook: force these task ids to fail (controlled-failure drill). */
  readonly forceFailTaskIds?: readonly string[];
  /** Environment snapshot; defaults are derived from the running process. */
  readonly environment?: Partial<EvaluationEnvironment>;
  /** Hardware field; automated runs default to NOT-TESTED. */
  readonly hardwareStatus?: HardwareStatus;
  /** Include an ISO timestamp (off by default for byte-stable comparisons). */
  readonly stamp?: boolean;
  readonly provenance?: Provenance;
};

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function nowMs(): number {
  return Date.now();
}

/**
 * Run the canonical ten-task software evaluation. Tasks share one workflow so
 * the persistence/export chain exercises real accumulated state.
 */
export async function runSoftwareEvaluation(opts: RunEvaluationOptions = {}): Promise<{
  report: EvaluationReportV1;
  workflow: ResearchWorkflow;
}> {
  const forced = opts.forceFailTaskIds ?? [];
  const tasks: TaskResult[] = [];
  const push = (
    id: TaskId,
    start: number,
    fn: () => Promise<Omit<TaskResult, "id" | "durationMs">>,
  ): Promise<void> =>
    fn()
      .then(r => {
        if (forced.includes(id)) {
          tasks.push({
            ...r,
            id,
            status: "fail",
            detail: `${r.detail} [forced failure: selftest]`,
            durationMs: nowMs() - start,
          });
        } else {
          tasks.push({ ...r, id, durationMs: nowMs() - start });
        }
      })
      .catch(err => {
        tasks.push({
          id,
          status: "fail",
          detail: `threw: ${err instanceof Error ? err.message : String(err)}`,
          durationMs: nowMs() - start,
        });
      });

  // T01 — application startup (e2e smoke suite mounts the real app).
  let t0 = nowMs();
  await push("T01-STARTUP", t0, async () => {
    if (!opts.startupProbe) {
      return { status: "skipped", detail: "startup probe not configured for this context" };
    }
    const r = await opts.startupProbe();
    return { status: r.ok ? "pass" : "fail", detail: r.detail };
  });

  const provider = new MockEmbeddingProvider();
  const workflow = new ResearchWorkflow({ provider, topK: 5 });

  // T02 — ingestion over the synthetic corpus.
  t0 = nowMs();
  await push("T02-INGEST", t0, async () => {
    const info = await workflow.ingest([...SYNTHETIC_CORPUS]);
    const pass =
      info.added === SYNTHETIC_CORPUS.length && info.chunkCount >= SYNTHETIC_CORPUS.length;
    return {
      status: pass ? "pass" : "fail",
      detail: pass
        ? `indexed ${info.added} docs · ${info.chunkCount} chunks · manifest ${info.manifestVersion}`
        : `unexpected ingest result: added=${info.added} chunks=${info.chunkCount}`,
      evidence: { added: info.added, chunkCount: info.chunkCount },
    };
  });

  // T03 — hybrid retrieval answers the evaluation query.
  let result: Awaited<ReturnType<ResearchWorkflow["run"]>> | null = null;
  t0 = nowMs();
  await push("T03-RETRIEVAL", t0, async () => {
    result = await workflow.run({ id: "eval-query-1", question: EVALUATION_QUERY });
    const pass = result.citations.length > 0 && result.confidence >= 0.15;
    return {
      status: pass ? "pass" : "fail",
      detail: pass
        ? `${result.citations.length} citations · confidence ${Math.round(result.confidence * 100)}%`
        : "no citations returned",
      evidence: {
        citationCount: result.citations.length,
        confidence: Math.round(result.confidence * 1000) / 1000,
      },
    };
  });

  // T04 — citation shape and ordering.
  t0 = nowMs();
  await push("T04-CITATIONS", t0, async () => {
    const cits = result?.citations ?? [];
    const wellFormed = cits.every(
      c =>
        typeof c.documentId === "string" &&
        typeof c.chunkId === "string" &&
        typeof c.score === "number" &&
        Number.isFinite(c.score),
    );
    const sorted = cits.every((c, i) => i === 0 || cits[i - 1].score >= c.score);
    const pass = cits.length > 0 && wellFormed && sorted;
    return {
      status: pass ? "pass" : "fail",
      detail: pass
        ? `${cits.length} citations well-formed and score-descending`
        : `citations malformed or unsorted (n=${cits.length}, sorted=${sorted})`,
      evidence: { count: cits.length },
    };
  });

  // T05 — reader pagination over a synthetic document.
  t0 = nowMs();
  await push("T05-READER", t0, async () => {
    const doc = SYNTHETIC_CORPUS[0];
    const pages = new ReaderWorkflow().paginate(
      { id: doc.id, title: "Evaluation Indexing Notes", content: doc.content },
      120,
    );
    const labelsOk = pages.every(
      (p, i) => p.ariaLabel.includes(String(i + 1)) && p.docId === doc.id,
    );
    const live = new ReaderWorkflow().toLiveRegion(pages[0]);
    const pass = pages.length > 0 && labelsOk && live.endsWith("…");
    return {
      status: pass ? "pass" : "fail",
      detail: pass
        ? `${pages.length} pages · aria labels sequential · live region truncated`
        : `pagination invalid (${pages.length} pages, labelsOk=${labelsOk})`,
      evidence: { pageCount: pages.length },
    };
  });

  // T06 — session persistence round-trip (probe runs in real Node; see options note).
  let tmpDir: string | null = null;
  t0 = nowMs();
  await push("T06-SESSION-PERSIST", t0, async () => {
    if (opts.persistenceProbe) {
      const r = await opts.persistenceProbe();
      return { status: r.ok ? "pass" : "fail", detail: r.detail };
    }
    const fs = await import("node:fs/promises");
    tmpDir = await fs.mkdtemp(`${osTmpdir()}/autosd-eval-`);
    await workflow.saveToDisk(tmpDir);
    const restored = new ResearchWorkflow({ provider });
    const ok = await restored.loadFromDisk(tmpDir);
    const sessions = restored.listSessions();
    const pass =
      ok && sessions.length > 0 && sessions[sessions.length - 1].query.id === "eval-query-1";
    return {
      status: pass ? "pass" : "fail",
      detail: pass
        ? `saved + loaded index/sessions · ${sessions.length} session(s) survived`
        : `round-trip failed (ok=${ok}, sessions=${sessions.length})`,
      evidence: {
        sessionCount: sessions.length,
        manifestVersion: restored.getManifest()?.version ?? "unknown",
      },
    };
  }).finally(async () => {
    if (tmpDir) {
      try {
        const fs = await import("node:fs/promises");
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // T07 — canonical JSON export of the last session.
  t0 = nowMs();
  await push("T07-EXPORT", t0, async () => {
    const json = workflow.exportLastSession();
    const parsed = JSON.parse(json) as { query?: unknown; results?: unknown };
    const pass =
      typeof parsed === "object" &&
      parsed !== null &&
      "query" in parsed &&
      "results" in parsed &&
      json.length > 0;
    return {
      status: pass ? "pass" : "fail",
      detail: pass
        ? `session export valid JSON · ${json.length} bytes`
        : "export missing query/results",
      evidence: { bytes: json.length },
    };
  });

  // T08 — VirtualDevice tactile pipeline round-trip.
  t0 = nowMs();
  await push("T08-TACTILE-VIRTUAL", t0, async () => {
    const device = new VirtualDevice("eval-virtual", "EvalVirtualDevice", 40);
    await device.connect();
    const pattern = textToDots("autosd eval", 40);
    await device.render(pattern);
    const fb = await device.read();
    const pass = fb !== null && fb.length === 40 && [...fb].every((v, i) => v === pattern[i]);
    return {
      status: pass ? "pass" : "fail",
      detail: pass
        ? `framebuffer matched rendered pattern · ${[...pattern].filter(v => v > 0).length} active dots`
        : "framebuffer diverged from rendered pattern",
      evidence: { dotCount: 40, activeDots: [...pattern].filter(v => v > 0).length },
    };
  });

  // T09 — diagnostics safety surface.
  t0 = nowMs();
  await push("T09-DIAGNOSTICS", t0, async () => {
    const reportJson = JSON.stringify(collectDiagnostics({ workflow, provider }));
    const redacted = JSON.stringify(sanitize({ apiKey: "x", token: "y", plain: 1 }));
    const pass =
      reportJson.length > 0 && redacted.includes("[redacted]") && redacted.includes('"plain":1');
    return {
      status: pass ? "pass" : "fail",
      detail: pass
        ? "diagnostics serializable · sensitive keys sanitized"
        : "diagnostics or sanitizer misbehaved",
      evidence: { diagnosticsBytes: reportJson.length },
    };
  });

  // T10 — graceful failure and recovery paths.
  t0 = nowMs();
  await push("T10-RECOVERY", t0, async () => {
    const dm = (await import("../core/DeviceManager.js")).DeviceManager;
    const manager = new dm();
    const guardedUnknown =
      manager.trySetActive("does-not-exist") === false && manager.getLastError() !== null;
    const stray = new VirtualDevice("eval-stray", "EvalStray", 8);
    let rejectedBeforeConnect = false;
    try {
      await stray.render(new Uint8Array(8));
    } catch {
      rejectedBeforeConnect = true;
    }
    await stray.connect();
    const pattern = new Uint8Array(8).fill(7);
    await stray.render(pattern);
    const recovered = (await stray.read()) !== null && guardedUnknown && rejectedBeforeConnect;
    return {
      status: recovered ? "pass" : "fail",
      detail: recovered
        ? "unknown setActive guarded · pre-connect render rejected · connect+render recovered"
        : `recovery path broken (guarded=${guardedUnknown}, rejected=${rejectedBeforeConnect})`,
      evidence: { guardedUnknown, rejectedBeforeConnect },
    };
  });

  // T11 — retrieval hardness (GFI-3): synthetic stress of the pipeline.
  t0 = nowMs();
  await push("T11-RETRIEVAL-HARDNESS", t0, async () => {
    const checks: { name: string; pass: boolean; detail: string }[] = [];
    const record = (name: string, pass: boolean, detail: string) => {
      checks.push({ name, pass, detail });
      return pass;
    };

    {
      const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider(), topK: 5 });
      await wf.ingest([HARDNESS_FIXTURES.correct, HARDNESS_FIXTURES.typo]);
      const r = await wf.run({ id: "hard-a", question: HARDNESS_QUERY });
      record(
        "similar-terminology",
        r.citations[0]?.documentId === "hard-correct",
        `top=${r.citations[0]?.documentId}`,
      );
    }
    {
      const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider(), topK: 5 });
      await wf.ingest([HARDNESS_FIXTURES.correct, HARDNESS_FIXTURES.distractor]);
      const r = await wf.run({ id: "hard-b", question: HARDNESS_QUERY });
      record(
        "distractor",
        r.citations[0]?.documentId === "hard-correct",
        `top=${r.citations[0]?.documentId}`,
      );
    }
    {
      const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider(), topK: 5 });
      await wf.ingest([HARDNESS_FIXTURES.correct, HARDNESS_FIXTURES.overlap]);
      const r = await wf.run({ id: "hard-c", question: HARDNESS_QUERY });
      record(
        "overlapping",
        r.citations[0]?.documentId === "hard-correct",
        `top=${r.citations[0]?.documentId}`,
      );
    }
    {
      const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider(), topK: 5 });
      await wf.ingest([HARDNESS_FIXTURES.contradictA, HARDNESS_FIXTURES.contradictB]);
      const r = await wf.run({ id: "hard-d", question: HARDNESS_CONTRADICT_QUERY });
      const ids = r.citations.map(c => c.documentId);
      record(
        "contradictory",
        ids.includes("hard-contradict-a") && ids.includes("hard-contradict-b"),
        `ids=${ids.join(",")}`,
      );
    }
    {
      const snap = new SnapshotIndex();
      await snap.index([HARDNESS_FIXTURES.renamedV1]);
      const h1 = snap.snapshotHash();
      await snap.index([HARDNESS_FIXTURES.renamedV2]);
      const h2 = snap.snapshotHash();
      record("renamed-section", h1 !== h2, `h1!=h2 ${h1.slice(0, 6)} vs ${h2.slice(0, 6)}`);
    }
    {
      const snap = new SnapshotIndex();
      await snap.index([HARDNESS_FIXTURES.correct]);
      const r2 = await snap.index([
        {
          ...HARDNESS_FIXTURES.correct,
          content: `${HARDNESS_FIXTURES.correct.content} extra sentence for version change.`,
        },
      ]);
      record("changed-version", r2.added.length > 0, `added=${r2.added.length}`);
    }
    {
      const snap = new SnapshotIndex();
      await snap.index([HARDNESS_FIXTURES.correct, HARDNESS_FIXTURES.distractor]);
      const r = await snap.index([HARDNESS_FIXTURES.correct]);
      record("deleted-replaced", r.removed.length > 0, `removed=${r.removed.length}`);
    }
    {
      const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider(), topK: 5 });
      await wf.ingest([HARDNESS_FIXTURES.correct]);
      const r = await wf.run({ id: "hard-h", question: HARDNESS_QUERY });
      const c = r.citations[0];
      record(
        "citation-correctness",
        Boolean(c && c.chunkId.startsWith(c.documentId)),
        `chunkId=${c?.chunkId}`,
      );
    }
    {
      const snap = new SnapshotIndex();
      await snap.index([HARDNESS_FIXTURES.overlap]);
      const v1 = snap.getManifest()?.version;
      await snap.index([HARDNESS_FIXTURES.correct]);
      const v2 = snap.getManifest()?.version;
      record("stale-snapshot", v1 !== v2, `v1=${v1} v2=${v2}`);
    }

    const passed = checks.filter(c => c.pass).length;
    const failed = checks.filter(c => !c.pass);
    const pass = failed.length === 0;
    return {
      status: pass ? "pass" : "fail",
      detail: pass
        ? `9/9 hardness subchecks passed — retrieval scores are ranks, not truth probabilities`
        : `hardness ${passed}/9 passed; failed: ${failed.map(f => f.name).join(", ")}`,
      evidence: { subchecksPassed: passed, subchecksTotal: 9 },
    };
  });

  const ordered = TASK_IDS.map(id => tasks.find(t => t.id === id)).filter(
    (t): t is EvaluationReportV1["tasks"][number] => Boolean(t),
  );
  const withLevels = ordered.map(t => ({ ...t, validationLevel: "SOFTWARE-VERIFIED" as const }));

  const passed = withLevels.filter(t => t.status === "pass").length;
  const failed = withLevels.filter(t => t.status === "fail").length;
  const skipped = withLevels.filter(t => t.status === "skipped").length;

  const environment: EvaluationEnvironment = {
    osPlatform: opts.environment?.osPlatform ?? osPlatform(),
    osRelease: opts.environment?.osRelease ?? osRelease(),
    arch: opts.environment?.arch ?? process.arch,
    nodeVersion: opts.environment?.nodeVersion ?? process.version,
    npmVersion: opts.environment?.npmVersion ?? null,
  };

  const partial: Mutable<EvaluationReportV1> = {
    schema: EVALUATION_SCHEMA_ID,
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    taskSetVersion: TASK_SET_VERSION,
    evaluationKind: "AUTOMATED",
    appVersion: APP_VERSION,
    build: getBuildVersion(),
    environment,
    hardwareStatus: opts.hardwareStatus ?? "NOT-TESTED",
    ...(opts.stamp ? { generatedAt: new Date().toISOString() } : {}),
    timingPolicy: "observed-nondeterministic",
    provenance: opts.provenance ?? "external-self-reported",
    notes: [],
    tasks: withLevels,
    privacyScan: { status: "pass", matches: [] },
    summary: {
      total: withLevels.length,
      passed,
      failed,
      skipped,
      allPassed: failed === 0 && passed + skipped === TASK_IDS.length,
    },
  };
  return { report: partial as EvaluationReportV1, workflow };
}

// ---------------------------------------------------------------------------
// Privacy scanning (C3.9)
// ---------------------------------------------------------------------------

/** Patterns whose presence in a shareable artifact indicates leakage. */
export const PRIVACY_PATTERNS: readonly { name: string; regex: RegExp }[] = [
  { name: "openai-style-key", regex: /sk-[A-Za-z0-9_-]{12,}/g },
  {
    name: "secret-field",
    regex: /"(api[_-]?key|apikey|secret|password|passwd|authorization|bearer|cookie|token)"\s*:/gi,
  },
  { name: "windows-user-path", regex: /[A-Za-z]:\\+Users\\+[^\s"]+/g },
  { name: "unix-home-path", regex: /\/(?:home|Users)\/[A-Za-z0-9_.-]+(?:\/[^\s"]*)?/g },
  { name: "temp-dir-artifact", regex: /[/\\]var[/\\]folders|[/\\]AppData[/\\]\w+[/\\]\\Temp/gi },
];

/** Scan serialized evidence for secrets/PII/path leakage. Returns match names found. */
export function scanEvidence(text: string): string[] {
  const found: string[] = [];
  for (const { name, regex } of PRIVACY_PATTERNS) {
    regex.lastIndex = 0;
    if (regex.test(text)) found.push(name);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Schema validation (C3.3/C3.10)
// ---------------------------------------------------------------------------

export type ValidationIssue = { path: string; problem: string };

const TASK_ID_RE = /^T\d{2}-[A-Z]+(?:-[A-Z]+)*$/;

/**
 * Validate an object against EvaluationReportV1.
 * Enforces the honesty rule: HARDWARE-* / USER-VALIDATED entries require
 * non-empty evidence-bearing detail or notes referencing how they were produced.
 */
export function validateEvaluation(value: unknown): { ok: boolean; errors: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const err = (path: string, problem: string) => errors.push({ path, problem });

  if (typeof value !== "object" || value === null) {
    return { ok: false, errors: [{ path: "$", problem: "not an object" }] };
  }
  const v = value as Record<string, unknown>;

  if (v.schema !== EVALUATION_SCHEMA_ID) err("schema", `expected "${EVALUATION_SCHEMA_ID}"`);
  if (v.schemaVersion !== EVALUATION_SCHEMA_VERSION)
    err("schemaVersion", `expected ${EVALUATION_SCHEMA_VERSION}`);
  if (
    v.taskSetVersion !== undefined &&
    (typeof v.taskSetVersion !== "number" || !Number.isInteger(v.taskSetVersion))
  )
    err("taskSetVersion", "integer required when present");
  if (!EVALUATION_KINDS.includes(v.evaluationKind as EvaluationKind))
    err("evaluationKind", `must be one of ${EVALUATION_KINDS.join(", ")}`);
  if (typeof v.appVersion !== "string" || v.appVersion.length === 0)
    err("appVersion", "non-empty string required");

  const env = v.environment as Record<string, unknown> | undefined;
  if (typeof env !== "object" || env === null) err("environment", "object required");
  else {
    for (const key of ["osPlatform", "osRelease", "arch", "nodeVersion"]) {
      if (typeof env[key] !== "string" || (env[key] as string).length === 0)
        err(`environment.${key}`, "non-empty string required");
    }
  }

  if (!PROVENANCE_VALUES.includes(v.provenance as Provenance))
    err("provenance", `must be one of ${PROVENANCE_VALUES.join(", ")}`);

  if (!HARDWARE_STATUSES.includes(v.hardwareStatus as HardwareStatus))
    err("hardwareStatus", `must be one of ${HARDWARE_STATUSES.join(", ")}`);

  if (!Array.isArray(v.tasks)) {
    err("tasks", "array required");
  } else {
    const taskList = v.tasks as unknown[];
    const statuses = new Set(["pass", "fail", "skipped"]);
    const isTaskRecord = (x: unknown): x is Record<string, unknown> =>
      typeof x === "object" && x !== null;
    taskList.forEach((t, i) => {
      const p = `tasks[${i}]`;
      if (!isTaskRecord(t)) return err(p, "task must be an object");
      const task = t;
      if (typeof task.id !== "string" || !TASK_ID_RE.test(task.id))
        err(`${p}.id`, "must match T##-NAME");
      if (!statuses.has(task.status as string)) err(`${p}.status`, "pass|fail|skipped required");
      if (typeof task.detail !== "string") err(`${p}.detail`, "string required");
      if (!VALIDATION_LEVELS.includes(task.validationLevel as ValidationLevel))
        err(`${p}.validationLevel`, `must be one of ${VALIDATION_LEVELS.join(", ")}`);
      const level = task.validationLevel as ValidationLevel | undefined;
      const needsProof =
        level === "HARDWARE-CONNECTED" ||
        level === "HARDWARE-VALIDATED" ||
        level === "USER-VALIDATED";
      if (needsProof) {
        const detail = typeof task.detail === "string" ? task.detail : "";
        const hasEvidenceRef =
          detail.length > 40 ||
          (typeof task.evidence === "object" && task.evidence !== null) ||
          (Array.isArray(v.notes) && v.notes.some(n => typeof n === "string" && n.length > 20));
        if (!hasEvidenceRef)
          err(
            `${p}.validationLevel`,
            `${level} requires substantive detail, evidence object, or notes — the schema cannot imply unproduced evidence`,
          );
      }
    });
    if (typeof v.summary === "object" && v.summary !== null) {
      const s = v.summary as Record<string, unknown>;
      const count = (status: string) =>
        taskList.filter(x => isTaskRecord(x) && x.status === status).length;
      if (s.total !== taskList.length) err("summary.total", "must equal tasks length");
      if (s.passed !== count("pass")) err("summary.passed", "mismatch vs tasks");
      if (s.failed !== count("fail")) err("summary.failed", "mismatch vs tasks");
      if (s.skipped !== count("skipped")) err("summary.skipped", "mismatch vs tasks");
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Human summary (C3.5)
// ---------------------------------------------------------------------------

/** Build the human-readable evaluation.md. Pure; contains metadata only. */
export function buildMarkdownSummary(report: EvaluationReportV1): string {
  const lines: string[] = [];
  lines.push("# AutoSD Evaluation Summary");
  lines.push("");
  lines.push(`- Schema: \`${report.schema}\` v${report.schemaVersion}`);
  lines.push(`- Kind: **${report.evaluationKind}**`);
  lines.push(`- App version: ${report.appVersion} (build: ${report.build})`);
  lines.push(
    `- Environment: ${report.environment.osPlatform} ${report.environment.osRelease} · ${report.environment.arch} · Node ${report.environment.nodeVersion}${report.environment.npmVersion ? ` · npm ${report.environment.npmVersion}` : ""}`,
  );
  lines.push(`- Hardware status: **${report.hardwareStatus}**`);
  lines.push(
    `- Outcome: ${report.summary.passed}/${report.summary.total} passed · ${report.summary.failed} failed · ${report.summary.skipped} skipped`,
  );
  lines.push(`- Privacy scan: ${report.privacyScan.status}`);
  lines.push("");
  lines.push("| Task | Status | Validation level | Detail |");
  lines.push("| ---- | ------ | ---------------- | ------ |");
  for (const t of report.tasks) {
    lines.push(
      `| ${t.id} | ${t.status.toUpperCase()} | ${t.validationLevel} | ${t.detail.replaceAll("|", "\\|")} |`,
    );
  }
  lines.push("");
  lines.push(
    "> Timing values are observed and nondeterministic by design. Software outcomes above are reproducible; see docs/EVALUATION_TASKS.md for per-task interpretation.",
  );
  if (report.notes.length > 0) {
    lines.push("", "## Evaluator notes", "");
    for (const n of report.notes) lines.push(`- ${n}`);
  }
  return `${lines.join("\n")}\n`;
}
