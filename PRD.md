# PRD — AutoSD v1.x (reflects existing implementation + v1.1 plan)

> Status: `Accepted` — §1–§13 describe the system **as built** on the v1.0 line (`package.json` 1.0.0 plus post-release adoption work). §14 is the forward roadmap. Every capability status here is the one recorded in [docs/CAPABILITY_MATRIX.md](docs/CAPABILITY_MATRIX.md); if they ever disagree, the matrix wins and this file is the bug.
>
> The v0.3.0 PRD is archived at [docs/history/PRD-v0.3.0.md](docs/history/PRD-v0.3.0.md).

---

## 1. Vision

AutoSD is a **plugin-first, device-agnostic platform** that turns a local document corpus into grounded, citation-backed answers and renders text through any tactile/display device — real hardware (`HIDDevice`), a simulator (`VirtualDevice`), or a deterministic fixture (`MockDevice`).

**One API, every device:** authors write workflows once; operators swap devices and embedding providers without rewriting features; accessibility thresholds come from one shared module.

**Non-goals:** not a hardware driver suite, not a hosted SaaS (no backend, no database, no accounts — state is plain JSON under `corpus/`), and not a claim of proven tactile readability.

## 2. Problem statement

- **Device fragmentation** — heterogeneous tactile hardware; AutoSD fixes the `Device` seam (`src/core/Device.ts`).
- **Ungrounded search** — answers without provenance; AutoSD returns citations with chunk IDs and scores, persisted per session.
- **Testability gap** — hardware code can't be CI-tested; Mock/Virtual devices and a mock embedding provider make the whole stack deterministic.
- **Accessibility debt** — thresholds live in `src/accessibility/a11y.ts`; CI fails if Lighthouse accessibility drops below 95.
- **Overclaiming** — tactile assistive tech attracts it; the capability matrix and its four status labels gate every public claim.

## 3. Target users (design targets, not a user base)

| Segment                  | Needs                                              | How AutoSD serves today                                                                                                                                                                                              |
| ------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tactile reader (primary) | Read long documents on a display or simulator      | `ReaderWorkflow` character & cell-aware pagination (`paginateByCells`) + aria labels; `TactileWorkflow` renders UEB Grade 1/2 (`textToBraille`) or legacy `textToDots` to any `Device` (**not human-validated yet**) |
| Researcher               | Ask questions over a local corpus, inspect sources | `ResearchWorkflow` with hybrid retrieval, citations, sessions, export                                                                                                                                                |
| Plugin author            | Ship once, run everywhere                          | `Plugin` contract, `PluginHost.registerWorkflow`, examples in `src/examples/`                                                                                                                                        |
| Hardware integrator      | Connect a real display without touching core       | `HIDDevice` seam + [docs/HARDWARE_INTEGRATION.md](docs/HARDWARE_INTEGRATION.md)                                                                                                                                      |
| Operator / CI            | Deterministic, headless runs                       | `npm run verify`, `npm run evaluate`, Docker image with health endpoint                                                                                                                                              |

Personas (Maya, Dr. Chen, Jamal, Priya, Alex) from the v0.3 PRD remain the design targets; see the archive. There are no users to cite.

## 4. Architecture summary

Seams (additive-only since v0.1): `Device`, `Plugin`, `EmbeddingProvider`, `Reranker`. Orchestration: `Registry<T>`, `DIContainer`, `DeviceManager` (error-isolated broadcast, atomic hot-swap), `PluginRegistry`/`PluginHost`. Full detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/ARCHITECTURE_FLOWS.md](docs/ARCHITECTURE_FLOWS.md).

## 5. Core workflows (as implemented)

