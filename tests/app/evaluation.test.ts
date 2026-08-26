import { describe, expect, it } from "vitest";
import {
  EVALUATION_QUERY,
  SYNTHETIC_CORPUS,
  buildMarkdownSummary,
  runSoftwareEvaluation,
  scanEvidence,
  validateEvaluation,
} from "../../src/app/evaluation.js";
import { ResearchWorkflow } from "../../src/workflows/research.js";
import { MockEmbeddingProvider } from "../../src/retrieval/providers/MockEmbeddingProvider.js";

const FIXED_ENV = {
  osPlatform: "testos",
  osRelease: "1.0",
  arch: "x64",
  nodeVersion: "v20.0.0",
  npmVersion: "10.0.0",
};

function runEval(opts = {}) {
  return runSoftwareEvaluation({
    environment: FIXED_ENV,
    startupProbe: async () => ({ ok: true, detail: "probe ok" }),
    ...opts,
  });
}

describe("runSoftwareEvaluation (canonical eleven-task suite)", () => {
  it("passes all eleven software tasks with a synthetic corpus", async () => {
    const { report, workflow } = await runEval();

    expect(report.tasks.map(t => t.id)).toHaveLength(11);
    expect(report.summary.total).toBe(11);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.skipped).toBe(0);
    expect(report.summary.allPassed).toBe(true);

    for (const t of report.tasks) {
      expect(t.status, `${t.id}: ${t.detail}`).toBe("pass");
      expect(t.validationLevel).toBe("SOFTWARE-VERIFIED");
    }

    // Determinism of content-bearing fields across two runs.
    const second = await runEval();
    type Run = Awaited<ReturnType<typeof runSoftwareEvaluation>>;
    const strip = (run: Run) =>
      JSON.stringify({
        tasks: run.report.tasks.map((t: { id: string; status: string }) => ({
          id: t.id,
          status: t.status,
        })),
        appVersion: run.report.appVersion,
        environment: run.report.environment,
      });
    expect(strip(second)).toBe(strip({ report, workflow } as Run));

    // No timestamps by default; timing flagged as observed.
    expect(report.generatedAt).toBeUndefined();
    expect(report.timingPolicy).toBe("observed-nondeterministic");
    expect(workflow.listDocuments()).toHaveLength(SYNTHETIC_CORPUS.length);
  });

  it("skips T01 when no startup probe is configured", async () => {
    const { report } = await runSoftwareEvaluation({ environment: FIXED_ENV });
    const t01 = report.tasks.find(t => t.id === "T01-STARTUP");
    expect(t01?.status).toBe("skipped");
    expect(report.summary.skipped).toBe(1);
  });

  it("records a controlled failure via forceFailTaskIds without throwing", async () => {
    const { report } = await runEval({ forceFailTaskIds: ["T03-RETRIEVAL"] });
    const t03 = report.tasks.find(t => t.id === "T03-RETRIEVAL");
    expect(t03?.status).toBe("fail");
    expect(t03?.detail).toContain("[forced failure: selftest]");
    expect(report.summary.failed).toBe(1);
    expect(report.summary.allPassed).toBe(false);
  });

  it("uses only the synthetic corpus and never touches user files", async () => {
    const { workflow } = await runEval();
    expect(workflow.listDocuments().map(d => d.id)).toEqual(SYNTHETIC_CORPUS.map(d => d.id));
  });
});

describe("validateEvaluation (schema v1 gate)", () => {
  const baseReport = async (overrides = {}) => {
    const { report } = await runEval();
    return { ...report, ...overrides };
  };

  it("accepts the canonical output unchanged", async () => {
    const verdict = validateEvaluation(await baseReport());
    expect(verdict.ok).toBe(true);
    expect(verdict.errors).toEqual([]);
  });

  it("rejects wrong schema id and version", async () => {
    const verdict = validateEvaluation(await baseReport({ schema: "other", schemaVersion: 99 }));
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.map(e => e.path)).toContain("schema");
    expect(verdict.errors.map(e => e.path)).toContain("schemaVersion");
  });

  it("rejects structurally malformed input instead of throwing", async () => {
    for (const bad of [null, "string", 42, [], {}]) {
      const verdict = validateEvaluation(bad);
      expect(verdict.ok).toBe(false);
      expect(verdict.errors.length).toBeGreaterThan(0);
    }
  });

  it("rejects unknown task ids and statuses", async () => {
    const report = await baseReport();
    const tampered = {
      ...report,
      tasks: [
        ...report.tasks.slice(0, 2),
        { id: "X99-BAD", status: "maybe", detail: "", validationLevel: "SOFTWARE-VERIFIED" },
      ],
      summary: { total: 3, passed: 0, failed: 0, skipped: 0, allPassed: false },
    };
    const verdict = validateEvaluation(tampered);
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.some(e => e.path.includes(".id"))).toBe(true);
    expect(verdict.errors.some(e => e.path.includes(".status"))).toBe(true);
  });

  it("enforces the honesty rule: hardware/user claims need evidence", async () => {
    const report = await baseReport();
    const claimWithoutProof = {
      ...report,
      tasks: [
        {
          id: "T08-TACTILE-VIRTUAL",
          status: "pass",
          detail: "worked",
          durationMs: 1,
          validationLevel: "USER-VALIDATED",
        },
      ],
      summary: { total: 1, passed: 1, failed: 0, skipped: 0, allPassed: true },
    };
    const rejected = validateEvaluation(claimWithoutProof);
    expect(rejected.ok).toBe(false);
    expect(rejected.errors[0].problem).toContain("cannot imply unproduced evidence");

    const accepted = validateEvaluation({
      ...claimWithoutProof,
      notes: [
        "Validated in a moderated session with one participant using an Emprint device on 2026-01-15.",
      ],
    });
    expect(accepted.ok).toBe(true);
  });

  it("catches summary/task mismatches", async () => {
    const report = await baseReport();
    const verdict = validateEvaluation({
      ...report,
      summary: { ...report.summary, passed: 999 },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.map(e => e.path)).toContain("summary.passed");
  });
});

