/**
 * AutoSD Zero-Dependency MCP (Model Context Protocol) Server.
 *
 * Exposes AutoSD's local-first hybrid retrieval (with low-evidence abstention)
 * and UEB Grade 1/2 Braille tools over JSON-RPC 2.0 stdio transport with zero
 * runtime dependencies and zero network calls.
 */
import { ResearchWorkflow } from "../workflows/research.js";
import { LexicalHashEmbeddingProvider } from "../retrieval/providers/LexicalHashEmbeddingProvider.js";
import type { RetrievalMode } from "../retrieval/pipeline.js";
import {
  brailleToText,
  textToBraille,
  wrapTextToBrailleLines,
  type BrailleGrade,
} from "../workflows/tactile.js";

export const MCP_PROTOCOL_VERSION = "2024-11-05";
export const MCP_SERVER_NAME = "autosd";
export const MCP_SERVER_VERSION = "1.2.0";

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  readonly jsonrpc: "2.0";
  readonly id?: JsonRpcId;
  readonly method: string;
  readonly params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
};

export type MCPToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
};

export type AutoSDMCPServerOptions = {
  readonly workflow?: ResearchWorkflow;
  readonly serverVersion?: string;
};

const MAX_INGEST_DOCS = 200;
const MAX_DOC_CHARS = 250_000;
const MAX_BRAILLE_TEXT_CHARS = 10_000;

export const MCP_TOOLS: readonly MCPToolDefinition[] = [
  {
    name: "autosd_ingest",
    description:
      "Ingest one or more local text/markdown documents into AutoSD's hybrid BM25 + vector index.",
    inputSchema: {
      type: "object",
      properties: {
        documents: {
          type: "array",
          description: "Array of documents to ingest (max 200 per call).",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique document identifier." },
              path: { type: "string", description: "Optional display path or title." },
              content: { type: "string", description: "Document text content." },
            },
            required: ["id", "content"],
          },
        },
      },
      required: ["documents"],
    },
  },
  {
    name: "autosd_search",
    description:
      "Search the indexed local corpus with hybrid BM25 + lexical-hash vector retrieval and optional low-evidence abstention.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Natural-language query or keywords." },
        mode: {
          type: "string",
          enum: ["hybrid", "bm25", "vector"],
          description: "Retrieval mode (default: hybrid).",
        },
        abstainOnLowEvidence: {
          type: "boolean",
          description:
            "Return abstained: true with empty citations when evidence is weak (default: true).",
        },
        minVectorScore: {
          type: "number",
          description: "Minimum cosine score required when BM25 has zero hits (default: 0.45).",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "autosd_list_documents",
    description: "List all documents currently indexed in the local AutoSD corpus.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "autosd_encode_braille",
    description:
      "Encode plain text into UEB Grade 1 (default) or Grade 2 contracted Unicode Braille Patterns.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Plain text to encode." },
        cellCount: {
          type: "integer",
          description: "Display cell width (default: 40, range 8..160).",
        },
        grade: {
          type: "integer",
          enum: [1, 2],
          description: "UEB Braille grade: 1 (uncontracted) or 2 (contracted). Default: 1.",
        },
        wrapLines: {
          type: "boolean",
          description: "If true, word-wrap into multiple display-width braille lines.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "autosd_decode_braille",
    description: "Decode UEB Grade 1 or Grade 2 Unicode Braille Patterns back into plain text.",
    inputSchema: {
      type: "object",
      properties: {
        unicode: { type: "string", description: "Unicode Braille string (U+2800..U+283F)." },
        grade: {
          type: "integer",
          enum: [1, 2],
          description: "UEB Braille grade used during encoding (default: 1).",
        },
      },
      required: ["unicode"],
    },
  },
];