| Workflow       | Entry point                                              | Behavior                                                                                                                                                                                                                                               |
| -------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ingest + index | `ResearchWorkflow.ingest(docs)`, `SnapshotIndex.index()` | Deterministic chunking (800/120), SHA-256 hash-diffed incremental indexing, manifest versioning, removed-doc handling                                                                                                                                  |
| Live sync      | `CorpusWatcher` → `LiveSync`                             | `.md`/`.txt`/`.json`, 150 ms debounce, persist to disk                                                                                                                                                                                                 |
| Research       | `ResearchWorkflow.run({id, question})`                   | BM25 + vector search fused by RRF (k=60), optional rerank; returns templated answer + `citations[]` + `confidence` (clamped retrieval score, **not** a probability)                                                                                    |
| Sessions       | session persistence + JSON export                        | Cap 100 sessions; export is valid JSON                                                                                                                                                                                                                 |
| Reader         | `ReaderWorkflow.paginate` / `paginateByCells`            | Character or cell-width (`linesPerPage × cellCount`) pages with `ariaLabel`, persisted cell-pagination preference, polite live-region excerpts                                                                                                         |
| Tactile        | `TactileWorkflow.renderBraille` / `renderText`           | Additive UEB Grade 1/2 (`textToBraille`, `brailleToText`, `wrapTextToBrailleLines`, `inspectBrailleCell`, [RFC_BRAILLE_M4.md](docs/RFC_BRAILLE_M4.md)) + legacy `textToDots` (`charCode % 64`) — byte-stable, device-portable, **not proven-readable** |
| Marketplace    | `MarketplaceWorkflow`                                    | In-repo fixture catalog; install is a lookup                                                                                                                                                                                                           |
| Demo           | `npm run demo`, `#/demo`                                 | Seven-step deterministic pipeline, byte-identical export (`demoVersion: 2`)                                                                                                                                                                            |
| Diagnostics    | `collectDiagnostics()`                                   | Metadata-only, secrets redacted                                                                                                                                                                                                                        |

Browser app: nine-route hash router (`home`, `reader`, `workspace`, `devices`, `research`, `sessions`, `settings`, `help`, `demo`) with lazy routes, onboarding, `VirtualList`, error boundary and loading states.

## 6. Functional requirements (shipped)

| ID   | Requirement                                                                                                              | Status (matrix)               | Evidence                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| F-01 | `Device` contract with typed events                                                                                      | IMPLEMENTED                   | `src/core/Device.ts`                                                                                                     |
| F-02 | `MockDevice` / `VirtualDevice`                                                                                           | SOFTWARE-VALIDATED            | `tests/devices/`                                                                                                         |
| F-03 | `HIDDevice` (WebHID / node-hid, graceful fallback)                                                                       | HARDWARE-DEPENDENT            | fallback-only tests                                                                                                      |
| F-04 | Registry, DI, atomic hot-swap                                                                                            | IMPLEMENTED                   | `tests/core/registry.test.ts`                                                                                            |
| F-05 | Plugin system + workflow dispatch                                                                                        | SOFTWARE-VALIDATED            | `tests/core/`, `tests/examples/`                                                                                         |
| F-06 | Hybrid retrieval (BM25 + vector, RRF, mode isolation, rerank hook)                                                       | SOFTWARE-VALIDATED            | `tests/retrieval/`, `docs/RETRIEVAL_QUALITY.md`                                                                          |
| F-07 | Incremental snapshot indexing                                                                                            | SOFTWARE-VALIDATED            | `snapshot.test.ts`                                                                                                       |
| F-08 | Corpus watching + live sync                                                                                              | SOFTWARE-VALIDATED            | `corpusWatcher.test.ts`, `liveSync.test.ts`                                                                              |
| F-09 | Sessions + export                                                                                                        | SOFTWARE-VALIDATED            | `sessionPersistence.test.ts`                                                                                             |
| F-10 | Research workflow (citations, confidence)                                                                                | SOFTWARE-VALIDATED            | `research.test.ts`                                                                                                       |
| F-11 | Embedding providers: mock (default), lexical (`lexical-hash`), local (transformers.js wrapper), OpenAI (server key only) | mixed — see matrix rows 18–19 | `tests/retrieval/`                                                                                                       |
| F-12 | Reader pagination (character + cell-aware) + aria                                                                        | SOFTWARE-VALIDATED            | `workflows.test.ts`, `brailleIteration3.test.ts`, `brailleIteration4.test.ts`                                            |
| F-13 | Tactile encoding (`textToDots` + additive UEB Grade 1/2 `textToBraille` / `brailleToText`)                               | USER-VALIDATION-PENDING       | `docs/RFC_BRAILLE_M4.md`, `brailleIteration3.test.ts`, `brailleIteration4.test.ts` (software tests only; no human study) |
| F-14 | Browser app shell                                                                                                        | SOFTWARE-VALIDATED            | `tests/ui/`, `tests/app/`, `e2e/app.spec.ts` (Playwright), Lighthouse CI                                                 |
| F-15 | Deterministic demo                                                                                                       | SOFTWARE-VALIDATED            | `tests/app/demo.test.ts`                                                                                                 |
| F-16 | Diagnostics                                                                                                              | SOFTWARE-VALIDATED            | `tests/app/diagnostics.test.ts`                                                                                          |
| F-17 | Evaluation **task** harness (11 pass/fail tasks, baseline gate, privacy scan)                                            | SOFTWARE-VALIDATED            | `src/app/evaluation.ts`, `tests/app/evaluation.test.ts`                                                                  |
| F-18 | Retrieval **quality** harness (recall@k, MRR, nDCG@10, provisional qrels, baseline gate)                                 | SOFTWARE-VALIDATED            | `src/retrieval/eval/`, `tests/retrieval/qualityRunner.test.ts`                                                           |

