#!/usr/bin/env node
/**
 * check-suite-counts.mjs — enforces the `suiteCounts` floor in
 * evaluation.baseline.json against a real vitest JSON report.
 *
 *   FAIL — test files or tests shrank below the baseline (tests disappeared).
 *   WARN — live counts exceed the baseline by more than LAG_TOLERANCE tests:
 *          ratchet `suiteCounts` per docs/BASELINE_MIGRATION.md so the floor
 *          keeps protecting new coverage.
 *
 * Usage: node scripts/check-suite-counts.mjs [vitest-report.json]
 *        (produce the report with `npm run test:report`)
 * Exit codes: 0 pass/warn · 1 regression · 2 usage error.
 */
import { readFile } from "node:fs/promises";

const LAG_TOLERANCE = 10;
const target = process.argv[2] ?? "test-results.json";

function die(code, message) {
  console.error(message);
  process.exit(code);
}

const [rawReport, rawBaseline] = await Promise.all([
  readFile(target, "utf8").catch(() =>
    die(2, `Cannot read ${target}. Run \`npm run test:report\` first.`),
  ),
  readFile("evaluation.baseline.json", "utf8").catch(() =>
    die(2, "Cannot read evaluation.baseline.json."),
  ),
]);

let report;
let baseline;
try {
  report = JSON.parse(rawReport);
  baseline = JSON.parse(rawBaseline);
} catch (err) {
  die(2, `Invalid JSON: ${err.message}`);
}

const files = Array.isArray(report.testResults) ? report.testResults.length : NaN;
const tests = Number(report.numTotalTests);
if (!Number.isFinite(files) || !Number.isFinite(tests))
  die(2, `${target} is not a vitest JSON report.`);
if (report.success === false || Number(report.numFailedTests) > 0) {
  die(
    1,
    `✗ Test run was not green (${report.numFailedTests} failed) — fix tests before checking counts.`,
  );
}

const { testFiles: baseFiles, tests: baseTests } = baseline.suiteCounts;
const failures = [];
if (files < baseFiles) failures.push(`test files shrank: ${files} < ${baseFiles}`);
if (tests < baseTests) failures.push(`test count shrank: ${tests} < ${baseTests}`);

if (failures.length > 0) {
  console.error("✗ Suite-count regression(s):");
  for (const f of failures) console.error(`  - ${f}`);
  console.error("  If tests were intentionally retired, follow docs/BASELINE_MIGRATION.md.");
  process.exit(1);
}

if (tests - baseTests > LAG_TOLERANCE) {
  console.error(
    `⚠ WARN: baseline suiteCounts lag live run (${files}/${tests} vs ${baseFiles}/${baseTests}) — ratchet evaluation.baseline.json per docs/BASELINE_MIGRATION.md`,
  );
}
console.log(`✓ Suite counts ok: ${files} files / ${tests} tests (floor ${baseFiles}/${baseTests})`);
