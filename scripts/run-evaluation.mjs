#!/usr/bin/env node
/**
 * run-evaluation.mjs — canonical independent evaluation entry point (`npm run evaluate`).
 *
 * Modes:
 *   node scripts/run-evaluation.mjs                          # full software evaluation
 *   node scripts/run-evaluation.mjs --out-dir <dir>          # custom artifact directory
 *   node scripts/run-evaluation.mjs --selftest-fail T03      # controlled-failure drill
 *   node scripts/run-evaluation.mjs --validate <file.json>   # validate an artifact against schema v1
 *   node scripts/run-evaluation.mjs --stamp                  # include ISO timestamp (off by default)
 *
 * Exit codes: 0 = all tasks passed & privacy scan clean · 1 = task failure(s)
 * or leakage detected · 2 = usage/schema error.
 */
import { createServer } from "vite";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(name);
  return i !== -1 ? (args[i + 1] ?? true) : undefined;
};
const hasFlag = name => args.includes(name);

const OUT_DIR_DEFAULT = "evaluation-output";
// Some npm versions strip flags after `--`; accept bare task ids (T##-…)
// and a bare output path so every documented invocation keeps working.
const TASK_ID_ARG = /^T\d{2}(-[A-Z].*)?$/;
const outDir =
  flag("--out-dir") ??
  args.find(a => !a.startsWith("-") && !TASK_ID_ARG.test(a)) ??
  OUT_DIR_DEFAULT;
const stamp = hasFlag("--stamp");
const validateTarget = flag("--validate");
const selftestFailRaw = flag("--selftest-fail");
const forceFailTaskIds = selftestFailRaw
  ? String(selftestFailRaw)
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
  : [];
for (const bare of args.filter(a => TASK_ID_ARG.test(a))) {
  if (!forceFailTaskIds.includes(bare)) forceFailTaskIds.push(bare);
}

function die(code, message) {
  console.error(message);
  process.exit(code);
}

function checkNode() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) die(2, `Node >=20 required, found ${process.versions.node}`);
}

/** T01 probe: run the real e2e smoke suite (mounts the actual app under jsdom). */
function runVitestSuite(suitePath, label, timeoutMs = 240_000) {
  const started = Date.now();
  const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";
  const res = spawnSync(npxBin, ["vitest", "run", suitePath], {
    encoding: "utf8",
    timeout: timeoutMs,
    shell: process.platform === "win32",
  });
  const durationMs = Date.now() - started;
  // Timing is reported via durationMs fields only, keeping artifact diffs
  // reducible to a single `"durationMs": N` normalization rule.
  if (res.status === 0) {
    return { ok: true, detail: `${label} green` };
  }
  return { ok: false, detail: `${label} failed (exit=${res.status})` };
}

const runStartupProbe = () => runVitestSuite("tests/e2e/smoke.test.ts", "e2e smoke suite");
/** T06 probe: persistence round-trip in REAL Node (no Vite SSR shim). */
const runPersistenceProbe = () =>
  runVitestSuite("tests/e2e/persistence.roundtrip.test.ts", "disk persistence round-trip");

function npmVersionOrNull() {
  const npxBin = process.platform === "win32" ? "npm.cmd" : "npm";
  const res = spawnSync(npxBin, ["-v"], {
    encoding: "utf8",
    timeout: 30_000,
    shell: process.platform === "win32",
  });
  return res.status === 0 ? String(res.stdout).trim() : null;
}

const SHARE_NOTICE = `
## Sharing this package

Safe to share as-is: this file, \`evaluation.json\`, and \`environment.json\`.
They contain versions, counts, statuses, and observed timings only — no
document contents, file paths, secrets, or personal data. The privacy scan
recorded above must read \`PASS\`; if it says \`FAIL\`, do not share the
package. Manual observations, screenshots, and hardware findings belong in
your issue text, not in these files. See docs/INDEPENDENT_EVALUATION.md.
`;

checkNode();

