import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  AutoSDMCPServer,
  handleStdioLine,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
} from "../../src/mcp/server.js";

function parseToolPayload(res: { result?: unknown } | null): Record<string, unknown> {
  const result = res?.result as { content?: Array<{ text: string }>; isError?: boolean };
  expect(result?.content?.[0]?.text).toBeDefined();
  return JSON.parse(result.content![0].text) as Record<string, unknown>;
}

describe("AutoSD Zero-Dependency MCP Server", () => {
  it("handles MCP initialize, notifications, ping, and tools/list", async () => {
    const server = new AutoSDMCPServer();

    const init = await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(init?.error).toBeUndefined();
    expect(init?.result).toMatchObject({
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: MCP_SERVER_NAME },
    });

    // Notification without id produces no response
    const notif = await server.handleMessage({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(notif).toBeNull();

    const ping = await server.handleMessage({ jsonrpc: "2.0", id: 2, method: "ping" });
    expect(ping?.result).toEqual({});

    const list = await server.handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    const tools = (list?.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map(t => t.name)).toEqual([
      "autosd_ingest",
      "autosd_search",
      "autosd_list_documents",
      "autosd_encode_braille",
      "autosd_decode_braille",
    ]);
  });

  it("ingests documents, lists corpus, returns grounded citations, and abstains on out-of-domain queries", async () => {
    const server = new AutoSDMCPServer();

    const ingestRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "autosd_ingest",
        arguments: {
          documents: [
            {
              id: "braille-hw",
              path: "braille-hw.md",
              content:
                "Piezoelectric actuators raise tactile braille pins on 40-cell refreshable displays.",
            },
            {
              id: "wcag-guide",
              path: "wcag.md",
              content: "WCAG 2.2 AA mandates logical heading outlines and polite aria-live status.",
            },
          ],
        },
      },
    });
    const ingested = parseToolPayload(ingestRes);
    expect(ingested.ingested).toBe(2);
    expect(ingested.totalDocuments).toBe(2);

    const listRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "autosd_list_documents", arguments: {} },
    });
    const listed = parseToolPayload(listRes);
    expect(listed.count).toBe(2);

    // In-domain query returns grounded citations
    const hitRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: {
        name: "autosd_search",
        arguments: { question: "piezoelectric braille pins 40-cell" },
      },
    });
    const hit = parseToolPayload(hitRes);
    expect(hit.abstained).toBe(false);
    expect(Array.isArray(hit.citations) && hit.citations.length).toBeGreaterThan(0);

    // Out-of-domain query abstains cleanly by default
    const oodRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: {
        name: "autosd_search",
        arguments: { question: "sourdough fermentation starter hydration percentage" },
      },
    });
    const ood = parseToolPayload(oodRes);
    expect(ood.abstained).toBe(true);
    expect(ood.citations).toEqual([]);
    expect(ood.confidence).toBe(0);
  });

  it("encodes and round-trip decodes UEB Grade 1 and Grade 2 Braille including line wrapping", async () => {
    const server = new AutoSDMCPServer();

    const g2EncRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: "autosd_encode_braille",
        arguments: {
          text: "The people can read with knowledge",
          cellCount: 40,
          grade: 2,
        },
      },
    });
    const g2Enc = parseToolPayload(g2EncRes);
    expect(g2Enc.grade).toBe(2);
    expect(typeof g2Enc.unicode).toBe("string");

    const g2DecRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: {
        name: "autosd_decode_braille",
        arguments: { unicode: g2Enc.unicode, grade: 2 },
      },
    });
    expect(parseToolPayload(g2DecRes).text).toBe("The people can read with knowledge");

    const wrappedRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 22,
      method: "tools/call",
      params: {
        name: "autosd_encode_braille",
        arguments: {
          text: "Refreshable braille displays wrap cleanly across 20-cell lines.",
          cellCount: 20,
          grade: 1,
          wrapLines: true,
        },
      },
    });
    const wrapped = parseToolPayload(wrappedRes);
    expect(Number(wrapped.lineCount)).toBeGreaterThan(1);
  });

  it("returns standard JSON-RPC errors and tool validation errors cleanly", async () => {
    const server = new AutoSDMCPServer();
    const out: string[] = [];

    // Parse error (-32700)
    await handleStdioLine(server, "{not-valid-json", line => out.push(line));
    expect(JSON.parse(out[0]).error.code).toBe(-32700);

    // Method not found (-32601)
    await handleStdioLine(
      server,
      JSON.stringify({ jsonrpc: "2.0", id: 99, method: "unknown/method" }),
      line => out.push(line),
    );
    expect(JSON.parse(out[1]).error.code).toBe(-32601);

    // Unknown tool
    const badTool = await server.handleMessage({
      jsonrpc: "2.0",
      id: 100,
      method: "tools/call",
      params: { name: "does_not_exist", arguments: {} },
    });
    expect((badTool?.result as { isError?: boolean }).isError).toBe(true);

    // Empty ingest documents rejected
    const badIngest = await server.handleMessage({
      jsonrpc: "2.0",
      id: 101,
      method: "tools/call",
      params: { name: "autosd_ingest", arguments: { documents: [] } },
    });
    expect((badIngest?.result as { isError?: boolean }).isError).toBe(true);
  });

  it("spawns scripts/autosd-mcp.mjs over stdio with --corpus preload and answers JSON-RPC", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autosd-mcp-"));
    try {
      await writeFile(
        join(dir, "guide.md"),
        "AutoSD stdio MCP server indexes local documents with zero external dependencies.",
        "utf8",
      );

      const responses = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const child = spawn(process.execPath, ["scripts/autosd-mcp.mjs", "--corpus", dir], {
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdoutBuf = "";
        let stderrBuf = "";
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error(`MCP subprocess timeout. stderr=${stderrBuf}`));
        }, 15_000);

        child.stdout.on("data", chunk => {
          stdoutBuf += String(chunk);
          const lines = stdoutBuf.split(/\r?\n/).filter(Boolean);
          if (lines.length >= 2) {
            clearTimeout(timer);
            child.stdin.end();
            resolve(lines.map(l => JSON.parse(l) as Record<string, unknown>));
          }
        });
        child.stderr.on("data", chunk => {
          stderrBuf += String(chunk);
        });
        child.on("error", err => {
          clearTimeout(timer);
          reject(err);
        });

        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })}\n` +
            `${JSON.stringify({
              jsonrpc: "2.0",
              id: 2,
              method: "tools/call",
              params: {
                name: "autosd_search",
                arguments: { question: "zero external dependencies stdio MCP" },
              },
            })}\n`,
        );
      });

      expect(responses).toHaveLength(2);
      expect(responses[0].id).toBe(1);
      const searchResult = parseToolPayload(responses[1]);
      expect(searchResult.abstained).toBe(false);
      expect(String(searchResult.answer)).toContain("AutoSD stdio MCP server");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
