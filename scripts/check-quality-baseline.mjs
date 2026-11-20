#!/usr/bin/env node
/**
 * check-quality-baseline.mjs — non-regression gate over `npm run eval:quality` output.
 *
 * Rules:
 *   FAIL — schema mismatch; missing corpus or config; any tracked macro metric
 *          drops below `baseline - absTolerance`; `hybrid:lexical-hash` drops
 *          below `bm25` on overall `ndcgAt10` or `recallAt10`.
 *   WARN — corpus or qrels hashes differ from baseline; any tracked metric
 *          improves by more than 0.05 (ratchet baseline).
 *   PASS — everything else.
 *
 * Usage: node scripts/check-quality-baseline.mjs [quality.json path]
 * Exit codes: 0 pass/warn · 1 regression · 2 usage error.
 */
import { readFile } from "node:fs/promises";

const target = process.argv[2] ?? "evaluation-output/quality.json";
const baselinePath = "quality.baseline.json";
const TRACKED_METRICS = ["recallAt5", "recallAt10", "mrrAt10", "ndcgAt10"];

function die(code, message) {
  console.error(message);
  process.exit(code);
}

const [rawReport, rawBaseline] = await Promise.all([
  readFile(target, "utf8").catch(() =>
    die(2, `Cannot read ${target}. Run \`npm run eval:quality\` first.`),
  ),
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

if (report.schema !== baseline.schemaId || report.schemaVersion !== baseline.schemaVersion) {
  failures.push(
    `schema drift: got ${report.schema} v${report.schemaVersion}, expected ${baseline.schemaId} v${baseline.schemaVersion}`,
  );
}

const corporaById = new Map((report.corpora ?? []).map(c => [c.corpusId, c]));
for (const [corpusId, expectedCorpusHash] of Object.entries(baseline.corpusHashes ?? {})) {
  const live = corporaById.get(corpusId);
  if (!live) {
    failures.push(`missing corpus in quality report: ${corpusId}`);
    continue;
  }
  if (live.corpusHash !== expectedCorpusHash) {
    warnings.push(
      `corpus "${corpusId}" hash changed (${live.corpusHash} != ${expectedCorpusHash}) — verify frozen fixture`,
    );
  }
  const expectedQrelsHash = baseline.qrelsHashes?.[corpusId];
  if (expectedQrelsHash && live.qrelsHash !== expectedQrelsHash) {
    warnings.push(
      `corpus "${corpusId}" qrels hash changed (${live.qrelsHash} != ${expectedQrelsHash}) — verify judgments`,
    );
  }
}

const tol = Number(baseline.absTolerance ?? 0.02);
for (const [configId, expectedMetrics] of Object.entries(baseline.macroOverall ?? {})) {
  const live = report.macroOverall?.[configId];
  if (!live) {
    failures.push(`missing config in macroOverall: ${configId}`);
    continue;
  }
  for (const metric of TRACKED_METRICS) {
    const baseVal = Number(expectedMetrics[metric]);
    const liveVal = Number(live[metric]);
    if (!Number.isFinite(liveVal)) {
      failures.push(`${configId}.${metric} is missing or non-numeric`);
      continue;
    }
    if (liveVal < baseVal - tol) {
      failures.push(
        `${configId}.${metric} regressed: ${liveVal.toFixed(4)} < ${(baseVal - tol).toFixed(4)} (baseline ${baseVal.toFixed(4)} - ${tol})`,
      );
    } else if (liveVal > baseVal + 0.05) {
      warnings.push(
        `${configId}.${metric} improved by +${(liveVal - baseVal).toFixed(4)} (${liveVal.toFixed(4)} vs ${baseVal.toFixed(4)}) — consider ratcheting ${baselinePath}`,
      );
    }
  }
}

const bm25 = report.macroOverall?.["bm25"];
const hybridLex = report.macroOverall?.["hybrid:lexical-hash"];
if (bm25 && hybridLex) {
  if (hybridLex.ndcgAt10 < bm25.ndcgAt10) {
    failures.push(
      `invariant failed: hybrid:lexical-hash.ndcgAt10 (${hybridLex.ndcgAt10.toFixed(4)}) < bm25.ndcgAt10 (${bm25.ndcgAt10.toFixed(4)})`,
    );
  }
  if (hybridLex.recallAt10 < bm25.recallAt10) {
    failures.push(
      `invariant failed: hybrid:lexical-hash.recallAt10 (${hybridLex.recallAt10.toFixed(4)}) < bm25.recallAt10 (${bm25.recallAt10.toFixed(4)})`,
    );
  }
}

if (warnings.length > 0) {
  console.error("⚠ WARN:");
  for (const w of warnings) console.error(`  - ${w}`);
}

if (failures.length > 0) {
  console.error("✗ Retrieval quality regression(s):");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `✓ Quality baseline check pass: schema v${report.schemaVersion} · ${Object.keys(baseline.macroOverall).length} configs · ${report.corpora.length} corpora${warnings.length ? ` · ${warnings.length} warning(s)` : ""}`,
);
process.exit(0);