function toolSuccess(payload: unknown): { content: [{ type: "text"; text: string }] } {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function toolError(message: string): {
  content: [{ type: "text"; text: string }];
  isError: true;
} {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export class AutoSDMCPServer {
  readonly workflow: ResearchWorkflow;
  private readonly serverVersion: string;
  private queryCounter = 0;

  constructor(opts: AutoSDMCPServerOptions = {}) {
    this.serverVersion = opts.serverVersion ?? MCP_SERVER_VERSION;
    this.workflow =
      opts.workflow ??
      new ResearchWorkflow({
        provider: new LexicalHashEmbeddingProvider(),
        reranker: true,
        abstainOnLowEvidence: true,
      });
  }

  /**
   * Handle a single parsed JSON-RPC 2.0 message.
   * Returns `null` for notifications (requests without `id`).
   */
  async handleMessage(msg: unknown): Promise<JsonRpcResponse | null> {
    if (!msg || typeof msg !== "object") {
      return {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid JSON-RPC request" },
      };
    }

    const req = msg as Partial<JsonRpcRequest>;
    const hasId = req.id !== undefined;
    const id: JsonRpcId = req.id ?? null;

    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
      return hasId
        ? { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid JSON-RPC 2.0 envelope" } }
        : null;
    }

    // Notifications (no id) produce no response
    if (!hasId) {
      return null;
    }

    try {
      switch (req.method) {
        case "initialize":
          return {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: MCP_PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: {
                name: MCP_SERVER_NAME,
                version: this.serverVersion,
              },
            },
          };

        case "ping":
          return { jsonrpc: "2.0", id, result: {} };

        case "tools/list":
          return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };

        case "tools/call": {
          const params = req.params ?? {};
          const name = typeof params.name === "string" ? params.name : "";
          const args =
            params.arguments && typeof params.arguments === "object"
              ? (params.arguments as Record<string, unknown>)
              : {};
          const result = await this.callTool(name, args);
          return { jsonrpc: "2.0", id, result };
        }

        default:
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Method not found: ${req.method}` },
          };
      }
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : "Internal server error",
        },
      };
    }
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "autosd_ingest": {
        if (!Array.isArray(args.documents) || args.documents.length === 0) {
          return toolError("Expected non-empty 'documents' array.");
        }
        if (args.documents.length > MAX_INGEST_DOCS) {
          return toolError(`Too many documents (max ${MAX_INGEST_DOCS} per call).`);
        }
        const docs: { id: string; path: string; content: string }[] = [];
        for (const raw of args.documents) {
          if (!raw || typeof raw !== "object") {
            return toolError("Each document must be an object with 'id' and 'content'.");
          }
          const rec = raw as Record<string, unknown>;
          const docId = typeof rec.id === "string" ? rec.id.trim() : "";
          const content = typeof rec.content === "string" ? rec.content : "";
          if (!docId || docId.length > 128) {
            return toolError("Each document requires a non-empty 'id' (<= 128 chars).");
          }
          if (content.length > MAX_DOC_CHARS) {
            return toolError(`Document "${docId}" exceeds max length (${MAX_DOC_CHARS} chars).`);
          }
          const docPath = typeof rec.path === "string" && rec.path.trim() ? rec.path.trim() : docId;
          docs.push({ id: docId, path: docPath, content });
        }
        const stats = await this.workflow.ingest(docs);
        return toolSuccess({
          ingested: docs.length,
          totalDocuments: this.workflow.listDocuments().length,
          added: stats.added,
          removed: stats.removed,
          chunkCount: stats.chunkCount,
          manifestVersion: stats.manifestVersion,
        });
      }

      case "autosd_search": {
        const question = typeof args.question === "string" ? args.question.trim() : "";
        if (!question) {
          return toolError("Expected non-empty 'question' string.");
        }
        const mode: RetrievalMode | undefined =
          args.mode === "hybrid" || args.mode === "bm25" || args.mode === "vector"
            ? args.mode
            : undefined;
        const abstainOnLowEvidence =
          typeof args.abstainOnLowEvidence === "boolean" ? args.abstainOnLowEvidence : true;
        const minVectorScore =
          typeof args.minVectorScore === "number" && Number.isFinite(args.minVectorScore)
            ? args.minVectorScore
            : undefined;

        this.queryCounter += 1;
        const res = await this.workflow.run({
          id: `mcp-q-${this.queryCounter}`,
          question,
          mode,
          abstainOnLowEvidence,
          minVectorScore,
        });
        return toolSuccess({
          answer: res.answer,
          abstained: Boolean(res.abstained),
          confidence: res.confidence,
          citations: res.citations,
        });
      }

      case "autosd_list_documents": {
        const docs = this.workflow.listDocuments().map(d => ({
          id: d.id,
          path: d.path ?? d.id,
          length: d.content.length,
        }));
        return toolSuccess({ count: docs.length, documents: docs });
      }

      case "autosd_encode_braille": {
        const text = typeof args.text === "string" ? args.text : null;
        if (text === null) {
          return toolError("Expected 'text' string.");
        }
        if (text.length > MAX_BRAILLE_TEXT_CHARS) {
          return toolError(`Text exceeds max length (${MAX_BRAILLE_TEXT_CHARS} chars).`);
        }
        const rawCells =
          typeof args.cellCount === "number" && Number.isFinite(args.cellCount)
            ? Math.floor(args.cellCount)
            : 40;
        const cellCount = Math.max(8, Math.min(160, rawCells));
        const grade: BrailleGrade = args.grade === 2 ? 2 : 1;
        const wrapLines = args.wrapLines === true;

        if (wrapLines) {
          const lines = wrapTextToBrailleLines(text, cellCount, { grade }).map(l => ({
            unicode: l.unicode,
            activeCells: l.activeCells,
            sourceText: l.sourceText,
          }));
          return toolSuccess({ grade, cellCount, lineCount: lines.length, lines });
        }
        const encoded = textToBraille(text, cellCount, { grade });
        return toolSuccess({
          grade,
          cellCount,
          activeCells: encoded.activeCells,
          unicode: encoded.unicode,
          displayUnicode: encoded.displayUnicode,
        });
      }

      case "autosd_decode_braille": {
        const unicode = typeof args.unicode === "string" ? args.unicode : null;
        if (unicode === null) {
          return toolError("Expected 'unicode' braille string.");
        }
        const grade: BrailleGrade = args.grade === 2 ? 2 : 1;
        return toolSuccess({
          grade,
          text: brailleToText(unicode, { grade }),
        });
      }

      default:
        return toolError(`Unknown tool: ${name}`);
    }
  }
}

/**
 * Process a stream of newline-delimited JSON-RPC lines, writing responses
 * via `writeLine`. Malformed JSON lines return a standard `-32700` Parse Error.
 */
export async function handleStdioLine(
  server: AutoSDMCPServer,
  line: string,
  writeLine: (json: string) => void,
): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    writeLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      }),
    );
    return;
  }
  const response = await server.handleMessage(parsed);
  if (response !== null) {
    writeLine(JSON.stringify(response));
  }
}
