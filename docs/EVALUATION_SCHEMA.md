# Evaluation Result Schema (v1)

Stable contract for AutoSD evaluation artifacts (`evaluation.json`). Versioned via `schemaVersion`; breaking changes bump the version and are documented here. The runner validates every artifact against this schema before sharing (`node scripts/run-evaluation.mjs --validate <file>`).

## Design rule

**The schema cannot imply evidence that was not produced.** Concretely: any task recorded at `HARDWARE-CONNECTED`, `HARDWARE-VALIDATED`, or `USER-VALIDATED` is rejected by the validator unless it carries substantive detail, an evidence object, or evaluator notes explaining how that evidence was produced. Automated runs can only ever emit `SOFTWARE-VERIFIED`.

## Top-level fields

| Field            | Type                          | Notes                                                                                                             |
| ---------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `schema`         | `"autosd-evaluation"`         | constant                                                                                                          |
| `schemaVersion`  | `1`                           | integer, this contract                                                                                            |
| `evaluationKind` | enum                          | `AUTOMATED` \| `MANUAL` \| `USER-VALIDATED` \| `HARDWARE-VALIDATED` — what _kind_ of session produced this record |
| `appVersion`     | string                        | package version at evaluation time                                                                                |
| `build`          | string                        | build stamp (`dev` when not injected)                                                                             |
| `environment`    | object                        | `osPlatform`, `osRelease`, `arch`, `nodeVersion`, `npmVersion?` — allowlist only; nothing else about the machine  |
| `hardwareStatus` | enum                          | `NONE` \| `NOT-TESTED` \| `CONNECTED-UNVERIFIED` \| `HARDWARE-VALIDATED`                                          |
| `generatedAt?`   | string                        | ISO timestamp — only present with `--stamp`; omitted for byte-stable comparisons                                  |
| `timingPolicy`   | `"observed-nondeterministic"` | declares that durations vary across runs                                                                          |
| `notes`          | string[]                      | evaluator notes; empty in automated output                                                                        |
| `tasks[]`        | array                         | see below                                                                                                         |
| `privacyScan`    | object                        | `{ status: "pass"\|"fail", matches: [] }` — pattern names only, never matched content                             |
| `summary`        | object                        | `{ total, passed, failed, skipped, allPassed }` — validator cross-checks counts against `tasks[]`                 |

## Task entries

| Field             | Type   | Notes                                                                |
| ----------------- | ------ | -------------------------------------------------------------------- |
| `id`              | string | matches `T##-NAME` (see [EVALUATION_TASKS.md](EVALUATION_TASKS.md))  |
| `status`          | enum   | `pass` \| `fail` \| `skipped`                                        |
| `detail`          | string | metadata-only outcome line                                           |
| `durationMs`      | int    | observed wall time; naturally variable                               |
| `validationLevel` | enum   | evidence class, see below                                            |
| `evidence?`       | object | small scalars (counts, versions, booleans) — never contents or paths |

## Validation levels (C3.8 boundary)

From weakest to strongest claims:

| Level                 | Meaning                                                                              | Who may set it                               |
| --------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------- |
| `SOFTWARE-VERIFIED`   | reproduced by automated software tasks on this run                                   | `npm run evaluate` (automatic)               |
| `SOFTWARE-SCAFFOLDED` | code ships and software paths verified, real target unexercised (e.g., HID fallback) | humans, with file references                 |
| `HARDWARE-CONNECTED`  | a physical device was connected; behavior observed but not validated                 | humans, requires evidence text               |
| `HARDWARE-VALIDATED`  | documented, reproducible hardware session incl. what failed                          | humans, requires evidence text + methodology |
| `USER-VALIDATED`      | study/method with human participants, published methodology                          | humans, requires evidence text + methodology |

Rules enforced by `validateEvaluation()`:

1. The three strongest levels require proof-carrying annotations (detail > 40 chars, evidence object, or long notes). Bare claims are rejected.
2. `summary` counts must match the actual `tasks[]` distribution.
3. Unknown task ids, statuses, levels, hardware statuses, or kinds are rejected.
4. Malformed JSON is rejected with a graceful error list (exit code 2), never an exception.

## Evidence classes vs. claim kinds

| Record kind        | Produced by                      | May contain levels                                      |
| ------------------ | -------------------------------- | ------------------------------------------------------- |
| AUTOMATED          | `npm run evaluate`               | SOFTWARE-VERIFIED only                                  |
| MANUAL             | human following checklists/tasks | SOFTWARE-SCAFFOLDED, HARDWARE-CONNECTED (with evidence) |
| HARDWARE-VALIDATED | documented device sessions       | HARDWARE-* (with evidence)                              |
| USER-VALIDATED     | participant studies              | USER-VALIDATED (with methodology)                       |

An AUTOMATED artifact can never be upgraded in place; stronger claims live in new records/issues that reference the automated artifact as supporting material.

## Reproducibility note

Across two clean runs: `environment.json` is byte-identical; `evaluation.json` differs only in `durationMs` values. Collapse those (`"durationMs": N → X`) and the files are identical. Anything else differing is a reportable finding.
