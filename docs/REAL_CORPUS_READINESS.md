# Real-Corpus Readiness

How to replace synthetic fixtures with a legitimate corpus without redesigning retrieval. Synthetic hardness (`T11`) and real-corpus evaluation are separate concerns.

## What synthetic hardness is (current)

`T11-RETRIEVAL-HARDNESS` uses `HARDNESS_FIXTURES` (9 synthetic subchecks) to stress the pipeline deterministically: similar terminology, distractor, overlapping concepts, contradictory docs, renamed sections, changed versions, deleted/replaced, citation correctness, stale snapshot. It proves the **mechanics** of retrieval, not the quality on your data. Scores remain ranks, never calibrated probabilities.

## What real-corpus readiness means

A contributor should be able to point AutoSD at their own legitimate corpus and get the same guarantees without code changes:

| Step                             | How                                                                                                                                                                                             | Where to look                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Ingestion**                    | Drop `.md`/`.txt`/`.json` into `corpus/docs/` while `npm run dev` runs, or call `workflow.ingest(docs)` programmatically.                                                                       | `src/retrieval/chunker.ts` (chunkSize 800, overlap 120, deterministic) |
| **Snapshotting / hashing**       | `SnapshotIndex.index(docs)` hash-diffs via `hashContent` — unchanged docs are never re-embedded. `snapshotHash()` and `getManifest().version` track the corpus.                                 | `src/retrieval/snapshot.ts`                                            |
| **Hashing**                      | `hashContent` (SHA-256 of content) drives incremental detection; `hashDocument` per doc.                                                                                                        | `src/retrieval/chunker.ts`                                             |
| **Chunking**                     | `chunkDocument(doc, {chunkSize, overlap})` — deterministic, no network.                                                                                                                         | `src/retrieval/chunker.ts`                                             |
| **Embedding provider selection** | `VITE_EMBEDDING_PROVIDER=mock` (default, offline) / `local` (transformers.js wrapper) / `openai` (server-side key only). Switch via `.env`; `MockEmbeddingProvider` is deterministic for tests. | `src/retrieval/providers/` + `src/app/config.ts`                       |
| **Reranking**                    | Optional `reranker` hook after RRF fusion (k=60); synthetic tests pass without it.                                                                                                              | `src/retrieval/reranker.ts`                                            |
| **Citations**                    | `ResearchWorkflow.run()` returns `citations[]` with `documentId`, `chunkId` (starts with `documentId`), `score`, `content` slice.                                                               | `src/workflows/research.ts`                                            |
| **Corpus updates**               | `CorpusWatcher` debounces `add/modify/delete` (150 ms) and drives `LiveSync` → `ingest` → `saveToDisk`.                                                                                         | `src/retrieval/CorpusWatcher.ts`, `src/app/LiveSync.ts`                |
| **Deleted documents**            | `SnapshotIndex.index()` returns `removed` chunks; `ResearchWorkflow.ingest()` drops them from the pipeline. Tested in `T11` subcheck `deleted-replaced`.                                        | `src/retrieval/snapshot.ts`, `T11`                                     |
| **Reproducibility**              | Same corpus + same provider → same `snapshotHash()` and `manifest.version`; `npm run evaluate` reports only counts/versions, never contents.                                                    | `evaluation.ts` `SYNTHETIC_CORPUS` vs your `corpus/`                   |
| **Evaluation artifacts**         | `npm run evaluate` already isolates synthetic fixtures from your `corpus/` — run it after plugging in a real corpus to see task deltas; do not mix synthetic and real counts in one claim.      | `src/app/evaluation.ts`                                                |

## How to plug in a real corpus (no redesign)

1. Add files to `corpus/docs/` or construct `Document[]` with `{id, path, content}`.
2. `await workflow.ingest(yourDocs)` — same API as synthetic.
3. `await workflow.run({id, question})` — same API; citations now point to your docs.
4. `npm run evaluate` still runs on synthetic fixtures — keep it separate; for real-corpus quality, run your own queries and inspect citations manually, then file a `research` issue with the synthetic-vs-real distinction explicit.

## Separation rule

- **Synthetic retrieval hardness (`T11`):** proves the pipeline mechanics are sound. Label `SOFTWARE-VERIFIED`.
- **Real-corpus retrieval evaluation:** proves quality on your data. Requires a frozen real corpus, hand-judged relevance, and a `research` issue — label `EXTERNAL EVALUATION REQUIRED`, never auto-merge.

Do not turn retrieval scores into calibrated probabilities — keep the distinction `retrieval score ≠ truth probability` in every report.
