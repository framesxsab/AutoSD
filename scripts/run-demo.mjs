#!/usr/bin/env node
/**
 * run-demo.mjs — run the deterministic AutoSD demo as a script.
 *
 * Loads src/app/demo.ts through Vite's SSR transform (no build step, no
 * extra deps), prints progress to stderr and the canonical session JSON to
 * stdout so it can be piped: `npm run demo > demo.json`.
 *
 * Usage:
 *   npm run demo
 *   npm run demo -- --out demo.json
 */
import { createServer } from "vite";
import { writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outPath = outIdx !== -1 ? args[outIdx + 1] : null;

const server = await createServer({
  server: { middlewareMode: true },
  logLevel: "silent",
  optimizeDeps: { noDiscovery: true },
});

try {
  const mod = await server.ssrLoadModule("/src/app/demo.js");
  let failed = false;
  let result;
  try {
    result = await mod.runDemo({
      onProgress: (step, status, detail) => {
        const icon = status === "done" ? "✓" : status === "running" ? "…" : " ";
        console.error(`${icon} ${step}${detail ? ` — ${detail}` : ""}`);
      },
    });
  } catch (err) {
    console.error(`Demo failed: ${err && err.message ? err.message : err}`);
    failed = true;
  }

  if (!failed) {
    if (outPath) {
      await writeFile(outPath, `${result.exportJson}\n`, "utf8");
      console.error(`\nDemo JSON written to ${outPath}`);
    } else {
      console.log(result.exportJson);
    }
    console.error("\n✓ Demo complete.");
  }
  process.exitCode = failed ? 1 : 0;
} finally {
  await server.close();
}
