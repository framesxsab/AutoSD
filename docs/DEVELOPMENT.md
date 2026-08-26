# Development Guide

Day-to-day workflow for AutoSD contributors. For contribution rules (branches, commits, PRs) see the root `CONTRIBUTING.md`. For a clean-clone sanity check see `BOOTSTRAP.md`.

## Prerequisites

| Tool    | Version | Why                                               |
| ------- | ------- | ------------------------------------------------- |
| Node.js | >=20    | enforced by `scripts/bootstrap.mjs` and `engines` |
| npm     | >=10    | ships with Node 20                                |
| Git     | any     | clone and branch                                  |

No native build tools. No hardware. Tests and builds run fully on `MockDevice` / `VirtualDevice` / `MockEmbeddingProvider`.

## Setup

One command from a clean clone:

```bash
npm run bootstrap
```

Equivalent manual steps:

```bash
npm install
npm run typecheck   # tsc --noEmit, strict
npm run lint        # eslint 9 flat config
npm run format      # prettier --check
npm test            # vitest run
npm run build       # tsc emit + vite build
```

## Repo layout

```
autosd/
├── src/
│   ├── core/            # Device, Registry, DIContainer, DeviceManager
│   ├── devices/         # MockDevice, VirtualDevice, HIDDevice (optional)
│   ├── plugins/         # Plugin contract, PluginRegistry, PluginHost
│   ├── workflows/       # research, marketplace, reader, tactile
│   ├── retrieval/       # chunker, bm25, embedder, pipeline, snapshot,
│   │   │                # CorpusWatcher, persistence
│   │   └── providers/   # Mock / Local / OpenAI embedding providers
│   ├── accessibility/   # WCAG 2.2 AA helpers (single gate)
│   ├── ui/              # CitationView, SessionBrowser, ReaderView, VirtualList
│   ├── app/             # bootstrapApp, LiveSync, Workspace
│   ├── utils/           # EventBus
│   ├── index.ts         # public barrel export
│   └── main.ts          # browser entrypoint mounted into #app
├── tests/               # mirrors src/: core, devices, plugins, workflows,
│                        # retrieval, ui, app, a11y, e2e
├── scripts/bootstrap.mjs
├── docs/
├── corpus/              # created at runtime: docs/, index.json, sessions.json
└── dist-app/            # vite build output (static site)
```

## Scripts

| Script           | What it does                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `bootstrap`      | Node version check + install if needed + full verify gate                                            |
| `dev`            | Vite dev server on port 5173 (strict port)                                                           |
| `build`          | `tsc -p tsconfig.json && vite build`; emits `dist/` and static `dist-app/`                           |
| `preview`        | Serve the built app on port 4173 (strict port)                                                       |
| `typecheck`      | `tsc --noEmit`, strict, noEmitOnError                                                                |
| `lint`           | eslint over `.ts`, `.tsx`, `.js`                                                                     |
| `lint:fix`       | eslint autofix                                                                                       |
| `format`         | prettier check over `src/`, `tests/`, root `*.md`                                                    |
| `format:fix`     | prettier autofix                                                                                     |
| `test`           | vitest run without coverage                                                                          |
| `test:watch`     | vitest in watch mode                                                                                 |
| `verify`         | typecheck + lint + format + test + build. The fast merge gate.                                       |
| `verify:release` | build + preview server + Lighthouse audit + threshold gate. The release-quality gate (needs Chrome). |

Both dev (5173) and preview (4173) use strict ports. If something already listens there, stop it; Vite will not pick another port.

## Fast vs release verification

Two gates, deliberately kept apart so local development stays quick:

|                   | `npm run verify`                        | `npm run verify:release`                                                                                    |
| ----------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Purpose           | everyday merge gate                     | audit the real built app over HTTP                                                                          |
| Steps             | typecheck, lint, format, tests, build   | production build, `vite preview` on `127.0.0.1:4173`, HTTP readiness wait, headless-Chrome Lighthouse, gate |
| Starts a server?  | never — unit tests do not depend on one | yes, briefly; the script stops it when done                                                                 |
| Needs Chrome?     | no                                      | yes (Lighthouse drives headless Chrome)                                                                     |
| Enforced minimums | all checks green                        | accessibility ≥ 95, performance ≥ 90                                                                        |

Rules of thumb:

- Run `npm run verify` before every commit/PR. It stays fast because nothing boots a browser or a long-lived server.
- Run `npm run verify:release` when your change touches UI, routing, styling, or anything else Lighthouse can see. Pass `--skip-build` (`npm run verify:release -- --skip-build`) to reuse an existing `dist-app/` while iterating.
- CI mirrors the split: `.github/workflows/ci.yml` runs the fast gate on every push/PR; `.github/workflows/lighthouse.yml` is the release-quality job (install → build → preview → wait-on → Lighthouse → threshold gate → report artifact). Both must pass before merge; neither replaces the other.
- The thresholds live in one place, `scripts/lighthouse-gate.mjs`, used by both the workflow and the local script. Do not lower them to make a run pass.

