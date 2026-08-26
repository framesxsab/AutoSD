# Evaluation Task Matrix

The eleven canonical software tasks executed by `npm run evaluate` ([runner](../scripts/run-evaluation.mjs), [engine](../src/app/evaluation.ts)). All tasks run against synthetic in-repo fixtures — never your documents, never the network.

Conventions: every task reports `status` (pass/fail/skipped), an observed `durationMs`, a metadata-only `detail`, and small scalar `evidence`. All automated tasks are recorded at validation level **SOFTWARE-VERIFIED** — see [EVALUATION_SCHEMA.md](EVALUATION_SCHEMA.md) before claiming anything stronger. Retrieval scores are ranks, never calibrated probabilities.

## T01-STARTUP

- **Goal:** prove the real application mounts and boots.
- **Steps:** runner executes `tests/e2e/smoke.test.ts` under vitest/jsdom, which loads `main.ts` → `bootstrapApp()` → router with all views.
- **Expected:** suite green; app version banner renders.
- **Evidence:** pass/fail + duration. Skipped when no probe is configured.
- **Failure interpretation:** bootstrap/routing regression; check recent changes to `src/app/bootstrap.ts`, `router.ts`. Not related to retrieval quality.

## T02-INGEST

- **Goal:** incremental ingestion of the 3-document synthetic corpus.
- **Steps:** fresh `ResearchWorkflow` ingests `SYNTHETIC_CORPUS`.
- **Expected:** `added == 3`, `chunkCount >= 3`.
- **Evidence:** `{ added, chunkCount }`.
- **Failure interpretation:** chunker/snapshot regression; inspect `tests/retrieval/chunker.test.ts`, `snapshot.test.ts` locally to isolate.

## T03-RETRIEVAL

- **Goal:** hybrid BM25+vector retrieval answers the evaluation query from the fixture corpus alone.
- **Steps:** `workflow.run({ id: "eval-query-1", question: "How are documents indexed and cited?" })`.
- **Expected:** ≥1 citation; confidence within the clamped score range.
- **Evidence:** `{ citationCount, confidence }`.
- **Failure interpretation:** pipeline/fusion regression (`tests/retrieval/pipeline.test.ts`). Note: `confidence` is a clamped retrieval score, not calibrated probability — a low value here is not evidence of poor quality by itself.

## T04-CITATIONS

- **Goal:** citations are well-formed and score-descending.
- **Steps:** validate fields (`documentId`, `chunkId`, finite numeric `score`) and descending order over T03's results.
- **Expected:** all citations well-formed; order non-increasing by score.
- **Evidence:** `{ count }`.
- **Failure interpretation:** result-shaping bug in `ResearchWorkflow.run()` or pipeline ordering.

## T05-READER

- **Goal:** Reader workflow paginates into accessible reading order.
- **Steps:** paginate first fixture doc at 120 chars/page; assert sequential aria labels and truncated live-region text.
- **Expected:** ≥1 page; labels contain page numbers; live region ends with ellipsis.
- **Evidence:** `{ pageCount }`.
- **Failure interpretation:** `ReaderWorkflow` regression (`tests/workflows/workflows.test.ts`).

## T06-SESSION-PERSIST

- **Goal:** index + sessions survive a real disk round-trip.
- **Steps:** save workflow to a private temp dir; restore into a second workflow; compare session identity and document count. Runs as a dedicated vitest file in real Node (see engine note on Vite SSR aliases); temp dir is always cleaned up.
- **Expected:** load succeeds; last session id is `eval-query-1`; documents restored.
- **Evidence:** `{ sessionCount, manifestVersion }`.
- **Failure interpretation:** persistence/atomic-write regression (`tests/retrieval/persistence.test.ts`, `sessionPersistence.test.ts`). Temp-dir permission problems also surface here.

## T07-EXPORT

- **Goal:** canonical session export emits valid JSON with the required shape.
- **Steps:** `exportLastSession()`; parse; require `query` and `results` keys.
- **Expected:** valid JSON, non-trivial size.
- **Evidence:** `{ bytes }`.
- **Failure interpretation:** serialization bug in `exportSession`.

## T08-TACTILE-VIRTUAL

- **Goal:** full tactile path onto VirtualDevice: map → render → framebuffer read-back equality.
- **Steps:** connect `VirtualDevice(40)`; `textToDots("autosd eval", 40)`; render; read; compare arrays.
- **Expected:** framebuffer equals pattern; active dots > 0.
- **Evidence:** `{ dotCount, activeDots }`.
- **Failure interpretation:** device-contract regression (`tests/devices/devices.test.ts`). This says nothing about readability — the dot mapping remains USER-VALIDATION-PENDING.

## T09-DIAGNOSTICS

- **Goal:** diagnostics surface is serializable and its sanitizer redacts sensitive keys.
- **Steps:** serialize `collectDiagnostics({workflow, provider})`; probe `sanitize({apiKey, token, plain})`.
- **Expected:** non-empty JSON; `[redacted]` for secret-looking keys; plain values preserved.
- **Evidence:** `{ diagnosticsBytes }`.
- **Failure interpretation:** diagnostics/sanitizer regression — treat as security-relevant; report per SECURITY.md if any leak path exists.

## T10-RECOVERY

- **Goal:** graceful failure paths actually fail gracefully and recover.
- **Steps:** `trySetActive("does-not-exist")` returns false and records an error event; `render()` before `connect()` rejects; after `connect()`, render+read succeed.
- **Expected:** guard true, rejection observed, recovery complete.
- **Evidence:** `{ guardedUnknown, rejectedBeforeConnect }` booleans.
- **Failure interpretation:** DeviceManager/VirtualDevice error-path regression (`tests/core/registry.test.ts`, devices tests).

## T11-RETRIEVAL-HARDNESS

- **Goal:** stress retrieval without inventing real-world claims: similar terminology, distractor, overlapping concepts, contradictory docs, renamed section, changed version, deleted/replaced, citation correctness, stale snapshot detection — all synthetic, deterministic, and scored as ranks (never probabilities). Added in taskSet v2 (GFI-3).
- **Steps:** nine isolated subchecks, each with a fresh `MockEmbeddingProvider` workflow or `SnapshotIndex`: ingest `HARDNESS_FIXTURES` pairs, query `HARDNESS_QUERY`/`HARDNESS_CONTRADICT_QUERY`, assert top citation or hash/version change.
- **Expected:** 9/9 subchecks pass; detail lists `subchecksPassed/total`.
- **Evidence:** `{ subchecksPassed, subchecksTotal }` plus per-subcheck names in the detail on failure.
- **Failure interpretation:** BM25/RRF ranking, chunking, or snapshot hash regression. A failing subcheck names itself (e.g., `distractor`, `stale-snapshot`) — inspect that scenario's fixture pair in `src/app/evaluation.ts`.

---

### Manual companion tasks (not in the automated runner)

Sections B1–B10 of [EVALUATION_CHECKLIST.md](EVALUATION_CHECKLIST.md) cover browser walkthrough, keyboard-only, and screen-reader spot checks. Record them as MANUAL entries in an issue following [EVALUATION_SCHEMA.md](EVALUATION_SCHEMA.md); they can never be emitted by `npm run evaluate` itself.
