/**
 * write-healthz.mjs — emits a static readiness probe file into the build output.
 * Contains only non-secret metadata (version/status/timestamp). The live
 * in-app health report is available at runtime via window.__AUTOSD__.health().
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const outDir = resolve(process.cwd(), "dist-app");
if (!existsSync(outDir)) {
  console.error("write-healthz: dist-app/ not found — run `vite build` first");
  process.exit(1);
}

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

const payload = {
  status: "ok",
  version: pkg.version,
  timestamp: new Date().toISOString(),
};

await writeFile(resolve(outDir, "healthz.json"), JSON.stringify(payload, null, 2), "utf8");
console.log("write-healthz: dist-app/healthz.json written");
