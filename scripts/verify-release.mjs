#!/usr/bin/env node
/**
 * verify-release.mjs — full release verification against the real served app.
 *
 * Pipeline (mirrors .github/workflows/lighthouse.yml):
 *   1. production build (`npm run build`)
 *   2. serve dist-app/ via `vite preview` on http://127.0.0.1:4173
 *   3. wait for HTTP readiness (poll, 30s deadline)
 *   4. headless-Chrome Lighthouse audit (--only-categories=accessibility,performance)
 *   5. shared threshold gate: accessibility >= 95, performance >= 90
 *
 * This is the slow, thorough gate. The everyday `npm run verify` stays fast
 * because it never starts a server or a browser; unit tests never depend on one.
 * Requires Chrome/Chromium for Lighthouse. The report is written to ./lighthouse.json.
 *
 * Usage:
 *   npm run verify:release                # build + preview + audit + gate
 *   npm run verify:release -- --skip-build  # reuse an existing dist-app/ while iterating
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { evaluateLighthouseReport } from "./lighthouse-gate.mjs";

const HOST = "127.0.0.1";
const PORT = 4173; // matches vite.config.ts preview.strictPort
const URL_TO_AUDIT = `http://${HOST}:${PORT}/`;
const REPORT_PATH = "./lighthouse.json";
const READINESS_TIMEOUT_MS = 30_000;
const READINESS_INTERVAL_MS = 500;
const LIGHTHOUSE_NPX_SPEC = "lighthouse@12"; // pinned major so gates stay reproducible

const skipBuild = process.argv.includes("--skip-build");

function runBuild() {
  console.log("verify-release: building (tsc + vite build)…");
  const result = spawnSync("npm", ["run", "build"], { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    console.error("verify-release: build failed");
    process.exit(result.status ?? 1);
  }
}

/** Resolve a package's package.json without throwing. */
function safeResolve(specifier) {
  try {
    return createRequire(import.meta.url).resolve(specifier);
  } catch {
    return null;
  }
}

/** Start `vite preview` bound to 127.0.0.1:4173 and return the child process. */
function startPreview() {
  const vitePkg = safeResolve("vite/package.json");
  if (!vitePkg) {
    console.error("verify-release: vite not installed — run `npm install` first");
    process.exit(1);
  }
  const viteBin = join(dirname(vitePkg), "bin", "vite.js");
  const child = spawn(process.execPath, [viteBin, "preview", "--port", String(PORT), "--host", HOST], {
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    if (code !== null && code !== 0 && !exiting) {
      // strictPort means Vite dies immediately when 4173 is taken.
      console.error(`verify-release: preview server exited early (code ${code}). Is port ${PORT} in use?`);
    }
  });
  return child;
}

async function waitForReadiness() {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(URL_TO_AUDIT);
      if (res.ok) {
        console.log(`verify-release: preview ready at ${URL_TO_AUDIT}`);
        return;
      }
    } catch {
      // not up yet
    }
    await delay(READINESS_INTERVAL_MS);
  }
  console.error(`verify-release: ${URL_TO_AUDIT} was not ready within ${READINESS_TIMEOUT_MS / 1000}s`);
  process.exit(1);
}

/**
 * Run Lighthouse with the exact flags CI uses. Prefers a locally installed
 * lighthouse; otherwise invokes npx (no shell, so args need no quoting).
 */
function runLighthouse() {
  const chromeFlags = "--headless --no-sandbox --disable-gpu";
  const args = [
    URL_TO_AUDIT,
    "--only-categories=accessibility,performance",
    "--output=json",
    `--output-path=${REPORT_PATH}`,
    `--chrome-flags=${chromeFlags}`,
    "--quiet",
  ];

  const localPkg = safeResolve("lighthouse/package.json");
  if (localPkg) {
    const cli = join(dirname(localPkg), "cli", "index.js");
    console.log("verify-release: running local lighthouse…");
    return spawnSync(process.execPath, [cli, ...args], { stdio: "inherit" }).status ?? 1;
  }

  const npxCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (!existsSync(npxCli)) {
    console.error(
      `verify-release: lighthouse is not installed locally and npx was not found next to node.\n` +
        `Install it once with \`npm install --no-save lighthouse@12\` or run manually:\n` +
        `  npx --yes ${LIGHTHOUSE_NPX_SPEC} ${URL_TO_AUDIT} --only-categories=accessibility,performance --output=json --output-path=${REPORT_PATH} --chrome-flags="${chromeFlags}" --quiet`,
    );
    return 1;
  }
  console.log(`verify-release: running ${LIGHTHOUSE_NPX_SPEC} via npx…`);
  return spawnSync(process.execPath, [npxCli, "--yes", LIGHTHOUSE_NPX_SPEC, ...args], {
    stdio: "inherit",
  }).status ?? 1;
}

let exiting = false;

/** Kill the preview process tree (Windows needs taskkill for child processes). */
function stopPreview(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

async function main() {
  console.log(`verify-release: full release verification${skipBuild ? " (skipping build)" : ""}`);
  if (!skipBuild) {
    runBuild();
  } else if (!existsSync("dist-app")) {
    console.error('verify-release: --skip-build set but dist-app/ does not exist — run a build first');
    process.exit(1);
  }

  const preview = startPreview();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      exiting = true;
      stopPreview(preview);
      process.exit(130);
    });
  }
  process.on("exit", () => stopPreview(preview));

  try {
    await waitForReadiness();
    const lhStatus = runLighthouse();
    if (lhStatus !== 0) {
      console.error("verify-release: lighthouse audit failed to run");
      process.exit(lhStatus);
    }

    const { scores, failures } = await evaluateLighthouseReport(REPORT_PATH);
    for (const [category, score] of Object.entries(scores)) {
      console.log(`verify-release: ${category} ${score}`);
    }
    if (failures.length > 0) {
      for (const failure of failures) console.error(`verify-release: GATE FAIL ${failure}`);
      process.exit(1);
    }
    console.log("\n✓ Release verification complete. Report saved to ./lighthouse.json");
  } finally {
    exiting = true;
    stopPreview(preview);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
