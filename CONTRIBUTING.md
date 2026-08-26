# Contributing to AutoSD

Thanks for helping build AutoSD. This guide covers setup, the verification gate, and how to get a change merged. These docs track the current tree (275 tests across 49 files; v1.0.0 was 219/43 — see `evaluation.baseline.json`) and set contributor expectations for the v1.x line.

New here? Read in this order:

1. `docs/GETTING_STARTED.md` — clone → run → verify → demo in five minutes
2. `docs/CONTRIBUTOR_MAP.md` — find the lane that fits you
3. `docs/DEVELOPMENT.md` for day-to-day workflow
4. `docs/ARCHITECTURE.md` for how the pieces fit
5. The guide for your area: `docs/PLUGIN_GUIDE.md`, `docs/RESEARCH_GUIDE.md`, or `docs/HARDWARE_INTEGRATION.md`

## Requirements

| Tool    | Version | Notes                 |
| ------- | ------- | --------------------- |
| Node.js | >=20    | `node -v` to check    |
| npm     | >=10    | ships with Node 20    |
| Git     | any     | clone and branch only |

No native toolchain. No hardware required. `node-hid` is an optional peer; everything works with `MockDevice` and `VirtualDevice`.

## One-command setup

```bash
npm run bootstrap
```

This checks your Node version, installs dependencies if needed, then runs typecheck, lint, format check, tests, and build. If it prints `✓ Bootstrap complete`, you are ready.

## One-command verification

```bash
npm run verify
```

This is the merge gate. It runs, in order:

1. `typecheck`: `tsc --noEmit`, strict mode
2. `lint`: eslint 9 with typescript-eslint
3. `format`: prettier check over `src/`, `tests/`, and root `*.md`
4. `test`: vitest run (suites mirror `src/`: core, devices, plugins, workflows, retrieval, ui, app, a11y, e2e)
5. `build`: `tsc` emit plus `vite build`

CI runs the same gate on every push to `main` and every PR (see `.github/workflows/ci.yml`). A separate Lighthouse workflow builds the app, serves it, and fails if accessibility drops below 95 or performance below 90.

Run `npm run verify` before every PR. If prettier complains, run `npm run format:fix`. If eslint complains, run `npm run lint:fix`.

### Release-quality verification

`npm run verify` never starts a server, which is what keeps it fast — unit tests do not depend on one. The served-app audit lives behind a second gate:

```bash
npm run verify:release
```

This builds the app, serves `dist-app/` on `127.0.0.1:4173`, waits for HTTP readiness, runs headless-Chrome Lighthouse (`accessibility` + `performance`), and enforces accessibility ≥ 95 / performance ≥ 90 via `scripts/lighthouse-gate.mjs` — the same thresholds and script the Lighthouse workflow enforces in CI. It needs Chrome installed and stops the preview server when done.

You do not need to run it for every change; CI always does. Run it locally when your change touches UI, routing, styling, or anything else Lighthouse can see. Details in `docs/DEVELOPMENT.md` ("Fast vs release verification").

## Evaluation duties

Every PR that touches retrieval, devices, app bootstrap, or the evaluation engine should include a fresh evaluation:

```bash
npm run evaluate
node scripts/run-evaluation.mjs --validate evaluation-output/evaluation.json
```

If a task fails:

1. Read its row in `docs/EVALUATION_TASKS.md` for the expected result and failure interpretation.
2. Reproduce with `npm run demo` + `npm test` for focused area.
3. Attach only the three safe files (`evaluation.json`, `evaluation.md`, `environment.json`) — never secrets, paths, or document contents.
4. Open an issue via the **Evaluation report** template (its fields cover environment, task ID, expected/actual, steps, artifact, hardware).
5. Optionally submit the fix as a PR; keep the issue link.

External reports never auto-merge into README or release claims — maintainers triage them first (see `docs/EVALUATION_SCHEMA.md` provenance rules).

## Finding work

Check the issue tracker for open issues. Label taxonomy for evaluation reports:

- `evaluation`: any `npm run evaluate` result (pass or fail — negative results are welcome)
- `bug`: something is broken as described
- `feature`: new capability, additive by preference
- `docs` / `documentation`: documentation only
- `a11y` / `accessibility`: accessibility gaps, treated as defects
- `hardware`: physical device sessions or compatibility
- `research`: retrieval quality, benchmarks, methodology
- `security`: use `SECURITY.md` privately, never a public issue
- `rfc`: changes that touch a public contract (`Device`, `Plugin`, `EmbeddingProvider`, exported types)

Triage without a conversation: the **Evaluation report** template provides environment, version, task ID, expected/actual, steps, artifact, and hardware fields — enough to apply the right label. Hardware info present → `hardware`; screen-reader mention → `accessibility`; retrieval/citation → `research`; schema violation output → bounce with `node scripts/run-evaluation.mjs --validate` guidance; security hint → close and redirect to `SECURITY.md`.

Contract changes always start as an RFC issue before code. See "Additive-only rule" below.

## Branch and commit workflow

