#!/usr/bin/env node
/**
 * run-stress-eval.mjs — Scale/latency benchmark + adversarial/abstention evals (`npm run eval:stress`).
 *
 * Usage:
 *   node scripts/run-stress-eval.mjs
 *   node scripts/run-stress-eval.mjs --docs 500 --queries 50 --out-dir evaluation-output
 */
import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
};

const docCount = Number(flag("--docs") ?? 250) || 250;
const paragraphsPerDoc = Number(flag("--paragraphs") ?? 4) || 4;
const queryCount = Number(flag("--queries") ?? 50) || 50;
const outDir = flag("--out-dir") ?? "evaluation-output";

async function main() {
  const server = await createServer({
    server: { middlewareMode: true },
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true },
  });

  try {
    const mod = await server.ssrLoadModule("/src/retrieval/eval/stress.js");
    const scale = await mod.runScaleBenchmark({ docCount, paragraphsPerDoc, queryCount });
    const adversarial = await mod.runAdversarialEval();
    const markdown = mod.buildStressMarkdown(scale, adversarial);

    await mkdir(outDir, { recursive: true });
    const jsonPath = resolve(outDir, "stress.json");
    const mdPath = resolve(outDir, "stress.md");

    await writeFile(jsonPath, `${JSON.stringify({ scale, adversarial }, null, 2)}\n`, "utf8");
    await writeFile(mdPath, `${markdown.trimEnd()}\n`, "utf8");

    console.log(markdown);
    console.log(`Artifacts written:\n  ${jsonPath}\n  ${mdPath}`);
  } finally {
    await server.close();
  }
}

await main();