## Testing

Tests live in `tests/` and mirror `src/`. Vitest runs with `globals: true` in the `node` environment by default.

```bash
npm test                    # all tests once
npm run test:watch          # watch mode
npx vitest run tests/retrieval   # one directory
npx vitest run --coverage   # v8 coverage report in coverage/
```

DOM components (`src/ui/*`, `src/app/Workspace.ts`) are tested with jsdom through a per-file pragma:

```ts
/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
```

Guidelines:

- Retrieval tests must be deterministic. Use `MockEmbeddingProvider`; never hit the network.
- Device tests parameterize over Mock and Virtual. HID tests must pass with no hardware attached.
- UI tests assert roles, ARIA attributes, and keyboard behavior, not pixel layout.
- A bug fix lands together with a regression test.

## Environment variables

There is exactly one optional variable:

| Variable         | Used by                   | Default when absent                                        |
| ---------------- | ------------------------- | ---------------------------------------------------------- |
| `OPENAI_API_KEY` | `OpenAIEmbeddingProvider` | provider throws on embed; DI-swap to Mock or Local instead |

Nothing else is required. The default wiring in `bootstrapApp()` registers `MockEmbeddingProvider` under the `embedding:provider` DI token, so dev, CI, and the built app all work offline.

Never commit keys. Never bake `OPENAI_API_KEY` into a static bundle; the browser build has no safe place for secrets.

## Corpus layout

The research workspace reads and writes under `corpus/` by default:

```
corpus/
├── docs/           # watched source files (.md, .txt, .json)
├── index.json      # SnapshotIndex state (chunks, hashes, manifests)
└── sessions.json   # persisted retrieval sessions
```

Drop files into `corpus/docs/` while the app runs and `LiveSync` picks them up: the `CorpusWatcher` debounces changes (150 ms), `ResearchWorkflow.ingest()` re-indexes only changed documents, and the result is saved back to `corpus/index.json`. Missing directories are handled gracefully; nothing crashes if `corpus/` does not exist yet.

## Dependency injection quick reference

```ts
import { DIContainer } from "./src/core/DIContainer.js";
import { EMBEDDING_TOKEN } from "./src/workflows/research.js";
import { MockEmbeddingProvider } from "./src/retrieval/providers/MockEmbeddingProvider.js";

const di = new DIContainer();
di.register(EMBEDDING_TOKEN, () => new MockEmbeddingProvider()); // singleton by default

// Later, swap implementation without restart:
di.hotSwap(EMBEDDING_TOKEN, () => myCustomProvider);
```

`ResearchWorkflow` resolves `EMBEDDING_TOKEN` from the container when constructed. `bootstrapApp({ di })` accepts your own container; otherwise it uses the exported global `container`.

## Troubleshooting

| Symptom                                              | Fix                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `prettier --check` fails                             | `npm run format:fix`, then re-stage                                                               |
| `eslint` fails                                       | `npm run lint:fix`; if it is a rule dispute, discuss in the PR before editing config              |
| `tsc --noEmit` errors mentioning `node-hid`          | You imported HID statically. Keep the dynamic import inside `HIDDevice.ts`                        |
| Port 5173 or 4173 already in use                     | Free the port. Both Vite servers use strict ports and will not fail over                          |
| OpenAI provider throws "OPENAI_API_KEY not set"      | Expected without a key. Register Mock or Local provider under `embedding:provider`                |
| Search returns the stub answer ("no indexed corpus") | The corpus is empty. Add files to `corpus/docs/` or call `workflow.ingest([...])` first           |
| Watcher does not notice file changes                 | Only `.md`, `.txt`, `.json` at the top level of `corpus/docs/` are watched; dotfiles are skipped  |
| `npm audit` reports vulnerabilities                  | They are dev-only (tooling transitive deps). There are no runtime dependencies                    |
| `verify:release` fails: preview exited early         | Port 4173 is taken (strict port). Free it and rerun                                               |
| `verify:release` cannot find lighthouse/npx          | Install once with `npm install --no-save lighthouse@12`, or check that Chrome/Chromium is on PATH |
| Windows path issues                                  | All scripts are cross-platform PowerShell/bash safe. Report any bash-only assumption as a bug     |

## Where to look next

- `docs/ARCHITECTURE.md`: how the seams fit together
- `docs/PLUGIN_GUIDE.md`: write a plugin
- `docs/RESEARCH_GUIDE.md`: tune retrieval, add providers, work with citations
- `docs/DEPLOYMENT.md`: build output and hosting
