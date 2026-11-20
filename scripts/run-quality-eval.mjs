#!/usr/bin/env node
/**
 * run-quality-eval.mjs — offline retrieval quality harness (`npm run eval:quality`).
 *
 * Modes:
 *   node scripts/run-quality-eval.mjs                 # evaluate all frozen corpora
 *   node scripts/run-quality-eval.mjs --include-local # also evaluate LocalEmbeddingProvider (M3)
 *   node scripts/run-quality-eval.mjs --out-dir <dir> # custom output directory
 *   node scripts/run-quality-eval.mjs --stamp         # include generatedAt timestamp
 */
import { createServer } from "vite";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(name);
  return i !== -1 ? (args[i + 1] ?? true) : undefined;
};
const hasFlag = name => args.includes(name);

const outDir = flag("--out-dir") ?? args.find(a => !a.startsWith("-")) ?? "evaluation-output";
const stamp = hasFlag("--stamp");
const includeLocal = hasFlag("--include-local");

async function loadCorporaFromNode(mod, rootDir = "fixtures/eval") {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const corpusDirs = entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b));

  const corpora = [];
  for (const corpusId of corpusDirs) {
    const corpusDir = join(rootDir, corpusId);
    const docsDir = join(corpusDir, "docs");
    const docFiles = (await readdir(docsDir))
      .filter(f => f.endsWith(".md"))
      .sort((a, b) => a.localeCompare(b));

    const documents = [];
    for (const file of docFiles) {
      const id = file.slice(0, -extname(file).length);
      const content = await readFile(join(docsDir, file), "utf8");
      documents.push({ id, path: `${corpusId}/docs/${file}`, content });
    }

    const queriesRaw = await readFile(join(corpusDir, "queries.tsv"), "utf8");
    const qrelsRaw = await readFile(join(corpusDir, "qrels.tsv"), "utf8");
    corpora.push(mod.buildCorpusFixture(corpusId, documents, queriesRaw, qrelsRaw));
  }
  return corpora;
}

async function main() {
  const server = await createServer({
    server: { middlewareMode: true },
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true },
  });

  try {
    const mod = await server.ssrLoadModule("/src/retrieval/eval/runner.js");
    const corpora = await loadCorporaFromNode(mod);
    let configs = mod.DEFAULT_QUALITY_CONFIGS;
    if (includeLocal) {
      const localMod = await server.ssrLoadModule(
        "/src/retrieval/providers/LocalEmbeddingProvider.js",
      );
      const sharedLocal = new localMod.LocalEmbeddingProvider();
      await sharedLocal.embed("warmup");
      console.log(
        `LocalEmbeddingProvider backend: ${sharedLocal.getBackend()} (model: ${sharedLocal.getOnnxModel()})`,
      );
      configs = [...mod.DEFAULT_QUALITY_CONFIGS, ...mod.createLocalQualityConfigs(() => sharedLocal)];
    }
    const report = await mod.runQualityEval({
      corpora,
      configs,
      ...(stamp ? { stamp: true } : {}),
    });
    const markdown = mod.buildQualityMarkdown(report);

    await mkdir(outDir, { recursive: true });
    const jsonPath = resolve(outDir, "quality.json");
    const mdPath = resolve(outDir, "quality.md");

    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(mdPath, `${markdown.trimEnd()}\n`, "utf8");

    console.log("AutoSD retrieval quality evaluation (provisional maintainer judgments)");
    console.log(
      "Config                       | Queries |  R@1   |  R@5   |  R@10  | MRR@10 | nDCG@10",
    );
    console.log(
      "-----------------------------|---------|--------|--------|--------|--------|--------",
    );
    for (const [id, m] of Object.entries(report.macroOverall)) {
      console.log(
        `${id.padEnd(28)} | ${String(m.queryCount).padStart(7)} | ${m.recallAt1.toFixed(4)} | ${m.recallAt5.toFixed(4)} | ${m.recallAt10.toFixed(4)} | ${m.mrrAt10.toFixed(4)} | ${m.ndcgAt10.toFixed(4)}`,
      );
    }
    console.log(`Artifacts written:\n  ${jsonPath}\n  ${mdPath}`);
  } finally {
    await server.close();
  }
}

await main();
