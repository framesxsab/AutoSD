#!/usr/bin/env node
/**
 * autosd-mcp.mjs — Local-first zero-dependency stdio MCP server entrypoint.
 *
 * Usage:
 *   npm run mcp
 *   node scripts/autosd-mcp.mjs --corpus ./corpus/docs
 *
 * Reads newline-delimited JSON-RPC 2.0 requests from stdin and writes
 * responses to stdout. Diagnostics go strictly to stderr.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
};
const corpusDir = flag("--corpus");

async function loadMcpModule() {
  const builtPath = resolve(import.meta.dirname, "..", "dist", "src", "mcp", "server.js");
  if (existsSync(builtPath)) {
    return { mod: await import(pathToFileURL(builtPath).href), close: async () => {} };
  }
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true },
  });
  const mod = await vite.ssrLoadModule("/src/mcp/server.js");
  return { mod, close: () => vite.close() };
}

async function preloadCorpus(server, dir) {
  const absDir = resolve(dir);
  const entries = await readdir(absDir, { withFileTypes: true });
  const allowed = new Set([".md", ".txt", ".json"]);
  const docs = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    if (!allowed.has(ext)) continue;
    const content = await readFile(join(absDir, entry.name), "utf8");
    const id = entry.name.slice(0, -ext.length) || entry.name;
    docs.push({ id, path: entry.name, content });
  }
  if (docs.length > 0) {
    await server.workflow.ingest(docs);
    process.stderr.write(`[autosd-mcp] preloaded ${docs.length} documents from ${absDir}\n`);
  }
}

async function main() {
  const { mod, close } = await loadMcpModule();
  const server = new mod.AutoSDMCPServer();

  if (corpusDir) {
    try {
      await preloadCorpus(server, corpusDir);
    } catch (err) {
      process.stderr.write(
        `[autosd-mcp] failed to preload corpus from ${corpusDir}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const queue = [];
  let processing = false;

  const drain = async () => {
    if (processing) return;
    processing = true;
    while (queue.length > 0) {
      const line = queue.shift();
      await mod.handleStdioLine(server, line, json => {
        process.stdout.write(`${json}\n`);
      });
    }
    processing = false;
  };

  rl.on("line", line => {
    queue.push(line);
    void drain();
  });

  rl.on("close", () => {
    void drain().finally(() => close());
  });
}

await main();
