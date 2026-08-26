# Clean-Clone Verification

A deterministic path that proves a fresh clone works without personal state. Use it on a new machine, a CI container, or a `git clone` into `/tmp` — no corpus, secrets, or hardware required.

## Steps

```bash
git clone <repo-url> autosd && cd autosd
node -v   # must be >=20
npm ci
npm run verify        # typecheck · lint · format · test (49 files, 275 tests) · build
npm run evaluate      # 11/11 SOFTWARE-VERIFIED, privacy PASS, artifacts in evaluation-output/
npm run demo -- --out /tmp/demo.json && npm run demo -- --out /tmp/demo2.json && cmp /tmp/demo.json /tmp/demo2.json
```

## macOS volunteer handoff (C9.1) — ENVIRONMENT VALIDATION REQUIRED

The only remaining platform gap is macOS. Do **not** claim macOS validation unless you actually run it on macOS.

Volunteer (on a Mac):

```bash
git clone <repo-url> autosd && cd autosd
node -v; npm -v
npm ci
npm run verify
npm run evaluate
npm run demo -- --out /tmp/macos-demo.json
cat evaluation-output/environment.json
cat evaluation-output/evaluation.json | head -20
```

Expected: `verify` `275 passed`, `evaluate` `11/11`, `demo` 7 steps, artifacts leak-clean. Capture `environment.json` (`osPlatform: darwin`) and submit via the **Evaluation report** template with `provenance: external-self-reported` and label `evaluation`.

If macOS is unavailable in the current environment, do **not** simulate — classify as **ENVIRONMENT-VALIDATION-REQUIRED** and leave this handoff. See `docs/EXTERNAL_EVALUATION_STATUS.md`.

Expected: `verify` prints `✓ built in ...` and `write-healthz...`; `evaluate` prints `11/11 passed`; `demo` prints 7 progress lines and the two `demo.json` files are byte-identical.

## What this does NOT rely on

- **Local corpus:** `corpus/` may be absent. `npm run verify` and `npm run evaluate` use synthetic in-repo fixtures only. Adding your own files to `corpus/docs/` is optional and never required for verification.
- **Personal configuration:** no `.env`, no `OPENAI_API_KEY`, no `corpus/index.json` needed — absent values fall back to the offline mock provider.
- **Local secrets:** `.env` is gitignored; the evaluator never reads it. Secrets that would be read only in server context are documented in `.env.example` but not required.
- **Pre-existing generated files:** `dist/`, `dist-app/`, `coverage/`, `evaluation-output/` are gitignored; `verify` and `evaluate` recreate them.
- **External users or hardware:** `MockDevice`/`VirtualDevice` cover all device tests; HID-dependent code is contract-tested in fallback mode only.

## Platform limitations (documented, not hidden)

| Limitation                                    | Detail                                                                                                                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify:release` (Lighthouse) requires Chrome | Not part of this path; run separately where Chrome is available. The nightly `evaluation` job does not require it.                                                                      |
| Windows vs Linux                              | Both verified: CI on `ubuntu-latest` (Node 20) and manual Windows 11 (Node 22). macOS has no recorded coverage yet — expected to work, but file a `documentation` issue if it does not. |
| Absolute paths in diagnostics                 | `collectDiagnostics()` never emits absolute paths; the evaluator scans for `C:\Users`, `/home/`, etc., and fails if any appear.                                                         |
| Network                                       | No step contacts the network; `npm ci` is the only network use and is limited to registry install.                                                                                      |

If any step fails on a clean clone, it is a repository bug — report it with the `evaluation` issue template and the `evaluation-output/` contents.
