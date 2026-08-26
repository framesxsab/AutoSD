#!/usr/bin/env node
/**
 * check-evaluation-baseline.mjs — regression gate over `npm run evaluate` output.
 *
 * Rules (see docs/EVALUATION_SCHEMA.md + evaluation.baseline.json):
 *   FAIL — required task not passing; privacy scan not "pass"; schema version
 *          drift; suite counts smaller than baseline (tests disappeared).
 *   WARN — task duration > 10x the advisory baseline observation. Timings are
 *          advisory only: they are drift smoke, never performance thresholds.
 *   PASS — everything else.
 *
 * Usage: node scripts/check-evaluation-baseline.mjs [evaluation.json path]
 * Exit codes: 0 pass/warn · 1 regression · 2 usage error.
 */
import { readFile } from "node:fs/promises";

const target = process.argv[2] ?? "evaluation-output/evaluation.json";
const baselinePath = "evaluation.baseline.json";

function die(code, message) {
  console.error(message);
  process.exit(code);
}

const [rawReport, rawBaseline] = await Promise.all([
  readFile(target, "utf8").catch(() => die(2, `Cannot read ${target}. Run \`npm run evaluate\` first.`)),
  readFile(baselinePath, "utf8").catch(() => die(2, `Cannot read ${baselinePath}.`)),
]);

let report;
let baseline;
try {
  report = JSON.parse(rawReport);
  baseline = JSON.parse(rawBaseline);
} catch (err) {
  die(2, `Invalid JSON: ${err.message}`);
}

const failures = [];
const warnings = [];

// Schema stability
if (report.schema !== baseline.schemaId)
  failures.push(`schema id drifted: ${report.schema} != ${baseline.schemaId}`);
if (report.schemaVersion !== baseline.schemaVersion)
  failures.push(`schema version drifted: v${report.schemaVersion} != v${baseline.schemaVersion}`);

// Privacy gate
if (report.privacyScan?.status !== baseline.privacyScanRequired)
  failures.push(`privacy scan is '${report.privacyScan?.status}', must be '${baseline.privacyScanRequired}'`);

// Task-set versioning (C5.2)
if (
  typeof report.taskSetVersion === "number" &&
  typeof baseline.taskSetVersion === "number" &&
  report.taskSetVersion !== baseline.taskSetVersion
) {
  warnings.push(
    `task set version drift: report v${report.taskSetVersion} vs baseline v${baseline.taskSetVersion} — see docs/BASELINE_MIGRATION.md`,
  );
}

// Task behavior — distinguish new / removed / changed / unchanged (C5.2)
const live = new Map((report.tasks ?? []).map(t => [t.id, t]));
const baselineIds = new Set(baseline.requiredTasks.map(t => t.id));
const liveIds = new Set(live.keys());

for (const id of liveIds) {
  if (!baselineIds.has(id)) {
    const t = live.get(id);
    if (t.status !== "pass") failures.push(`new task ${id} failed: ${t.status} — review task definition`);
    else warnings.push(`new task ${id} detected (was not in baseline v${baseline.taskSetVersion}) — if intentional, update evaluation.baseline.json per docs/BASELINE_MIGRATION.md`);
  }
}
for (const req of baseline.requiredTasks) {
  const t = live.get(req.id);
  if (!t) failures.push(`required task ${req.id} missing from run (removed task) — if intentional, migrate baseline per docs/BASELINE_MIGRATION.md`);
  else {
    if (t.status !== req.status)
      failures.push(`${req.id} regressed: ${t.status} (baseline ${req.status}) — status changed`);
    if (t.validationLevel !== req.validationLevel)
      warnings.push(`${req.id} validationLevel changed: ${t.validationLevel} (baseline ${req.validationLevel}) — verify boundary intent`);
  }
}

// Suite counts may only grow
if (typeof report.summary?.total === "number") {
  // task count sanity only — test-count comparison handled via caller-provided env
}
if (process.env.EVAL_SUITE_FILES && process.env.EVAL_SUITE_TESTS) {
  const f = Number(process.env.EVAL_SUITE_FILES);
  const n = Number(process.env.EVAL_SUITE_TESTS);
  if (f < baseline.suiteCounts.testFiles)
    failures.push(`test files shrank: ${f} < ${baseline.suiteCounts.testFiles}`);
  if (n < baseline.suiteCounts.tests)
    failures.push(`test count shrank: ${n} < ${baseline.suiteCounts.tests}`);
}

// Advisory timing drift
for (const t of report.tasks ?? []) {
  const base = baseline.durationsMsAdvisory[t.id];
  if (typeof base === "number" && typeof t.durationMs === "number" && base > 0) {
    if (t.durationMs > base * 10)
      warnings.push(`${t.id} took ${t.durationMs}ms — more than 10x advisory ${base}ms`);
  }
}

if (warnings.length > 0) {
  console.error("⚠ WARN:");
  for (const w of warnings) console.error(`  - ${w}`);
}

if (failures.length > 0) {
  console.error("✗ Evaluation regression(s):");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `✓ Baseline check pass: schema v${report.schemaVersion} · ${report.summary.passed}/${report.summary.total} tasks passing · privacy ${report.privacyScan.status}${warnings.length ? ` · ${warnings.length} warning(s)` : ""}`,
);
process.exit(0);
