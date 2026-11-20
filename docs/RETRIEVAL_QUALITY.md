# Retrieval Quality Harness & Internal Ablation

AutoSD ships an offline, deterministic retrieval-quality harness (`npm run eval:quality`) paired with a non-regression baseline gate (`npm run eval:quality:gate`).

> **Honesty notice:** All relevance judgments in `fixtures/eval/` carry `judgmentProvenance: "maintainer-authored-provisional"`. Numbers below measure internal AutoSD retrieval configurations against frozen in-repo fixtures only and must **not** be cited as external or comparative benchmarks.

## Running the harness

```bash
npm run eval:quality        # produces evaluation-output/quality.json and quality.md
npm run eval:quality:gate   # verifies quality.json against quality.baseline.json
```

Passing `--stamp` includes an ISO `generatedAt` timestamp; by default output is omitted so consecutive runs produce byte-identical JSON.

## Frozen corpora & judgments (`fixtures/eval/`)

| Corpus                    | Docs | Queries | Corpus hash        | Qrels hash         | Source / domain                                                      |
| ------------------------- | ---: | ------: | ------------------ | ------------------ | -------------------------------------------------------------------- |
| `accessibility-standards` |   10 |      16 | `a794f5fca598396c` | `81df2657b8758a4f` | Original ASCII accessibility-standard summaries (MIT)                |
| `demo`                    |    4 |       8 | `9f19bb896067180e` | `2ba53c7814b7c6c0` | Exact `DEMO_CORPUS` docs from `src/app/demo.ts`                      |
| `tactile-history`         |   10 |      16 | `f434149ada8f5acc` | `8781f078e6536d29` | Original ASCII tactile-reading history & engineering summaries (MIT) |

Each corpus splits queries evenly across four categories: `lexical` (shared terms), `paraphrase` (synonymous phrasing), `typo` (spelling variations), and `multi-doc` (multiple relevant sources). Judgments in `qrels.tsv` are document-level grades in `{0, 1, 2, 3}`. Ranked chunks collapse to distinct `documentId`s by first-seen rank order so metrics remain invariant across chunk sizes.

Adding a query or corpus:

1. Add `docs/*.md`, `queries.tsv`, `qrels.tsv`, and `PROVENANCE.md` under `fixtures/eval/<corpusId>/`.
2. Run `npm run eval:quality` and inspect `evaluation-output/quality.md`.
3. Update `quality.baseline.json` intentionally only after reviewing changes.

## Measured internal ablation (40 queries, unweighted across 3 corpora)

| Config                       |    R@1 |    R@5 |   R@10 |    P@5 | MRR@10 | nDCG@5 | nDCG@10 |
| ---------------------------- | -----: | -----: | -----: | -----: | -----: | -----: | ------: |
| `bm25`                       | 0.4774 | 0.8993 | 0.8993 | 0.3917 | 0.9305 | 0.9124 |  0.9124 |
| `vector:mock`                | 0.1771 | 0.7257 | 0.8489 | 0.3292 | 0.5856 | 0.5269 |  0.5799 |
| `hybrid:mock`                | 0.4323 | 0.9028 | 0.9531 | 0.3958 | 0.9156 | 0.8526 |  0.8624 |
| `vector:lexical-hash`        | 0.4253 | 0.9288 | 0.9844 | 0.4083 | 0.9052 | 0.8846 |  0.8915 |
| `hybrid:lexical-hash`        | 0.4774 | 0.9254 | 0.9792 | 0.4083 | 0.9549 | 0.9444 |  0.9495 |
| `hybrid:lexical-hash+rerank` | 0.4965 | 0.9149 | 0.9844 | 0.4042 | 0.9896 | 0.9616 |  0.9721 |

## What these numbers show

1. **Whole-string mock vectors degrade BM25 under RRF.** `MockEmbeddingProvider` (`VITE_EMBEDDING_PROVIDER=mock`) hashes the full string with FNV-1a to seed a PRNG, so `vector:mock` carries no lexical or semantic signal (`nDCG@10 = 0.5799`). Fusing those noisy ranks equally in `hybrid:mock` drops `nDCG@10` from `0.9124` (`bm25`) down to `0.8624` and drops `R@1` from `0.4774` to `0.4323`. `MockEmbeddingProvider` stays untouched as the default fallback for deterministic fixture/demo compatibility (`demoVersion: 2`).
2. **`LexicalHashEmbeddingProvider` (`VITE_EMBEDDING_PROVIDER=lexical`) eliminates that regression offline.** By hashing normalized word tokens plus padded character 3-grams into a 384-d unit vector, `vector:lexical-hash` jumps to `nDCG@10 = 0.8915` and `hybrid:lexical-hash` beats `bm25` across `R@5`, `R@10`, `MRR@10`, `nDCG@5`, and `nDCG@10` (`0.9495` vs `0.9124`). Adding `LexicalReranker` reaches `nDCG@10 = 0.9721` and `MRR@10 = 0.9896`.
3. **What remains unmeasured:** dense neural embeddings (`LocalEmbeddingProvider` ONNX completion in v1.1 M3), large real-world corpora, and independently peer-reviewed relevance judgments.
