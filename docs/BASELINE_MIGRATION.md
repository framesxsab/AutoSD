# Baseline Migration Guide

How `evaluation.baseline.json` evolves safely. The baseline is versioned evidence, not a dashboard to silently edit.

## Versioning

| Field             | Where                                                                            | Meaning                                                                  |
| ----------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `schemaVersion`   | `src/app/evaluation.ts` `EVALUATION_SCHEMA_VERSION` + `evaluation.baseline.json` | Machine schema contract; bump breaks every stored artifact and validator |
| `taskSetVersion`  | `src/app/evaluation.ts` `TASK_SET_VERSION` + `evaluation.baseline.json`          | The 10-task set; bump when tasks are added, removed, or redefined        |
| `baselineVersion` | `evaluation.baseline.json`                                                       | File revision for human review; bump on every intentional baseline edit  |

`schemaVersion` and `taskSetVersion` are checked by `validateEvaluation()` and `check-evaluation-baseline.mjs`. Mismatches produce explicit CI messages, not silent drift.

## Task-set change taxonomy

| Change           | Detection                                        | Gate result                                                   | Action                                                                                                                |
| ---------------- | ------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Unchanged**    | id + `status` + `validationLevel` match baseline | PASS                                                          | none                                                                                                                  |
| **New task**     | `live` id not in baseline `requiredTasks`        | WARN if `pass`, FAIL if new task `fail` — message points here | Add entry to `requiredTasks`, bump `taskSetVersion` and `baselineVersion`, document why in PR                         |
| **Changed task** | same id, different `status` or `validationLevel` | `status` regression → FAIL; `validationLevel` drift → WARN    | Fix code or intentionally update baseline; bump versions; explain boundary intent (see `EVALUATION_SCHEMA.md` levels) |
| **Removed task** | baseline id missing from live run                | FAIL (`required task missing`)                                | Only after task is intentionally retired; remove entry, bump versions, document removal reason                        |

## Migration rules

1. **Never silently modify `evaluation.baseline.json`.** Every change is a reviewed PR with this checklist:
   - [ ] `npm run evaluate` passes locally (11/11)
   - [ ] `node scripts/check-evaluation-baseline.mjs` output reviewed (shows new/changed/removed)
   - [ ] `taskSetVersion` bumped if tasks changed
   - [ ] `baselineVersion` bumped
   - [ ] PR description states which category (new/changed/removed) and why
   - [ ] `suiteCounts` updated if tests grew (counts may only grow)
   - [ ] `durationsMsAdvisory` refreshed from a verified run if timings shifted

2. **Informative CI failures:** the gate script prints exact ids and the section of this doc to read. Example:
   - `new task T11-XYZ detected (was not in baseline v1) — if intentional, update evaluation.baseline.json per docs/BASELINE_MIGRATION.md`
   - `task set version drift: report v2 vs baseline v1 — see docs/BASELINE_MIGRATION.md`

3. **Warnings stay non-blocking** unless they indicate integrity/privacy/schema failure. Duration drift (`>10× advisory`) and new-task-pass are WARN; they never hide a FAIL.

4. **Schema bumps are rare** and require `validateEvaluation()` + baseline + docs (`EVALUATION_SCHEMA.md`) to move together. Do not add a new `validationLevel` without updating the schema enum and this file.

## Example PR description snippet

```
baseline: add T11-RETRIEVAL-QUALITY (new task, taskSetVersion 1→2)

- T11 added as SOFTWARE-VERIFIED, synthetic corpus x2 + recall@k fixture
- baselineVersion 1→2, taskSetVersion 1→2, suiteCounts 46/239→47/244
- durationsMsAdvisory refreshed from local verified run
- gate: WARN for new task now, PASS after baseline merge
```
