# Contributor Safety

What contributors can safely run, what touches the network or filesystem, and where the trust boundaries are. Every statement below was audited against the v1.0.0-based tree; anything not yet hardened is listed openly under "Known gaps".

## Secrets model

- **`VITE_`-prefixed variables are public by design** — they ship in the client bundle (`.env.example`, `src/app/config.ts`). The config loader rejects credential-bearing URLs, strips userinfo, warns when a variable name looks like a secret (`VITE_OPENAI_API_KEY`), and never treats api.openai.com as a keyless endpoint.
- **`OPENAI_API_KEY` is read only from `process.env`** (server/CLI context), never from `import.meta.env`; absent keys fall back to the offline mock provider. Tests enforcing key exclusion live in `tests/app/security.test.ts` and `tests/retrieval/openai.test.ts`.
- **`.env` / `.env.local` are git-ignored.** Nothing in the repo reads them for secrets.
- **Diagnostics are metadata-only**: `collectDiagnostics()` runs every value through `sanitize()`, which redacts sensitive-looking keys (`api[-_]?key|token|secret|password|authorization|credential|bearer|cookie|session[-_]?id`) and drops stack traces. Reports are designed to be pasted into public issues.
- **Evaluation artifacts are privacy-gated by construction**: `npm run evaluate` records only an environment allowlist (platform/release/arch/versions), scans its own output against secret/path/PII patterns before writing, and refuses to emit artifacts when anything matches. Details: [INDEPENDENT_EVALUATION.md](INDEPENDENT_EVALUATION.md), [EVALUATION_SCHEMA.md](EVALUATION_SCHEMA.md).

## Scripts: what executes, and how

| Script                       | Execution surface                                                                         | Safety notes                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `scripts/bootstrap.mjs`      | `execSync` of **fixed** npm script names (`typecheck`, `lint`, `format`, `test`, `build`) | No user input is interpolated; Node >= 20 gate up front |
| `scripts/run-demo.mjs`       | Loads `src/app/demo.js` through Vite SSR in-process                                       | Writes only the path you pass (`--out`); no network     |
| `scripts/verify-release.mjs` | Spawns `node <vite preview>` with constant args; runs Lighthouse via npx                  | Serves on `127.0.0.1:4173`; kills the child on exit     |
| `scripts/write-healthz.mjs`  | Writes `dist-app/healthz.json`                                                            | Build output only                                       |
| husky (`prepare`)            | Best-effort: `husky install \|\| echo skip`                                               | Hooks never block environments that don't use them      |

No `eval`, `new Function`, or dynamic code construction exists anywhere in `src/` or `scripts/`. The only two `child_process` imports in the repo are the fixed-command uses above.

## Generated artifacts and large files

Ignored by `.gitignore`: `node_modules/`, `dist/`, `dist-app/`, `coverage/`, `.env*`, logs, `lighthouse*.json` reports, `.codegraph/`, runtime corpus state (`corpus/index.json`, `corpus/sessions.json`), and `evaluation-output/` (allowlisted artifacts only). A curated `corpus/docs/` **can** still be committed deliberately.

Audited state: after Cycle 5, the largest tracked file is `package-lock.json` (~190 KB). A stale generated artifact (`lighthouse2.json`, 113 KB, referenced nowhere) was removed from tracking in Cycle 2. Legitimate evidence files stay tracked intentionally (`docs/lighthouse-v09-summary.json`, referenced by [PERFORMANCE.md](PERFORMANCE.md)).

## Lockfile discipline

- `npm ci` in all three CI workflows installs exactly from `package-lock.json` (lockfileVersion 3).
- Package version and lockfile root entry match (`1.0.0`).
- **Zero runtime dependencies** — everything in the lockfile is dev tooling, which keeps supply-chain surface minimal.

## Release and tag permissions

- All three workflows trigger on `push: branches: [main]` and pull requests only — **no tag triggers**, so nothing in CI can create or move a release tag. Tagging is a deliberate, manual maintainer action. `evaluation.yml` additionally runs on `schedule: cron "17 3 * * *"` and `workflow_dispatch` (both trusted, no external keys required).
- Workflows run with least privilege:
  - `ci.yml`: `permissions: contents: read`
  - `lighthouse.yml`: `permissions: contents: read, actions: write` (extra `actions: write` only for `upload-artifact`)
  - `evaluation.yml`: `permissions: contents: read, actions: write` (extra `actions: write` only for the allowlisted `evaluation.json`/`evaluation.md`/`environment.json` upload)
  - No workflow requests `pull-requests: write`, `issues: write`, or `secrets` access. Fork PRs run with the same read-only token and cannot exfiltrate secrets.
- Workflows pin third-party actions to major versions (`actions/checkout@v4`, `actions/setup-node@v4`) and upload via `actions/upload-artifact@v4`. No workflow interpolates untrusted PR input into shell commands — all `run:` steps are fixed `npm` invocations.

## Known gaps (documented, not hidden)

1. **Actions are pinned to major tags, not commit SHAs.** Tag pins track vetted majors but not immutable revisions. SHA pinning would remove tag-mutability risk at the cost of update churn — tracked as future hardening.
2. **Lighthouse is pulled at runtime** (`npx --yes lighthouse@12`) inside CI — version-pinned but not digest-pinned.
3. **Windows/macOS are not covered by CI** (ubuntu-only). Windows is verified manually each cycle (see [FRESH_CONTRIBUTOR_TEST.md](FRESH_CONTRIBUTOR_TEST.md)); macOS has no automated or recorded coverage yet.

Reporting vulnerabilities: follow [../SECURITY.md](../SECURITY.md) — do not open public issues for security problems.
