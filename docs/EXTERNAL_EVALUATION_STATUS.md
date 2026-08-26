# External Evaluation Status

**EXTERNAL_EVALUATION_STATUS = NOT_YET_PERFORMED**

No real external evaluator has yet submitted a report using the canonical path (`docs/EXTERNAL_EVALUATOR_GUIDE.md` → `npm run evaluate` → issue template).

What this means:

- All `AUTOMATED` results in this repository are maintainer-generated (CI or local verified runs).
- All `HARDWARE-*` / `USER-VALIDATED` claims remain unproven — see `docs/CAPABILITY_MATRIX.md`.
- The ingestion path (`scripts/run-evaluation.mjs --validate` + provenance check) is tested on synthetic fixtures only — see `tests/app/evaluation.test.ts`.

When the first external report arrives, this file will be updated to `PERFORMED` with a link to the issue and the provenance `external-self-reported` will be recorded in `evaluation.json`. Until then, do not imply external validation has happened.
