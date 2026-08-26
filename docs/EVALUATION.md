# Evaluating AutoSD

This document exists so you can evaluate AutoSD **without trusting our marketing**. It separates what is proven, what depends on hardware we don't control, and what nobody has validated yet — then gives you a reproducible procedure and a checklist you can run and report against.

The formal claim registry is [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md). Every status below matches a row there.

## Status vocabulary

- **IMPLEMENTED** — shipped code with passing coverage. A structural claim only.
- **SOFTWARE-VALIDATED** — verified in software: automated tests, the deterministic demo, automated audits. No hardware involved.
- **HARDWARE-DEPENDENT** — code ships; real behavior depends on physical hardware that has never been connected during development.
- **USER-VALIDATION-PENDING** — works in software; whether it works _for people_ is unproven.

## 1. Software capabilities (what you can verify yourself today)

| Capability                                                                                            | Evidence                                                              | How to check                                              |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------- |
| 275 tests across 49 files, all green (was 219/43 at v1.0.0)                                           | `npm test`                                                            | Run it (≈15 s)                                            |
| Deterministic end-to-end demo (ingest → reader → search → citations → tactile → diagnostics → export) | `src/app/demo.ts`, `tests/app/demo.test.ts`                           | `npm run demo` twice; exports are byte-identical          |
| Hybrid retrieval: BM25 + vector cosine, RRF fusion (k=60), optional rerankers                         | `tests/retrieval/pipeline.test.ts`                                    | Read tests; run demo and inspect citation scores          |
| Incremental snapshot indexing (hash-diffed; unchanged docs never re-embedded)                         | `tests/retrieval/snapshot.test.ts`                                    | Read test assertions                                      |
| Corpus watching + live sync (~150 ms debounce)                                                        | `tests/retrieval/corpusWatcher.test.ts`, `tests/app/liveSync.test.ts` | Drop a `.md` into `corpus/docs/` while `npm run dev` runs |
| Session persistence + JSON export (cap 100)                                                           | `tests/retrieval/sessionPersistence.test.ts`                          | Export from `#/sessions` in the browser app               |
| Plugin register/activate/hot-swap lifecycle                                                           | `tests/core/registry.test.ts`, examples in `src/examples/`            | Follow [PLUGIN_GUIDE.md](PLUGIN_GUIDE.md)                 |
| Browser app: 9 routes, lazy loading, onboarding, error/loading states                                 | jsdom suites under `tests/ui/`, `tests/app/`                          | `npm run dev` and click through                           |
| WCAG 2.2 AA helper gate + Lighthouse CI enforcement (a11y ≥ 95, perf ≥ 90)                            | `tests/a11y/a11y.test.ts`, `.github/workflows`                        | `npm run verify:release` (needs Chrome)                   |

Caveats that are part of the software story:

- `confidence` on research results is a clamped retrieval score, **not a calibrated probability**.
- The marketplace catalog is an in-repo fixture (`autosd-reader`, `autosd-tts`, `autosd-braille`); "install" is a lookup, not a package operation.
- With the default mock embedding provider, search quality is functional, not tuned.
- No recall@k, precision, or latency benchmarks exist anywhere because no evaluation harness exists yet. Any number would be fabricated.

## 2. Hardware-dependent capabilities (code ships, zero physical validation)

| Capability                                           | Status             | Honest state                                                                                                         |
| ---------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `HIDDevice` adapter (WebHID browser / node-hid Node) | HARDWARE-DEPENDENT | Dynamic import + graceful fallback are contract-tested. **Never tested against physical hardware.**                  |
| Rendering to real tactile cells                      | HARDWARE-DEPENDENT | The `Device` seam is stable and additive-only since v0.1, but nothing in CI can substitute for plugging a display in |
| Per-device dot-count profiles, refresh-rate handling | NOT STARTED        | `dotCount` defaults to 40 everywhere; no capability probing beyond static constructor args                           |

If you have hardware: [HARDWARE_INTEGRATION.md](HARDWARE_INTEGRATION.md) is the path, including the report template that moves matrix row 4.

## 3. User-validation-pending capabilities (nobody has tested these with humans)

| Capability                                        | Status                  | Why it matters                                                                                                                                            |
| ------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tactile readability of rendered output            | USER-VALIDATION-PENDING | `textToDots` maps `charCode % 64` — byte-stable and device-portable, but **not standard braille**. No study, no participants, no readability data exists. |
| Screen-reader experience of the web app           | USER-VALIDATION-PENDING | Automated audits and Lighthouse pass; no assistive-tech user testing has happened.                                                                        |
| Reader pagination as an actual reading experience | USER-VALIDATION-PENDING | Pagination counts and aria labels are tested; reading comfort with real users is unknown.                                                                 |

## 4. Exact questions the project needs answered

These are the open questions this repository cannot answer about itself. Answering any of them — with methodology — is a first-class contribution.

1. **Does any AutoSD tactile output read correctly by touch?** (Requires blind/low-vision participants; validates or replaces `charCode % 64`.)
2. **Which real displays work through the HID adapter, and what breaks first?** (Requires one integration session per device.)
3. **What is the retrieval quality?** (Requires a frozen corpus snapshot + recall@k harness; no numbers exist today.)
4. **Is `confidence` meaningful to users?** (Requires calibration study or removal/relabeling.)
5. **Do screen-reader users complete the core flows** (search → citations → sessions)? (Requires AT user testing; automated audits cannot answer this.)
6. **Is the mock provider good enough for evaluation, or must ONNX local embeddings land first?**
7. **Does the plugin seam cover real assistive-tech extensions**, or only toy workflows?

## 5. Reproducible evaluation procedure

Run everything on a clean clone; report your environment with results.

```bash
# 0. Environment capture
node -v && npm -v && git rev-parse HEAD

# 1. Full verification gate (typecheck + lint + format + tests + build)
npm run bootstrap          # or `npm run verify` if already installed

# 2. Canonical ten-task evaluation (machine + human artifacts, privacy-scanned)
npm run evaluate
# → evaluation-output/evaluation.json · evaluation.md · environment.json

# 3. Determinism proof
npm run demo -- --out run-a.json
npm run demo -- --out run-b.json
# run-a.json and run-b.json must be byte-identical

# 4. Served-app audit (needs Chrome): builds, serves dist-app/, enforces
#    Lighthouse accessibility >= 95 and performance >= 90
npm run verify:release

# 5. Manual app walkthrough (record what actually happened)
npm run dev     # then visit #/home #/workspace #/research #/sessions #/devices #/demo
```

Full path details: [INDEPENDENT_EVALUATION.md](INDEPENDENT_EVALUATION.md). Task-by-task interpretation: [EVALUATION_TASKS.md](EVALUATION_TASKS.md).

Then use the public checklist: [EVALUATION_CHECKLIST.md](EVALUATION_CHECKLIST.md). File results as an issue using the **Evaluation report** template — partial results are welcome and will be linked from the capability matrix discussion. Do not edit CAPABILITY_MATRIX.md statuses directly; status moves follow the evidence rules at the bottom of that file.

## What we ask evaluators NOT to conclude

- That AutoSD renders readable braille (unproven).
- That any specific display works with it (untested).
- That retrieval quality is known (unmeasured).
- That accessibility is user-validated (automated checks only).
