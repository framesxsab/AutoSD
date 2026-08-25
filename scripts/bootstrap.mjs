#!/usr/bin/env node
/**
 * bootstrap.mjs — first-time setup from a clean clone.
 * Additive, non-destructive, verifies environment.
 */
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

function checkNode() {
  const v = process.versions.node;
  const major = Number(v.split(".")[0]);
  if (major < 20) {
    console.error(`Node >=20 required, found ${v}`);
    process.exit(1);
  }
  console.log(`Node ${v} OK`);
}

async function main() {
  checkNode();
  if (!existsSync("node_modules")) {
    run("npm install");
  } else {
    console.log("node_modules present — skipping install");
  }
  run("npm run typecheck");
  run("npm run lint");
  run("npm run format");
  run("npm test");
  run("npm run build");
  console.log("\n✓ Bootstrap complete. See BOOTSTRAP.md for next steps.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
