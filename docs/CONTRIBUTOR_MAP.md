# AutoSD Contributor Map

Where to plug in, based on what the repository actually needs — not on a generic "good first issue" list. Each lane states what exists today (with file paths), what is genuinely missing, and where to start.

Ground rules that apply to every lane: `npm run verify` before every PR, contracts are additive-only, no fabricated numbers, no new runtime dependencies without an RFC, accessibility gaps are defects. Details in [../CONTRIBUTING.md](../CONTRIBUTING.md). Issue definitions for many of these live in [GOOD_FIRST_ISSUES.md](GOOD_FIRST_ISSUES.md).

## 1. Frontend / Accessibility

**Exists:** nine-route hash router with lazy views (`src/app/router.ts`), workspace/research/sessions/devices/demo views, `VirtualList` with ARIA grid semantics, onboarding flow, error/loading states, WCAG 2.2 AA threshold module (`src/accessibility/a11y.ts`) enforced by a Lighthouse CI gate (a11y ≥ 95).

**Actually missing:**

- Any screen-reader user testing. Automated audits pass; no human has used AutoSD with NVDA/JAWS/VoiceOver.
- Cross-browser manual verification (matrix row 14 explicitly lists this as the missing evidence).
- README screenshots are placeholders.
- Keyboard-navigation findings from real users (the checklist's B9/B10 items have zero reports so far).

**Start here:** run [EVALUATION_CHECKLIST.md](EVALUATION_CHECKLIST.md) Section B and file your results; fix whatever you hit.

## 2. Retrieval / AI

**Exists:** hybrid retrieval — BM25 (`src/retrieval/bm25.ts`) + embeddings fused by reciprocal rank fusion k=60 (`src/retrieval/pipeline.ts`), optional rerankers (`src/retrieval/reranker.ts`), incremental hash-diffed snapshot index, three embedding providers (Mock default / Local transformers.js wrapper / OpenAI-compatible with server-side-key-only handling).

**Actually missing:**

- **Evaluation harness.** No recall@k, precision, or latency numbers exist because the harness was never built. This is the single highest-value contribution in the repo.
- **Local ONNX inference.** The local provider ships as a graceful mock fallback; real local-model inference is unproven behind the existing seam.
- Confidence calibration (currently a clamped score).
- Tuning evidence for RRF k=60 and chunking parameters (values work; nobody has measured alternatives).

**Start here:** [RESEARCH_GUIDE.md](RESEARCH_GUIDE.md), then the recall@k harness issue in [GOOD_FIRST_ISSUES.md](GOOD_FIRST_ISSUES.md).

## 3. Hardware / HID

**Exists:** stable `Device` contract since v0.1 (`src/core/Device.ts`), `DeviceManager` with registry + hot-swap + broadcast error isolation, `HIDDevice` adapter with dynamic import and graceful fallback, contract tests that pass without hardware.

**Actually missing:**

- **One documented session with one real device.** Matrix row 4 has never moved because nobody has plugged hardware in.
- Per-device capability profiles (dot counts, refresh timing) — everything assumes 40 dots at static constructor values.
- Input-event handling from physical devices (`input` events exist in the contract; nothing consumes them end-to-end).

**Start here:** [HARDWARE_INTEGRATION.md](HARDWARE_INTEGRATION.md) — it is written so you never touch core architecture.

## 4. Tactile output

**Exists:** `textToDots` (`src/workflows/tactile.ts`): byte-stable, device-portable mapping of text to six-dot-range cell values; `TactileWorkflow.renderText/renderPages`; demo renders top citations onto VirtualDevice frames.

**Actually missing:**

- **Standard braille (or any validated) mapping.** `charCode % 64` is explicitly _not_ braille. Status: USER-VALIDATION-PENDING — only blind/low-vision readers can validate or replace it.
- Haptic emphasis patterns (pulse-on-page-change exists only as an idea in demo corpus prose, not code).
- Back-translation (device input → text); the `input` event path is unimplemented beyond plumbing.

**Constraint:** do not silently replace the placeholder mapping — it is a deterministic fixture for tests. Additive options only (e.g., a standard-braille table behind a new function or option), RFC before touching exported types.

## 5. Testing

**Exists:** 275 tests across 49 files mirroring `src/` (vitest; jsdom for DOM suites), e2e smoke + persistence round-trip, Lighthouse gate via `verify:release`, CI running three gates on every PR.

**Actually missing:**

- Browser-level end-to-end coverage (current e2e is jsdom-based; no real-browser click-through suite).
- Manual test reports from real environments (Windows/macOS/Linux variety) — see checklist Section B.
- Performance regression signals for indexing large corpora (no benchmark exists; building measurement infra comes before numbers).

**Start here:** pick a gap above; keep the rule "bug fixes get a regression test that fails without the fix".

## 6. Research

**Exists:** research workflow with citations and persisted sessions (`src/workflows/research.ts`), retrieval tunables documented in [retrieval.md](retrieval.md), honesty-first status language across docs.

**Actually missing:**

- Published evaluation methodology (corpus freeze protocol, metrics, baselines).
- Literature grounding for design choices (RRF parameters, chunk sizes) — currently engineering judgment, not cited research.
- A study protocol draft for tactile readability validation that an IRB/community partner could actually run.

**Note:** personas in `PRD.md` are design targets, not users. Research contributions must not fabricate participants or results — this repo's credibility depends on it.

## 7. Documentation

**Exists:** README with claim-status discipline, capability matrix as source of truth, architecture/plugin/research/deployment/security guides, bootstrap sanity doc, plus newcomer docs added post-v1.0: [GETTING_STARTED.md](GETTING_STARTED.md), [EVALUATION.md](EVALUATION.md), this map, [HARDWARE_INTEGRATION.md](HARDWARE_INTEGRATION.md), [GOOD_FIRST_ISSUES.md](GOOD_FIRST_ISSUES.md).

**Actually missing:**

- Real screenshots (README table still has placeholders).
- First-run friction reports: anything in [GETTING_STARTED.md](GETTING_STARTED.md) that didn't match reality on your machine is a bug — report it.
- Translated/accessibility-formatted versions of core docs (only if you actually need them — don't invent demand).

**Rule:** docs changes follow the same verify gate (prettier checks root `*.md`), and every behavior change ships with its doc update in the same PR.
