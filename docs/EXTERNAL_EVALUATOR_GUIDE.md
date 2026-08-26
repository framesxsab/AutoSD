# External Evaluator Guide

You have never seen AutoSD before. This guide is the complete hand-off: what the project is, what it honestly claims, how to evaluate it, and how your results are handled.

## What AutoSD is (30 seconds)

A local-first document platform that turns a folder of `.md`/`.txt`/`.json` files into grounded answers (hybrid BM25 + vectors, citations, sessions) and can render those answers onto tactile devices through one stable `Device` contract. Zero runtime dependencies; all state is plain JSON under `corpus/`.

**External evaluation status:** `NOT_YET_PERFORMED` — no real external report has been filed yet. See `docs/EXTERNAL_EVALUATION_STATUS.md`. The path below is ready for the first evaluator.

## What v1.0 actually claims

Source of truth: [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md). Summary:

- **Implemented & software-verified:** ingestion (hash-diffed incremental), hybrid retrieval via RRF k=60, Reader pagination, session persistence + export (cap 100), mock/virtual devices, nine-route browser app, plugin hot-swap, WCAG helpers with Lighthouse gate (a11y ≥95), deterministic demo (`demoVersion: 2`), diagnostics scaffold, evaluation runner (11 tasks, taskSet v2 — T11 is the GFI-3 hardness suite).
- **Shipped but hardware-dependent:** `HIDDevice` adapter (dynamic import, graceful fallback). Never tested on physical hardware during development.
- **Shipped but user-validation pending:** tactile text→dots mapping (`charCode % 64`, byte-stable but _not_ standard braille), screen-reader UX beyond automated audits.

## What it does NOT claim

- Readable braille on hardware — unvalidated.
- Any specific display "works" — none tested.
- Retrieval quality numbers — no benchmark exists.
- Calibrated confidence — it is a clamped retrieval score.
- Networked marketplace installs — fixture catalog only.

If a sentence outside the capability matrix implies one of the above, it is a bug — report it.

## The 9-step hand-off (what you will do)

1. `clone` — `git clone <repo-url> autosd && cd autosd`
2. `install` — `npm run bootstrap` (install → typecheck → lint → format → test → build)
3. `verify` — `npm run verify` (same gate without install)
4. `demo` — `npm run demo` (7 steps, byte-identical second run)
5. `evaluate` — `npm run evaluate` (11 tasks, taskSet v2)
6. `inspect artifacts` — open `evaluation-output/evaluation.json` + `evaluation.md` + `environment.json` (see below)
7. `understand boundaries` — read `CAPABILITY_MATRIX.md` + this guide's validation table
8. `report` — fill the **Evaluation report** issue template
9. `issue/PR` — submit; maintainers triage, never auto-merge into claims

Prerequisites: Node ≥20, npm ≥10. No hardware, no keys, no accounts.

```bash
git clone <repo-url> autosd && cd autosd
npm run bootstrap        # install → typecheck → lint → format → test → build
npm run evaluate         # 11-task run → evaluation-output/{evaluation.json, evaluation.md, environment.json}
```

## How to evaluate (15 minutes)

Read the outputs: [EVALUATION_TASKS.md](EVALUATION_TASKS.md) explains each task; [EVALUATION_SCHEMA.md](EVALUATION_SCHEMA.md) defines the machine schema and timing disclaimer.

Reproducibility: `environment.json` is byte-identical across runs; `evaluation.json` differs only in `durationMs` (observed, never a threshold).

Optional cross-check:

```bash
node scripts/run-evaluation.mjs --validate evaluation-output/evaluation.json
node scripts/check-evaluation-baseline.mjs   # regression gate vs evaluation.baseline.json
```

## How to report results

Use the **Evaluation report** issue template (`.github/ISSUE_TEMPLATE/evaluation_report.yml`). Include:

- `environment.json` contents (or OS/Node/npm)
- which task(s) and expected vs actual
- reproduction steps
- attach `evaluation.json` (privacy scan inside the artifact reads `PASS`; templates require you to confirm you stripped secrets)

Partial runs and negative results are welcome. Security findings go via [SECURITY.md](../SECURITY.md), not a public issue.

## How to test hardware (only if you own a display)

1. Read [HARDWARE_INTEGRATION.md](HARDWARE_INTEGRATION.md) — first-contact procedure and the report template.
2. Do **not** expect the standard `npm run evaluate` to touch hardware; it never does.
3. File your session notes as an issue labeled `hardware` — success or partial failure both count. Until a documented session exists, the project treats the HID path as unvalidated.

## How validation kinds are distinguished

| Kind you file        | Produces                   | Evidence it needs                                          |
| -------------------- | -------------------------- | ---------------------------------------------------------- |
| `AUTOMATED`          | `npm run evaluate`         | none beyond its own artifact                               |
| `MANUAL`             | your checklist walkthrough | steps + screenshots/observations                           |
| `HARDWARE-VALIDATED` | documented device session  | device model, transport, logs, what failed                 |
| `USER-VALIDATED`     | study with participants    | methodology, consent, protocol — never bundled anonymously |

The schema validator (`--validate`) rejects any task marked `HARDWARE-*`/`USER-VALIDATED` without substantive evidence — this is intentional, to prevent implied validation.

Provenance handling: artifacts carrying `provenance: maintainer-ci` are pipeline-generated; anything else (or missing field) is treated as `external self-reported`. External evidence is **never** auto-merged into README or release notes — maintainers triage it first.

## Privacy expectations

- Automated artifacts record only: `osPlatform/osRelease/arch/nodeVersion/npmVersion`, task counts/statuses, and timings. No absolute paths, no document contents, no env vars.
- Before writing, the runner scans its own JSON against secret/PII/path patterns. `FAIL` ⇒ nothing written.
- When filing an issue, paste `environment.json` (which is safe by construction) rather than `env` dumps. Redact screenshots.
- Never invent participant data. Synthetic fixtures already exist for validator tests.

## How to become a contributor

Pick a lane in [CONTRIBUTOR_MAP.md](CONTRIBUTOR_MAP.md) and an entry in [GOOD_FIRST_ISSUES.md](GOOD_FIRST_ISSUES.md). The minimal plugin walkthrough is [PLUGIN_GUIDE.md](PLUGIN_GUIDE.md#the-complete-walkthrough-devices--diagnostics) (`src/examples/MinimalTactilePlugin.ts`). Every PR runs the same gates you just ran; see [CONTRIBUTING.md](../CONTRIBUTING.md) for the checklist.