## 7. Non-functional requirements

| Area             | Requirement                              | How met                                                                        |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| Type safety      | strict TS                                | `tsc --noEmit` gate                                                            |
| Code quality     | lint + format, **zero warnings**         | `eslint --max-warnings 0`, `prettier --check`                                  |
| Dependencies     | zero runtime deps; Node ≥ 20             | `package.json` has no `dependencies`                                           |
| Determinism      | no flaky tests; byte-stable demo         | Mock/Virtual devices, mock embeddings                                          |
| Regression floor | test files/tests may only grow           | `evaluation.baseline.json` `suiteCounts` enforced in CI by `npm run test:gate` |
| Supply chain     | pinned actions, least privilege          | `.github/workflows/*.yml`                                                      |
| Privacy          | no corpus content in artifacts           | evaluation privacy scan                                                        |
| Additive-only    | no removals from public seams since v0.1 | contract audit                                                                 |

## 8. Accessibility (WCAG 2.2 AA)

Thresholds (contrast, target size ≥ 24 px, focus order, live regions, reduced motion) come only from `src/accessibility/a11y.ts`. Lighthouse accessibility ≥ 95 is a CI gate. **Screen-reader user testing has not happened** (matrix row 15).

## 9. Plugin ecosystem

Contract `Plugin { id, version, description?, activate(ctx), deactivate? }`; `PluginHost.runWorkflow` is the sole dispatch; new fields optional. Networked discovery, signed installs and sandboxing are **not started**. Guide: [docs/PLUGIN_GUIDE.md](docs/PLUGIN_GUIDE.md).

## 10. Known gaps & status (v1.1 in progress)

1. **Internal retrieval quality is measured; external review remains open.** `npm run eval:quality` (`src/retrieval/eval/`, `fixtures/eval/`) measures recall@k, MRR, and nDCG@10 across 40 queries over 3 frozen corpora (`docs/RETRIEVAL_QUALITY.md`), using `maintainer-authored-provisional` judgments. Real-corpus benchmarks and external peer review remain open.
2. **Default `mock` vector leg vs offline `lexical-hash`.** `MockEmbeddingProvider` stays the default `"mock"` config fallback for deterministic fixture/demo compatibility (even though `hybrid:mock` scores `nDCG@10 = 0.8624` vs `bm25 = 0.9124` due to hash-noise vectors). Setting `VITE_EMBEDDING_PROVIDER=lexical` selects `LexicalHashEmbeddingProvider`, which improves offline `hybrid:lexical-hash` to `nDCG@10 = 0.9495`. `LocalEmbeddingProvider`'s optional `@xenova/transformers` peer remains uninstalled by default.
3. **Answer is templated**, not synthesized or extracted.
4. **Tactile readability is unvalidated with human readers.** Additive UEB Grade 1/2 encoding/decoding (`textToBraille`, `brailleToText`), cell-aware pagination (`paginateByCells`), persisted Braille preferences (`BrowserStore`), and HID pan/routing/select/chord handling are software-validated ([docs/RFC_BRAILLE_M4.md](docs/RFC_BRAILLE_M4.md)), while legacy `textToDots` stays untouched; human tactile readability remains `USER-VALIDATION-PENDING`.
5. **Hardware first contact** has simulated `DeviceProfile` presets, `parseHIDInputReport`, and `#/devices` UI in software, but physical USB/Bluetooth HID displays remain untested (`HARDWARE-DEPENDENT`).
6. **No completed screen-reader user session.** Automated real-browser Playwright e2e (`e2e/app.spec.ts`, `npm run test:e2e`) and a structured NVDA/JAWS/VoiceOver walkthrough script ([docs/SCREEN_READER_WALKTHROUGH.md](docs/SCREEN_READER_WALKTHROUGH.md)) now ship, while external assistive-technology user sessions remain open.

## 11. Success metrics

