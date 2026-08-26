# Good First Issues & Help Wanted — Definitions

Issue definitions derived **only** from documented gaps in this repository (capability matrix "not started" rows, honesty sections, and audit findings). No speculative features. Copy any definition into a GitHub issue when claiming it; keep titles and labels as given.

Labels vocabulary (matches [../CONTRIBUTING.md](../CONTRIBUTING.md)): `bug` `feature` `docs` `a11y` `rfc` — plus adoption labels `good first issue` and `help wanted`.

---

## GFI-1 · docs: Capture real screenshots for the six README routes

**Labels:** `docs`, `good first issue`

**Problem:** The README screenshots table contains `_placeholder_` for every route (`#/home`, `#/workspace`, `#/research`, `#/sessions`, `#/devices`, `#/demo`). Newcomers get no visual orientation.

**Scope:**

- Run `npm run dev`, visit each route, capture screenshots.
- Store under `docs/assets/` (create), reference from README table.
- Keep captures honest: default state, no staged data beyond the documented demo corpus.

**Acceptance criteria:** all six rows show real images; images are reasonably sized (<300 KB each); alt text present in markdown.

**Out of scope:** marketing graphics, logos, animated GIFs.

---

## GFI-2 · test: Add real-browser end-to-end smoke coverage

**Labels:** `feature`, `help wanted`

**Problem:** The only e2e suite (`tests/e2e/smoke.test.ts`) runs in jsdom. Nothing exercises the built app in a real browser outside the Lighthouse audit (`verify:release` measures scores but does not assert flows).

**Scope:**

- Propose tooling as a devDependency only (zero-runtime-deps rule untouched).
- Cover one flow: load app → onboarding → ingest demo document → search → open citation → export session JSON.
- Must pass in CI without flakiness (deterministic selectors, no timing sleeps).

**Acceptance criteria:** new suite runs via an npm script; CI job added; jsdom e2e stays green; README/DEVELOPMENT docs updated.

**Requires:** RFC-style comment in the issue before code (new devDependency).

---

## GFI-3 · feature(retrieval): Recall@k evaluation harness skeleton

**Labels:** `feature`, `help wanted`

**Problem:** No retrieval quality numbers exist because the harness does not exist ("Explicitly not started" in [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md)). Any published number today would be fabricated.

**Scope:**

- Freeze the deterministic demo corpus (`src/app/demo.ts` `DEMO_CORPUS`) plus 2–3 additional small public-domain corpora as fixtures.
- Implement graded relevance judgments for those fixtures **in-repo as data files** (judgments must be hand-authored and committed, with authorship noted — not generated).
- Compute recall@k / MRR over the pipeline; output machine-readable results.
- CLI entry (`npm run eval` or similar) printing results; no network.

**Acceptance criteria:** reproducible command; committed judgment data with provenance note; results labeled SOFTWARE-VALIDATED evidence only after review; capability matrix row 7 "what would move the status" updated when numbers land.

**Out of scope:** publishing comparative claims against other systems; tuning k=60 (separate issue after baseline exists).

---

## HW-1 · help wanted(hardware): First documented integration session with a physical display

**Labels:** `help wanted`

**Problem:** Matrix row 4 (`HIDDevice`) is HARDWARE-DEPENDENT and has never moved: no physical device has ever been connected during development. Contract tests cover fallback behavior only.

**Scope:**

- Follow [HARDWARE_INTEGRATION.md](HARDWARE_INTEGRATION.md) exactly; do not modify core architecture.
- One device, one session. Record everything per the report template there (enumeration, permissions, write format, what failed first).

**Acceptance criteria:** integration report filed as an issue + PR adding findings to the hardware doc's known-devices section (even if the finding is "does not work yet").

**Note:** negative results count. "Enumerated but render produced garbage" moves the project forward more than silence.

---

## TAC-1 · rfc(tactile): Additive standard-braille mapping option

**Labels:** `rfc`, `help wanted`

**Problem:** `textToDots` maps `charCode % 64` — byte-stable and device-portable but explicitly **not standard braille** (matrix row 20, USER-VALIDATION-PENDING). There is no standards-based alternative anywhere in the repo.

**Scope (RFC first):**

- Design an additive mapping (e.g., Unicode braille pattern table behind a new exported function or optional parameter) without changing existing fixture behavior — tests depend on current bytes.
- Include the mapping table with its standard source cited.
- Human validation remains out of scope here; this issue delivers the _option_, not a readability claim.

**Acceptance criteria:** RFC approved → implementation with byte-level tests proving old behavior unchanged; docs updated; matrix row 20 notes the alternative exists but stays USER-VALIDATION-PENDING until a study says otherwise.

