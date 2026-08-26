# First-Contributor Checklist

A 10-minute self-test that the repository is contributable without maintainer help. Check each box in order; every command below is real and was verified on a clean clone.

## Clone

- [ ] `git clone <repo-url> autosd && cd autosd` — no auth prompts beyond GitHub, no submodules.

## Install

- [ ] `node -v` → `v20.x` or newer (engines: `>=20`)
- [ ] `npm install` — zero runtime deps installed; dev tooling only (TypeScript, Vitest, Vite, ESLint, Prettier)

## Verify

- [ ] `npm run verify` — typecheck · lint · format · **275 tests / 49 files** · build all green. See [CONTRIBUTING.md](../CONTRIBUTING.md#one-command-verification) for the gate.

## Evaluate

- [ ] `npm run evaluate` — 11/11 tasks `pass`, `privacy scan PASS`, artifacts in `evaluation-output/` (see [INDEPENDENT_EVALUATION.md](INDEPENDENT_EVALUATION.md))

## Demo

- [ ] `npm run demo` — 7 steps, byte-identical second run. Browser equivalent at `#/demo`.

## Tests understandable

- [ ] `tests/` mirrors `src/` (`tests/retrieval/pipeline.test.ts` ↔ `src/retrieval/pipeline.ts`); `tests/examples/minimal-tactile-plugin.test.ts` shows plugin lifecycle.

## Issue templates understandable

- [ ] `.github/ISSUE_TEMPLATE/evaluation_report.yml` — fields for environment, task IDs, expected/actual, steps, allowlisted artifact, hardware, attestations. No personal data requested.

## Contribution instructions sufficient

- [ ] `CONTRIBUTING.md` — branch naming, additive-only rule, PR checklist (including `npm run evaluate` when relevant).

## Plugin path understandable

- [ ] `docs/PLUGIN_GUIDE.md` → `src/examples/MinimalTactilePlugin.ts` — copy, rename id, `PluginHost` registration, `npm test` still green.

## Evaluation path understandable

- [ ] `docs/EXTERNAL_EVALUATOR_GUIDE.md` + `docs/EVALUATION_TASKS.md` + `docs/EVALUATION_SCHEMA.md` — what is/isn't claimed, how to run, how validation levels are enforced.

All boxes checked without asking a maintainer? The hand-off works. File anything unclear as a `documentation` issue.