| Metric                                | Target                                                                                  | Measured by                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------- |
| `npm run verify` green on clean clone | 100%                                                                                    | CI + `docs/CLEAN_CLONE_VERIFICATION.md`      |
| Evaluation tasks                      | 11/11 pass, privacy pass                                                                | `npm run evaluate` + `evaluate:gate`         |
| Suite floor                           | never shrinks                                                                           | `npm run test:gate`                          |
| Lighthouse accessibility              | ≥ 95                                                                                    | lighthouse workflow                          |
| Retrieval quality (v1.1)              | recall@k / MRR / nDCG@10 published with committed qrels; `hybrid:lexical-hash` ≥ `bm25` | `npm run eval:quality` + `eval:quality:gate` |

## 12. Evidence rules

Status changes follow the matrix's rules: software evidence moves rows only to SOFTWARE-VALIDATED; hardware rows need a documented hardware session; user-validation rows need a published study with blind and low-vision participants.

## 13. Release history

v0.3 baseline → v0.4 retrieval → v0.7–v0.9 app shell, security, demo → **v1.0.0** release cut → post-release evaluation harness, hardware handoff docs, supply-chain hardening → **v1.1 M0–M2, M4 (software), M6 walkthrough** (retrieval-quality harness, baseline gates, `LexicalHashEmbeddingProvider`, additive UEB Grade 1/2 braille + cell-aware pagination + `docs/RFC_BRAILLE_M4.md`, and `docs/SCREEN_READER_WALKTHROUGH.md`). Details in the README release notes.

## 14. Roadmap

> Additive only. Nothing ships by calendar alone.

**v1.1 — "Measured Retrieval & Real Braille"** (ordered by dependency):

- **M0 Housekeeping (landed)** — PRD refresh, `evaluation.baseline.json` ratchet + CI-enforced suite floor (`npm run test:gate`), zero-warning lint, doc wording (task harness ≠ quality harness).
- **M1 Retrieval-quality harness (landed, provisional qrels)** — recall@k / MRR / nDCG@10 over 3 frozen fixtures (`40` queries) with committed qrels; 6-config ablation; non-regression gate (`npm run eval:quality` + `eval:quality:gate`). External qrels peer review remains open.
- **M2 Offline signal-bearing vector leg (landed)** — `LexicalHashEmbeddingProvider` (`VITE_EMBEDDING_PROVIDER=lexical`) beats `bm25` across R@5, R@10, MRR@10, and nDCG@10; `"mock"` preserved for byte-stable fixtures and `demoVersion: 2`.
- **M3 Local embeddings (landed in software; live ONNX weights opt-in)** — optional `@huggingface/transformers` / `@xenova/transformers` peer dependencies, `Float32Array` mean-pooled ONNX tensor extraction + concurrent-init deduplication in `LocalEmbeddingProvider`, extractive answer synthesis in `ResearchWorkflow`, and opt-in `node scripts/run-quality-eval.mjs --include-local` benchmark (`createLocalQualityConfigs`).
- **M4 Standard braille option (landed in software; `USER-VALIDATION-PENDING`)** — [docs/RFC_BRAILLE_M4.md](docs/RFC_BRAILLE_M4.md) + additive `textToBraille` / `brailleToText` (UEB Grade 1 default + opt-in Grade 2 contractions), cell-aware pagination (`paginateByCells` + persisted `BrowserStore` / `#/settings` preferences), and HID pan/routing/select/chord handling; `textToDots` untouched.
- **M5 Hardware first-contact UX (software scaffold landed; `HARDWARE-DEPENDENT`)** — gesture-gated `requestDevice()`, `DeviceProfile` schema, raw test-pattern/input-log page; physical hardware verification remains open.
- **M6 Real-browser e2e + screen-reader walkthrough script (landed in software)** — Playwright real-browser e2e suite (`e2e/app.spec.ts`, `npm run test:e2e`, wired into `.github/workflows/ci.yml`) and [docs/SCREEN_READER_WALKTHROUGH.md](docs/SCREEN_READER_WALKTHROUGH.md) for NVDA/JAWS/VoiceOver; external AT sessions remain open.

**Later candidates (unscheduled):** networked marketplace + signed installs + sandboxing; confidence calibration (or relabeling); per-device capability profiles once hardware reality is known.

**External validation (cannot be done in-repo):** tactile readability verdicts from blind and low-vision readers; physical-device findings from display owners; peer review of evaluation methodology.