async function main() {
  const server = await createServer({
    server: { middlewareMode: true },
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true },
  });

  try {
    const mod = await server.ssrLoadModule("/src/app/evaluation.js");

    // ---- validate mode -------------------------------------------------------
    if (validateTarget) {
      const path = resolve(String(validateTarget));
      if (!existsSync(path)) die(2, `File not found: ${path}`);
      let parsed;
      try {
        parsed = JSON.parse(await readFile(path, "utf8"));
      } catch (err) {
        die(2, `Malformed JSON: ${err.message}`);
      }
      const verdict = mod.validateEvaluation(parsed);
      if (verdict.ok) {
        console.log(
          `✓ ${path} conforms to ${mod.EVALUATION_SCHEMA_ID} v${mod.EVALUATION_SCHEMA_VERSION}`,
        );
        const provenanceRaw = parsed.provenance;
        const classified =
          provenanceRaw === "maintainer-ci"
            ? "maintainer-ci (pipeline-generated, CI-attested)"
            : provenanceRaw === "external-self-reported"
              ? "external self-reported (contributor-submitted, unverified)"
              : "external self-reported (no provenance field — treated as external)";
        console.log(`  provenance: ${classified}`);
        const digest = {
          schema: parsed.schema,
          schemaVersion: parsed.schemaVersion,
          evaluationKind: parsed.evaluationKind,
          appVersion: parsed.appVersion,
          hardwareStatus: parsed.hardwareStatus,
          summary: parsed.summary,
        };
        console.log(`  digest: ${JSON.stringify(digest)}`);
        console.log(
          "  note: external evidence is never auto-merged into README or release claims (see docs/EVALUATION_SCHEMA.md)",
        );
        process.exitCode = 0;
      } else {
        console.error(`✗ ${path} violates schema v${mod.EVALUATION_SCHEMA_VERSION}:`);
        for (const e of verdict.errors) console.error(`  - ${e.path}: ${e.problem}`);
        process.exitCode = 2;
      }
      return;
    }

  // ---- run mode ------------------------------------------------------------
  // Normalize user-supplied ids ("T03", "T03-RET…", or exact) against the
  // engine's canonical task registry so shorthand always matches.
  const expandTaskId = raw =>
    mod.TASK_IDS.filter(id => id === raw || id.startsWith(raw));
  const forcedIds = [...new Set(forceFailTaskIds.flatMap(expandTaskId))];
  if (forceFailTaskIds.length > 0) {
    console.error(
      `[selftest] forcing failure of: ${forcedIds.length > 0 ? forcedIds.join(", ") : "(no matching tasks!)"}`,
    );
  }
    console.error(`AutoSD independent evaluation — app v${mod.APP_VERSION}`);

    const { report } = await mod.runSoftwareEvaluation({
      startupProbe: runStartupProbe,
      persistenceProbe: runPersistenceProbe,
      forceFailTaskIds: forcedIds,
      environment: { npmVersion: npmVersionOrNull() },
      ...(stamp ? { stamp: true } : {}),
    });

    const serialized = JSON.stringify(report, null, 2);
    const leaked = mod.scanEvidence(serialized);

    await mkdir(outDir, { recursive: true });
    const jsonPath = resolve(outDir, "evaluation.json");
    const mdPath = resolve(outDir, "evaluation.md");
    const envPath = resolve(outDir, "environment.json");

    if (leaked.length > 0) {
      // Write nothing when leakage is detected; print pattern NAMES only.
      console.error(`✗ Privacy scan FAILED — patterns matched: ${leaked.join(", ")}`);
      console.error("  Artifacts were NOT written. Do not attempt to share this run.");
      process.exitCode = 1;
      return;
    }

    const markdown = `${mod.buildMarkdownSummary(report)}${SHARE_NOTICE}`;
    await writeFile(jsonPath, `${serialized}\n`, "utf8");
    await writeFile(mdPath, markdown, "utf8");
    await writeFile(
      envPath,
      `${JSON.stringify(
        {
          schema: report.schema,
          schemaVersion: report.schemaVersion,
          appVersion: report.appVersion,
          build: report.build,
          environment: report.environment,
          hardwareStatus: report.hardwareStatus,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    for (const t of report.tasks) {
      const icon = t.status === "pass" ? "✓" : t.status === "fail" ? "✗" : "·";
      console.error(`${icon} ${t.id.padEnd(19)} ${t.status.toUpperCase().padEnd(7)} ${t.detail}`);
    }
    console.error(
      `\n${report.summary.passed}/${report.summary.total} passed · ${report.summary.failed} failed · ${report.summary.skipped} skipped · privacy scan PASS`,
    );
    console.error(`Artifacts written:\n  ${jsonPath}\n  ${mdPath}\n  ${envPath}`);
    process.exitCode = report.summary.failed > 0 ? 1 : 0;
  } finally {
    await server.close();
  }
}

await main();