describe("scanEvidence (privacy guard)", () => {
  it("flags secrets, user paths, and credential fields", () => {
    const found = scanEvidence(
      JSON.stringify({
        key: "sk-proj1234567890abcdef",
        home: "/home/alice/notes.txt",
        win: "C:\\Users\\bob\\doc.md",
        apiKey: "oops",
      }),
    );
    expect(found).toContain("openai-style-key");
    expect(found).toContain("unix-home-path");
    expect(found).toContain("windows-user-path");
    expect(found).toContain("secret-field");
  });

  it("passes clean evaluation artifacts", async () => {
    const { report } = await runEval();
    expect(scanEvidence(JSON.stringify(report))).toEqual([]);
    expect(scanEvidence(buildMarkdownSummary(report))).toEqual([]);
  });
});

describe("buildMarkdownSummary", () => {
  it("renders statuses, levels, and the timing disclaimer without contents", async () => {
    const { report } = await runEval();
    const md = buildMarkdownSummary(report);
    expect(md).toContain("# AutoSD Evaluation Summary");
    expect(md).toContain("T02-INGEST | PASS | SOFTWARE-VERIFIED");
    expect(md).toContain("observed and nondeterministic");
    // No synthetic corpus text may leak into the summary.
    for (const doc of SYNTHETIC_CORPUS) {
      expect(md).not.toContain(doc.content.slice(0, 40));
    }
  });
});

describe("evaluation fixtures independence", () => {
  it("answers the evaluation query from the synthetic corpus alone", async () => {
    const wf = new ResearchWorkflow({ provider: new MockEmbeddingProvider() });
    await wf.ingest([...SYNTHETIC_CORPUS]);
    const result = await wf.run({ id: "q", question: EVALUATION_QUERY });
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations.every(c => c.documentId.startsWith("eval-"))).toBe(true);
  });
});

describe("artifact contract (C4.2)", () => {
  it("allowlist contains exactly the three safe files", async () => {
    const { ARTIFACT_ALLOWLIST } = await import("../../src/app/evaluation.js");
    expect([...ARTIFACT_ALLOWLIST].sort()).toEqual(
      ["environment.json", "evaluation.json", "evaluation.md"].sort(),
    );
  });

  it("forbids secrets, absolute private paths, and credentials in artifacts", async () => {
    const { report } = await runEval();
    const json = JSON.stringify(report);
    const md = buildMarkdownSummary(report);
    expect(scanEvidence(json)).toEqual([]);
    expect(scanEvidence(md)).toEqual([]);
    expect(json).not.toMatch(/sk-[A-Za-z0-9]{12,}/);
    expect(json).not.toMatch(/C:\\\\Users/);
    expect(json).not.toMatch(/\/home\//);
  });

  it("accepts valid provenance and rejects unknown values", async () => {
    const base = (await runEval()).report as Record<string, unknown>;
    const okExternal = validateEvaluation({ ...base, provenance: "external-self-reported" });
    expect(okExternal.ok).toBe(true);
    const okCi = validateEvaluation({ ...base, provenance: "maintainer-ci" });
    expect(okCi.ok).toBe(true);
    const bad = validateEvaluation({ ...base, provenance: "maintainer-hacker" });
    expect(bad.ok).toBe(false);
    expect(bad.errors.some(e => e.path === "provenance")).toBe(true);
  });

  it("distinguishes external self-reported evidence from CI evidence", async () => {
    const base = (await runEval()).report as Record<string, unknown>;
    const ext = validateEvaluation({ ...base, provenance: "external-self-reported" });
    expect(ext.ok).toBe(true);
    const ci = validateEvaluation({ ...base, provenance: "maintainer-ci" });
    expect(ci.ok).toBe(true);
    const { provenance: _drop, ...bare } = base;
    const missing = validateEvaluation(bare);
    expect(missing.ok).toBe(false);
    expect(missing.errors.some(e => e.path === "provenance")).toBe(true);
  });

  it("rejects malformed, incomplete, ambiguous, and contradictory reports", async () => {
    const base = (await runEval()).report as Record<string, unknown>;
    const malformed = validateEvaluation("not an object" as unknown);
    expect(malformed.ok).toBe(false);
    const incomplete = validateEvaluation({ schema: "autosd-evaluation", schemaVersion: 1 });
    expect(incomplete.ok).toBe(false);
    expect(incomplete.errors.some(e => e.path === "tasks")).toBe(true);
    const ambiguous = validateEvaluation({ ...base, provenance: undefined });
    expect(ambiguous.ok).toBe(false);
    const contradictory = validateEvaluation({
      ...base,
      tasks: [
        {
          id: "T11-RETRIEVAL-HARDNESS",
          status: "pass",
          detail: "ok",
          validationLevel: "HARDWARE-VALIDATED",
        },
      ],
      summary: { total: 1, passed: 1, failed: 0, skipped: 0, allPassed: true },
    });
    expect(contradictory.ok).toBe(false);
    expect(contradictory.errors.some(e => e.path.includes("validationLevel"))).toBe(true);
  });
});
