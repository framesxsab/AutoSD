# Retrieval Engine — v0.4

## Pipeline

```
Document → chunkDocument() → Chunk[]
                              ↓
                         EmbeddingProvider.embedMany()
                              ↓
                    ┌──── BM25Index ────┐
Query ─────────────────────────────┼──── Hybrid Merge (RRF k=60) ─► Reranker ─► Top-K
                    └──── VectorSearch ─┘              (EmbeddingReranker | LexicalReranker)
                                   cosineSimilarity
```

- **Chunker:** `chunkSize=800`, `overlap=120`, respects sentence/line boundaries. Hash per chunk via `sha256` (16 hex). Empty docs → 0 chunks.
- **BM25:** `k1=1.2`, `b=0.75`, tokenizer `/[^a-z0-9]+/`, IDF `log(1+(N-df+0.5)/(df+0.5))`, length norm `1-b+b*dl/avgLen`.
- **Embedding:** `EmbeddingProvider` interface (`embed`, `embedMany`, `dimensions`, `model`, `id`). DI token `embedding:provider`.
- **Hybrid Merge:** Reciprocal Rank Fusion — `score = Σ w/(k+rank)` with `k=60`, `vectorWeight`/`bm25Weight` configurable.
- **Rerank:** `EmbeddingReranker` (cosine vs query embedding) or `LexicalReranker` (exact-term boost).

All provider interfaces are swappable via `DIContainer.hotSwap("embedding:provider", ...)`, mirroring `DeviceManager` / `PluginRegistry`.

## Providers

| Provider                  | Id       | Model                    | Dimensions | Notes                                                                                     |
| ------------------------- | -------- | ------------------------ | ---------- | ----------------------------------------------------------------------------------------- |
| `MockEmbeddingProvider`   | `mock`   | `mock-384`               | 384        | FNV-1a seeded PRNG → normalized; deterministic, **required for CI**; no fabricated random |
| `LocalEmbeddingProvider`  | `local`  | `local-bge-small`        | 384        | Wraps mock with `[local]` prefix; future onnx/transformers.js drop-in                     |
| `OpenAIEmbeddingProvider` | `openai` | `text-embedding-3-small` | 1536       | `OPENAI_API_KEY` required; `isConfigured()` guard; fetch batch                            |

## Snapshot Indexing

- **Document hash:** `sha256(content)[0..16]` via `hashContent`.
- **Incremental:** `SnapshotIndex.index(docs)` diffs `documentHashes`; added = new/changed, removed = missing ids, unchanged = same hash. **Never re-embeds unchanged files.**
- **Manifest:** versioned via `nextVersion` (patch bump `1.0.0` → `1.0.1`), stores `version`, `createdAt`, `updatedAt`, `chunkCount`, `documentCount`, `documents[]`, `config{ chunkSize, overlap, embeddingModel }`.
- **Snapshot hash:** `sha256(sorted(id:hash).join("|"))[0..16]` — reproducible session fingerprint.

### IndexManifest JSON

```json
{
  "version": "1.0.3",
  "createdAt": "2026-08-25T11:00:00.000Z",
  "updatedAt": "2026-08-25T11:02:00.000Z",
  "chunkCount": 42,
  "documentCount": 5,
  "documents": [
    {
      "id": "d1",
      "path": "/docs/a.md",
      "hash": "abc123...",
      "chunkIds": ["d1#0", "d1#1"],
      "indexedAt": "2026-08-25T11:02:00.000Z"
    }
  ],
  "config": { "chunkSize": 800, "overlap": 120, "embeddingModel": "mock-384" }
}
```

### ResearchWorkspace Integration

`ResearchWorkflow` now owns `SnapshotIndex` + `RetrievalPipeline`:

- `ingest(docs)` → incremental index + pipeline sync → `{added, removed, chunkCount, manifestVersion}`
- `run({id, question})` → `pipeline.search(question)` → `citations[]` with `source/chunkId/documentId/content/score`, `confidence = clamp(maxScore)`, reproducible `session{ id, query, manifest:{version,snapshotHash}, topK, createdAt }`
- `exportSession(id)` → JSON; `exportLastSession()`; `listSessions()`; `clear()`
- DI: resolves `embedding:provider` token if present, else `MockEmbeddingProvider`.
- Backward compat: empty corpus falls back to stubbed `corpus-1` citation with `confidence 0.1`.

No backend, no database, local file indexing only. Mock provider is default for CI.
