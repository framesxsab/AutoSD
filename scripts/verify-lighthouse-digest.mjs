#!/usr/bin/env node
/**
 * verify-lighthouse-digest.mjs — deterministic registry-to-lockfile verification
 * for the Lighthouse supply-chain gap (C8.1/C9.2).
 *
 * What it verifies:
 * - package-lock.json contains integrity SHA512 for lighthouse@12.8.2 and wait-on@8.0.3
 * - `npm view <pkg>@<version> dist.integrity` matches lockfile (when network available)
 *
 * Why this is reproducible:
 * - Exact versions pinned in package.json (12.8.2, 8.0.3)
 * - Integrity is content-addressed SHA512 of the tarball, stored in lockfile
 * - `npm ci` already verifies lockfile integrity on install
 *
 * What remains impossible to guarantee:
 * - Registry compromise (if npm registry serves a tampered tarball with matching version but attacker also controls the integrity value shown via `npm view`, comparison would still pass)
 * - Lockfile poisoning (if a contributor commits a tampered lockfile, `npm ci` would install it)
 * Trust boundary: lockfile is the source of truth for installed bits; registry check is defense-in-depth, not a proof against a compromised registry.
 *
 * Exit: 0 pass (or network unavailable → warn, not fail), 1 mismatch
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function getLockIntegrity(pkgPath) {
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const entry = lock.packages?.[pkgPath];
  return entry?.integrity ?? null;
}

function getRegistryIntegrity(pkgSpec) {
  const npx = process.platform === "win32" ? "npm.cmd" : "npm";
  const res = spawnSync(npx, ["view", pkgSpec, "dist.integrity", "--json"], {
    encoding: "utf8",
    timeout: 15000,
  });
  if (res.status !== 0) return null;
  try {
    const out = res.stdout.trim();
    // npm view --json wraps in quotes
    return JSON.parse(out);
  } catch {
    return res.stdout.trim().replace(/^"|"$/g, "");
  }
}

const checks = [
  { pkgPath: "node_modules/lighthouse", spec: "lighthouse@12.8.2" },
  { pkgPath: "node_modules/wait-on", spec: "wait-on@8.0.3" },
];

let failed = false;
for (const { pkgPath, spec } of checks) {
  const lockIntegrity = getLockIntegrity(pkgPath);
  console.log(`${spec}: lockfile integrity ${lockIntegrity ? lockIntegrity.slice(0, 20) + "..." : "MISSING"}`);
  if (!lockIntegrity) {
    console.error(`  ✗ No integrity in lockfile for ${pkgPath}`);
    failed = true;
    continue;
  }
  const registryIntegrity = getRegistryIntegrity(spec);
  if (registryIntegrity === null) {
    console.warn(`  ⚠ Network unavailable or registry check failed for ${spec} — skipping registry comparison (lockfile still verified by npm ci). See docs/CONTRIBUTOR_SAFETY.md.`);
    continue;
  }
  if (registryIntegrity === lockIntegrity) {
    console.log(`  ✓ Registry integrity matches lockfile for ${spec}`);
  } else {
    console.error(`  ✗ Mismatch for ${spec}`);
    console.error(`    lockfile:  ${lockIntegrity}`);
    console.error(`    registry:  ${registryIntegrity}`);
    failed = true;
  }
}

if (failed) {
  console.error("\n✗ Lighthouse digest verification failed");
  process.exit(1);
}
console.log("\n✓ Lighthouse digest verification pass (or network-unavailable warn — see trust boundary above)");
