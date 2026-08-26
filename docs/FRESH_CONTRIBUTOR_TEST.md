# Fresh Contributor Test

A reproducible end-to-end check that a newcomer can complete the full contributor path — clone → install → verify → run → understand → extend → PR — using only this repository. Every command below was executed and its output recorded on the reference environment during the Cycle 2 audit.

Reference environment: **Windows 11 · Node v22.14.0 · npm 10.9.2**. CI additionally proves the same path green on **Ubuntu (ubuntu-latest, Node 20)** on every push/PR (`.github/workflows/ci.yml`). macOS has no recorded coverage yet — see [CONTRIBUTOR_SAFETY.md](CONTRIBUTOR_SAFETY.md) "Known gaps".

## Step 0 — Environment

```bash
node -v   # must be >= 20  → recorded: v22.14.0
npm -v    # ships with Node 20 → recorded: 10.9.2
git clone <repo-url> autosd && cd autosd
```

Expected: no native toolchain prompts, no Python requirement. The project is TypeScript-on-Node only.

## Step 1 — One-command setup + verification

```bash
npm run bootstrap
```

What it does (`scripts/bootstrap.mjs`): checks Node >= 20 → installs if `node_modules` absent → `typecheck` → `lint` → `format` → `test` → `build`.

Expected tail of output:

```
Node v22.14.0 OK        ← or your own version
$ npm run typecheck … $ npm test … $ npm run build
✓ built in ~200ms
write-healthz: dist-app/healthz.json written

✓ Bootstrap complete. See BOOTSTRAP.md for next steps.
```

Expected test summary at time of writing: `Test Files 44 passed (44)` / `Tests 224 passed (224)`. Record whatever you actually see — counts move as tests are added, failures do not.

## Step 2 — Run the deterministic demo

```bash
npm run demo -- --out my-first-run.json
```

(If your npm strips `--out`, a bare positional path works too: `npm run demo -- my-first-run.json`.)

Expected: seven progress lines on stderr — ingest → reader → search → citations → tactile → diagnostics → export — ending in `✓ Demo complete.` and a JSON file containing `"demo": "autosd-demo"`, `"demoVersion": 2`, a `reader` field, citations, tactile frames, and diagnostics.

Determinism proof:

```bash
npm run demo -- --out run-b.json
# compare hashes (any tool); recorded result: identical SHA256 across runs
```

## Step 3 — Run the app

```bash
npm run dev     # http://localhost:5173 (strict port)
```

Walk: onboarding → `#/workspace` search → `#/research` query → `#/sessions` export → `#/devices` → `#/demo`. Then try dropping a `.md` file into `corpus/docs/` while it runs and watch live sync pick it up (~150 ms debounce).

## Step 4 — Understand the architecture (15 minutes)

Read in this order:

1. [ARCHITECTURE_FLOWS.md](ARCHITECTURE_FLOWS.md) — five flow diagrams mapped to source files
2. [../CONTRIBUTING.md](../CONTRIBUTING.md) — merge gate, additive-only rule, branch conventions
3. [PLUGIN_GUIDE.md](PLUGIN_GUIDE.md) — plugin lifecycle

## Step 5 — Build the example plugin path

The complete walkthrough already exists; run its tests instead of writing from scratch first:

```bash
npx vitest run tests/examples
```

Expected: `5 passed` — register → activate → render onto VirtualDevice → deactivate → hot-swap, plus MockDevice contract-compatibility and issue-safe-output assertions.

Source to read: [`src/examples/MinimalTactilePlugin.ts`](../src/examples/MinimalTactilePlugin.ts). Copy it, rename ids, change one behavior, re-run. That is the whole extension model.

## Step 6 — Produce a minimal PR

1. Pick an item from [GOOD_FIRST_ISSUES.md](GOOD_FIRST_ISSUES.md) ownership map.
2. `git checkout -b docs/my-change main`
3. Make the change; add/update a test when behavior changes.
4. `npm run verify` — must pass locally.
5. Open the PR with: what changed / why / how you tested it. CI runs the same gates plus Lighthouse (a11y ≥ 95).

PR checklist (mirrors CONTRIBUTING):

- [ ] `npm run verify` passes locally
- [ ] Behavior changes ship with tests; bug fixes include a failing-before regression test
- [ ] No public contract field removed or renamed (additive-only)
- [ ] Docs updated in the same PR
- [ ] No new runtime dependencies without an approved RFC
- [ ] No fabricated numbers anywhere in the diff

## Where this test was last executed

| When          | Where                     | Result                                                                                  |
| ------------- | ------------------------- | --------------------------------------------------------------------------------------- |
| Cycle 2 audit | Windows 11, Node v22.14.0 | Steps 0–2, 5–6 verified with outputs above; step 3 verified via suite + build artifacts |

Add your row after running it — including partial or negative results.