1. Fork or branch from `main`:

   ```bash
   git checkout -b feat/my-change main
   ```

2. Branch names: `feat/...`, `fix/...`, `docs/...`, `test/...`, `chore/...`, `refactor/...`.
3. Keep commits small and focused. One logical change per commit.
4. Commit messages use a Conventional Commits style prefix:

   ```
   feat(retrieval): add LexicalReranker boost tuning
   fix(ui): restore focus after VirtualList scroll
   docs: expand deployment guide
   ```

5. Rebase onto `main` before opening the PR if `main` has moved. Avoid merge commits.

## Pull request process

1. Push your branch and open a PR against `main`.
2. Fill in the PR description: what changed, why, and how you tested it.
3. Confirm CI is green. The verify workflow and the Lighthouse workflow must both pass.
4. A maintainer reviews. Address feedback in new commits; do not force-push mid-review.
5. Squash-merge on approval unless the discussion favors keeping individual commits.

### PR checklist

- [ ] `npm run verify` passes locally
- [ ] If retrieval/devices/app bootstrap or evaluation could be affected: `npm run evaluate` passes and artifacts are privacy-clean (see `docs/INDEPENDENT_EVALUATION.md`)
- [ ] UI-affecting changes: `npm run verify:release` passes locally (CI's Lighthouse job runs it regardless)
- [ ] Tests cover the new behavior or the fixed bug
- [ ] No public contract field was removed or renamed
- [ ] UI changes keep WCAG 2.2 AA behavior (contrast, target size, focus order, live regions)
- [ ] Docs updated when behavior, scripts, or architecture changed
- [ ] No new runtime `dependencies` without an approved RFC

## Code style

TypeScript strict everywhere. The compiler settings live in `tsconfig.json`; prettier settings in `.prettierrc.json`:

- 2-space indent, 100-char print width
- Double quotes, semicolons, trailing commas
- Arrow functions drop parens when there is one parameter

Lint rules worth knowing (`eslint.config.js`):

- `@typescript-eslint/no-explicit-any`: warn. Prefer real types; avoid `any`.
- `@typescript-eslint/no-unused-vars`: warn. Prefix intentionally unused params with `_`.
- `prefer-const`: warn.

Conventions used across `src/`:

- Relative imports end in `.js` (for example `import { Registry } from "./Registry.js"`). Keep this; the bundler and tsc both rely on it.
- Use `import type` for type-only imports. `isolatedModules` is on.
- Public types are `readonly` fields where practical. Follow the existing style.
- New exports go through `src/index.ts` so the public barrel stays complete.

## The additive-only rule

The core contracts are stable seams. `Device` (since v0.1), `Plugin`, `EmbeddingProvider`, `Registry`, `DIContainer`, `DeviceManager`, `PluginHost`, and `ResearchWorkflow` follow one rule: **never remove or rename an existing field or method**. Add new optional fields instead. Breaking changes require an RFC, a migration note, and a major version.

If your change would alter a shape that other code already consumes, stop and open an RFC issue first.

## Testing expectations

- Tests live in `tests/` and mirror the `src/` layout (`tests/retrieval/pipeline.test.ts` tests `src/retrieval/pipeline.ts`).
- Default vitest environment is `node`. For DOM components add `/** @vitest-environment jsdom */` at the top of the file, like `tests/ui/virtualList.test.ts` does.
- Devices: test against `MockDevice` and `VirtualDevice`. HID tests must pass without hardware.
- Retrieval: use `MockEmbeddingProvider` for determinism. Never call the network in tests.
- Bug fixes get a regression test that fails without the fix.

## Accessibility expectations

Accessibility is structural, not bolted on. All WCAG 2.2 AA thresholds come from `src/accessibility/a11y.ts`. Import from it; never duplicate thresholds in feature code. Any DOM you render should have correct roles, labels, keyboard support, and live-region announcements where status changes. The Lighthouse CI job enforces a 95+ accessibility score on the built app.

## Documentation expectations

Update docs in the same PR when you change behavior:

| Change                                | Update                      |
| ------------------------------------- | --------------------------- |
| Scripts, env vars, dev workflow       | `docs/DEVELOPMENT.md`       |
| Architecture, seams, data flow        | `docs/ARCHITECTURE.md`      |
| Plugin contract or lifecycle          | `docs/PLUGIN_GUIDE.md`      |
| Retrieval pipeline, providers, corpus | `docs/RESEARCH_GUIDE.md`    |
| Build output, hosting, CI gates       | `docs/DEPLOYMENT.md`        |
| Setup or contribution flow            | this file or `BOOTSTRAP.md` |

Keep docs honest. Mark anything not yet implemented as pending rather than describing it as done.

## What not to bring

- No backend services or databases. AutoSD is local-first with file persistence under `corpus/`.
- No new runtime dependencies. The core has zero runtime deps; devDependencies cover tooling.
- No fabricated numbers. Benchmarks, coverage claims, and hardware results need reproducible evidence in the PR.

## License

AutoSD is released under the [MIT License](LICENSE). By opening a PR, you agree that your contribution is licensed under those same terms.
