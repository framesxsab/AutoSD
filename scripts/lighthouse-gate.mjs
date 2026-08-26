#!/usr/bin/env node
/**
 * lighthouse-gate.mjs — release-quality gate for the served app.
 * Reads a Lighthouse JSON report and exits 1 unless every enforced
 * category meets its threshold: accessibility >= 95, performance >= 90.
 *
 * Shared by:
 *   - .github/workflows/lighthouse.yml (CI release-quality job)
 *   - scripts/verify-release.mjs (local `npm run verify:release`)
 *
 * Usage: node scripts/lighthouse-gate.mjs [path/to/lighthouse.json]
 */
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Enforced minimums, on the familiar 0-100 scale. Do not lower to make a run pass. */
export const THRESHOLDS = Object.freeze({ accessibility: 95, performance: 90 });

/**
 * Evaluate a Lighthouse JSON report against THRESHOLDS.
 * Scores are rounded to integers because Lighthouse quantizes category
 * scores to hundredths; rounding also avoids float artifacts such as
 * 0.95 * 100 === 94.99999999999999 failing an exact comparison.
 */
export async function evaluateLighthouseReport(reportPath) {
  const raw = await readFile(reportPath, "utf8");
  const report = JSON.parse(raw);
  /** @type {Record<string, number>} */
  const scores = {};
  /** @type {string[]} */
  const failures = [];
  for (const category of Object.keys(THRESHOLDS)) {
    const entry = report.categories?.[category];
    if (!entry || typeof entry.score !== "number") {
      failures.push(`${category}: no score found in report`);
      continue;
    }
    const score = Math.round(entry.score * 100);
    scores[category] = score;
    if (score < THRESHOLDS[category]) {
      failures.push(`${category} ${score} < ${THRESHOLDS[category]}`);
    }
  }
  return { scores, failures };
}

async function main() {
  const reportPath = process.argv[2] ?? "./lighthouse.json";
  let result;
  try {
    result = await evaluateLighthouseReport(reportPath);
  } catch (err) {
    console.error(`lighthouse-gate: cannot read report at ${reportPath}: ${err.message}`);
    process.exit(1);
  }
  for (const [category, score] of Object.entries(result.scores)) {
    console.log(`lighthouse-gate: ${category} ${score} (min ${THRESHOLDS[category]})`);
  }
  if (result.failures.length > 0) {
    for (const failure of result.failures) {
      console.error(`lighthouse-gate: FAIL ${failure}`);
    }
    process.exit(1);
  }
  console.log("lighthouse-gate: PASS");
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
