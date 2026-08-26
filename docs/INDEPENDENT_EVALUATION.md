# Independent Evaluation Guide

The canonical path for evaluating AutoSD without maintainer assistance:

**clone → install → verify → launch → software demo → evaluation tasks → export results → generate report**

Everything software-only here is deterministic and reproducible. Nothing in this process fabricates validation: results you produce are labeled AUTOMATED until a human or a physical device adds evidence of another kind (see [EVALUATION_SCHEMA.md](EVALUATION_SCHEMA.md) for the boundary vocabulary).

## Prerequisites

| Tool     | Version    | Notes                                                                     |
| -------- | ---------- | ------------------------------------------------------------------------- |
| Node.js  | >= 20      | enforced by every entry point                                             |
| npm      | >= 10      | ships with Node 20                                                        |
| Chrome   | any recent | only for `npm run verify:release` (Lighthouse); not needed for evaluation |
| Hardware | none       | optional; see "Hardware evaluation" below                                 |

No accounts, no API keys, no network access required for any software task.

## Setup

```bash
git clone <repo-url> autosd
cd autosd
npm run bootstrap        # install + typecheck + lint + format + test + build
```

Expected: `✓ Bootstrap complete.` If anything fails here, stop and file an issue per "Failure reporting" — setup failures are evaluation findings too.

## Launch and demo (orientation, ~5 minutes)

```bash
npm run dev      # http://localhost:5173 — walk the six routes once
npm run demo     # seven-step deterministic pipeline, JSON to stdout
```

## The evaluator command

```bash
npm run evaluate
```

One command runs the canonical eleven-task software evaluation ([task matrix](EVALUATION_TASKS.md)): verifies your environment, executes every task (T01–T11; T11 is the GFI-3 retrieval-hardness suite), records pass/fail with observed timings, captures versions/configuration, privacy-scans its own output, then writes three artifacts to `evaluation-output/`:

| File               | Contents                                                   |
| ------------------ | ---------------------------------------------------------- |
| `evaluation.json`  | Machine-readable result, [schema v1](EVALUATION_SCHEMA.md) |
| `evaluation.md`    | Human-readable summary table                               |
| `environment.json` | Standalone environment/versions record for diffing         |

Console tail example:

```
✓ T01-STARTUP         PASS    e2e smoke suite green
✓ T02-INGEST          PASS    indexed 3 docs · 3 chunks · manifest 1.0.0
…
11/11 passed · 0 failed · 0 skipped · privacy scan PASS
```

Exit codes: `0` all passed · `1` task failure or leakage detected · `2` usage/schema error.

Useful variants:

```bash
npm run evaluate -- --out-dir my-run              # custom artifact directory
npm run evaluate -- --stamp                       # embed ISO timestamp (off by default)
node scripts/run-evaluation.mjs --validate evaluation-output/evaluation.json   # schema check
npm run evaluate -- T03                           # self-test drill: force T03 to fail (exit 1)
```

## Software-only evaluation scope

The eleven tasks cover: application startup (T01), ingestion (T02), retrieval (T03), citation integrity (T04), Reader pagination (T05), disk persistence round-trip (T06), session export (T07), VirtualDevice tactile pipeline (T08), diagnostics safety (T09), graceful failure/recovery (T10), and retrieval hardness (T11, 9 synthetic subchecks — see [EVALUATION_TASKS.md](EVALUATION_TASKS.md)). Scores are ranks, never calibrated probabilities.

Per-task goals, steps, expected results, evidence, and failure interpretation live in [EVALUATION_TASKS.md](EVALUATION_TASKS.md).

For manual browser observations (keyboard-only pass, screen-reader spot checks), follow Section B of [EVALUATION_CHECKLIST.md](EVALUATION_CHECKLIST.md) and attach findings as MANUAL entries per the schema's evidence rules.

## Optional hardware evaluation

Only if you physically own a tactile display:

1. Read [HARDWARE_INTEGRATION.md](HARDWARE_INTEGRATION.md) — the boundary tiers and first-contact procedure.
2. Software evaluation stays unchanged; it never touches HID.
3. Record hardware observations separately. A run that merely had a device plugged in is still `hardwareStatus: NOT-TESTED`; only documented interaction moves it to `CONNECTED-UNVERIFIED`, and only a reproducible documented session justifies `HARDWARE-VALIDATED` — set in the issue text, not by editing the automated artifact.
4. Never mark tasks `USER-VALIDATED`. That level requires human-participant methodology and cannot come from this runner.

## Result export & what belongs in a shareable report

Share exactly: `evaluation.json` + `evaluation.md` + `environment.json` (+ your written notes/screenshots in the issue). The package contains versions, counts, statuses, and observed timings only. The runner refuses to write artifacts if its privacy scan detects leakage (`privacy scan FAIL`, nothing written).

Do **not** attach: corpus documents you added, `.env` files, screenshots containing personal data, or raw logs from other tools. Automated runs contain no personal information by construction; keep it that way when adding notes.

## Reproducibility expectations

Two clean runs produce byte-identical `environment.json` and identical `evaluation.json` after collapsing the `"durationMs": N` fields (timings are observed, naturally variable). Task outcomes, versions, and schema shape are stable. If your two runs disagree beyond timing, that is a finding — report it.

## Scheduled runs and retention (C6.3)

- **Schedule:** `evaluation.yml` runs on `push: main`, `pull_request: main`, nightly `03:17 UTC`, and `workflow_dispatch`. No external API keys required.
- **Retention:** allowlisted artifacts (`evaluation.json`/`evaluation.md`/`environment.json`) are uploaded via `actions/upload-artifact` with `retention-days: 30`. No duplicate backend — GitHub's artifact store is the only store.
- **Naming:** `evaluation-artifacts` per run; runs are distinct by GitHub run ID, no overwriting, stale artifacts auto-expire.
- **Baseline snapshots:** `evaluation.baseline.json` is versioned in the repo (`taskSetVersion` tracks the task set; see `docs/BASELINE_MIGRATION.md`). Nightly does not snapshot a new baseline — it compares to the committed baseline.
- **Failed-run visibility:** upload uses `if: always()`, so artifacts are available even when the gate fails. A maintainer inspects via **Actions → evaluation → failed run → Artifacts**. `FAIL` is a task/privacy/schema regression; `WARN` is advisory timing or `taskSetVersion` drift and does not block unless it signals integrity failure.
- **Regression definition:** `FAIL` = required task not `pass`, privacy not `pass`, or schema/`taskSetVersion` mismatch without a documented migration. See `scripts/check-evaluation-baseline.mjs` for the exact rules.

## External evaluation status

**`EXTERNAL_EVALUATION_STATUS = NOT_YET_PERFORMED`** — see `docs/EXTERNAL_EVALUATION_STATUS.md`. No real external evaluator has yet submitted a report. The first real report will be intake-hardened via provenance/validation-level checks and will be linked here.

## Failure reporting

Open an issue using the **Evaluation report** template with: environment, AutoSD version/commit, failing task ID, expected vs actual, reproduction steps, and the evaluation artifacts. Partial evaluations and negative results are welcome contributions. Security-sensitive discoveries go through [../SECURITY.md](../SECURITY.md) instead.
