# AutoSD Local MCP Server (`autosd-mcp`)

AutoSD ships a **zero-dependency, local-first Model Context Protocol (MCP) server** over JSON-RPC 2.0 stdio transport. It exposes AutoSD's hybrid retrieval engine (BM25 + `LexicalHashEmbeddingProvider` + `LexicalReranker` + low-evidence abstention) and UEB Grade 1/2 Braille tools directly to any MCP-compatible AI agent or terminal client — with zero network calls and zero runtime dependencies.

## Quick Start

Build once (recommended for instant startup) and run:

```bash
npm run build
npm run mcp
```

To pre-index a local directory of `.md`, `.txt`, or `.json` files on startup:

```bash
node scripts/autosd-mcp.mjs --corpus ./corpus/docs
```

## Client Configuration (`mcp_config.json`)

Add AutoSD to any MCP client (Antigravity, Claude Code, Cursor, etc.):

```json
{
  "mcpServers": {
    "autosd": {
      "command": "node",
      "args": ["/absolute/path/to/AutoSD/scripts/autosd-mcp.mjs", "--corpus", "/path/to/your/docs"]
    }
  }
}
```

## Available Tools

| Tool                    | Description                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `autosd_ingest`         | Ingest up to 200 local documents (`id`, `path?`, `content`) into the hybrid BM25 + vector index.                                                                             |
| `autosd_search`         | Run grounded hybrid/BM25/vector retrieval with `abstainOnLowEvidence` (default `true`) returning `answer`, `abstained`, `confidence`, and `citations[]`.                     |
| `autosd_list_documents` | List indexed documents (`id`, `path`, `length`).                                                                                                                             |
| `autosd_encode_braille` | Encode plain text to UEB Grade 1 (default) or Grade 2 contracted Unicode Braille (`U+2800..U+283F`), with optional `wrapLines` for physical display widths (`8..160` cells). |
| `autosd_decode_braille` | Decode UEB Grade 1 or Grade 2 Unicode Braille back to plain text.                                                                                                            |

## Privacy & Security Guarantees

- **100% local:** No external API calls, no telemetry, no credentials required.
- **Bounded inputs:** Document count, document size, and braille text length are bounded per call to prevent memory exhaustion.
- **Pure stdio framing:** Only JSON-RPC 2.0 responses are written to `stdout`; diagnostics are written strictly to `stderr`.