---

## A11Y-1 · a11y: Screen-reader walkthrough script and report template

**Labels:** `a11y`, `good first issue`

**Problem:** Automated audits and the Lighthouse gate pass, but matrix row 15 states plainly: screen-reader user testing has not happened. There is not even a script for someone to run such a session.

**Scope:**

- Write a step-by-step NVDA and VoiceOver walkthrough covering: onboarding, workspace search, citation inspection, sessions export, demo completion.
- Define what should be announced at each step (from the live-region code in `src/app/router.ts`, `src/ui/*`).
- Provide a findings template (per-step: expected / heard / gap) consistent with [EVALUATION_CHECKLIST.md](EVALUATION_CHECKLIST.md) Section B10.

**Acceptance criteria:** doc under `docs/` linked from CONTRIBUTOR_MAP lane 1; template usable by a non-expert; no code changes required.

---

## DOC-1 · docs: Newcomer friction log for GETTING_STARTED

**Labels:** `docs`, `good first issue`

**Problem:** [GETTING_STARTED.md](GETTING_STARTED.md) is new and untested against fresh machines other than the maintainer's. Every deviation between doc and reality is a bug.

**Scope:** On a clean clone (fresh directory, ideally fresh OS profile): follow the doc literally, record every mismatch (command output, timings, port behavior, error messages), file results.

**Acceptance criteria:** friction log issue with environment header; mismatches either fixed in the same PR or split into precise follow-up issues.

---

## TEST-1 · test: Manual browser-matrix verification reports

**Labels:** `test`, `help wanted`

**Problem:** Matrix row 14 lists "cross-browser manual pass" as the missing evidence for deepening the app-shell claim. Zero reports exist for browsers other than Chromium-in-CI.

**Scope:** Run [EVALUATION_CHECKLIST.md](EVALUATION_CHECKLIST.md) Section B on Firefox and Safari (and a mobile viewport if available). File per-browser results.

**Acceptance criteria:** one issue per browser with completed B-section checklist and deviations list.

---

## Claiming work

1. Comment on the issue you're taking; link your plan if it's an RFC item.
2. Branch per convention (`feat/...`, `docs/...`, `test/...`), keep PRs small.
3. `npm run verify` locally; CI runs both gates.
4. Evidence rules apply: whatever you claim in a PR must be reproducible from the PR description.

## Contributor ownership map

One row per open definition: area → issue → difficulty → files → expected outcome. Difficulty assumes you have completed [GETTING_STARTED.md](GETTING_STARTED.md); none require deep architectural knowledge except where noted.

| Area              | Issue  | Difficulty                         | Files you will touch                                                                       | Expected outcome                                                                                           |
| ----------------- | ------ | ---------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Docs / media      | GFI-1  | easy                               | `README.md`, new `docs/assets/`                                                            | Six real route screenshots replace `_placeholder_` rows                                                    |
| Testing / e2e     | GFI-2  | medium                             | new e2e suite under `tests/e2e/`, one CI job, `docs/DEVELOPMENT.md`                        | Real-browser smoke flow (load → search → citation → export) green in CI; RFC comment first (devDependency) |
| Retrieval / AI    | GFI-3  | hard                               | new eval fixtures + runner (`scripts/` or `src/retrieval/eval/`), `tests/retrieval/`, docs | Committed hand-authored judgment data, reproducible recall@k command, zero fabricated numbers              |
| Hardware / HID    | HW-1   | hard _(requires owning a display)_ | your adapter file, `docs/HARDWARE_INTEGRATION.md` known-devices section                    | First documented integration report — negative results count toward capability-matrix row 4                |
| Tactile output    | TAC-1  | medium                             | `src/workflows/tactile.ts` (additive), `tests/workflows/workflows.test.ts`                 | RFC-approved standard-braille option; existing `charCode % 64` fixture bytes proven unchanged              |
| Accessibility     | A11Y-1 | easy–medium                        | new doc under `docs/`, cross-links from `CONTRIBUTOR_MAP.md`                               | NVDA/VoiceOver walkthrough script + findings template ready for first sessions                             |
| Onboarding / docs | DOC-1  | easy                               | `docs/GETTING_STARTED.md` (+ small fixes)                                                  | Friction log filed; every mismatch fixed or split into precise follow-ups                                  |
| QA                | TEST-1 | easy                               | issue reports only (code only if fixing found defects)                                     | Completed Section-B checklist per browser (Firefox, Safari) with deviations listed                         |

Sequencing tip: DOC-1, GFI-1, and TEST-1 need no architectural context and can land this week; GFI-3 and HW-1 are the two that unblock everything else in the roadmap and deserve the most experienced volunteers.
