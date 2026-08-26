# Getting Started with AutoSD

New to AutoSD? This page takes you from a clean clone to a running, verified, demonstrably working system in about five minutes. No hardware, no API keys, no accounts, no network access required at any point.

## What AutoSD does

AutoSD turns a local folder of documents into grounded, citation-backed answers, and can render those answers onto tactile display devices. One `Device` contract covers all targets: an in-memory test fixture (`MockDevice`), a framebuffer simulator (`VirtualDevice`), and a physical-hardware adapter (`HIDDevice`). Write against the contract once; run anywhere.

What works today (software-validated): document ingestion, incremental indexing, hybrid BM25 + vector retrieval with citations, session persistence and export, a nine-route browser app, deterministic offline demo, plugin hot-swap infrastructure, WCAG 2.2 AA helpers with a CI Lighthouse gate.

What does **not** work yet: real tactile hardware has never been exercised end-to-end (the HID adapter ships untested against physical devices), the built-in text-to-dots mapping is **not standard braille** and has never been read by a human, no retrieval quality benchmarks exist, and no screen-reader user testing has happened. Details: [EVALUATION.md](EVALUATION.md).

## Requirements

| Tool    | Version | Check               |
| ------- | ------- | ------------------- |
| Node.js | >= 20   | `node -v`           |
| npm     | >= 10   | `npm -v`            |
| Git     | any     | clone + branch only |

No native toolchain. No Docker needed for development.

## Install

```bash
git clone <repo-url> autosd
cd autosd
npm install
```

Dependencies are dev-only tooling (TypeScript, Vite, Vitest, ESLint, Prettier). The runtime itself has zero dependencies — Node built-ins only, aliased out for the browser build.

## Verify your clone

```bash
npm run bootstrap
```

One command: checks your Node version, installs if needed, then runs typecheck → lint → format check → tests → build. If it prints `✓ Bootstrap complete`, your clone is fully verified. CI runs the identical gate on every push and PR.

Already installed and just want the gate?

```bash
npm run verify
```

## Run it

```bash
npm run dev
```

Open `http://localhost:5173`. First visit walks you through onboarding. The app starts with the deterministic mock embedding provider, so search works immediately, fully offline.

Things to try in the browser:

- Drop `.md`, `.txt`, or `.json` files into `corpus/docs/` while the app runs — live sync indexes them within ~150 ms.
- `#/workspace`: corpus manager, search panel, virtualized results, citation inspector.
- `#/research`: query console with answer, citations, and confidence.
- `#/devices`: registered devices and active-device selection.
- `#/demo`: guided seven-step demo with progress and JSON export.

## Run the software-only demo (one command)

```bash
npm run demo
```

Progress prints to stderr; the canonical session JSON prints to stdout (pipe it: `npm run demo > demo.json`, or use `--out file.json`). The demo runs the complete pipeline over a fixed four-document corpus:

**ingest → reader pagination → search → citations → tactile render on VirtualDevice → diagnostics → export**

Guarantees, enforced by tests: no timestamps or random ids in the export, no network calls, no API key, no hardware. Two runs produce byte-identical output, so the export doubles as a regression fixture.

## Production build

```bash
npm run build     # dist/ (library) + dist-app/ (static site)
npm run preview   # serve dist-app/ on http://localhost:4173
```

`dist-app/` deploys to any static host. See [DEPLOYMENT.md](DEPLOYMENT.md) and the repo-root `Dockerfile`.

## Architecture in one screen

```
src/
├── core/          Device contract · Registry · DIContainer · DeviceManager
├── devices/       MockDevice · VirtualDevice · HIDDevice (optional)
├── plugins/       Plugin contract · PluginRegistry · PluginHost
├── workflows/     research · reader · marketplace · tactile
├── retrieval/     chunker · BM25 · embedder · pipeline (RRF fusion) ·
│                  snapshot index · CorpusWatcher · persistence
│   └── providers/ MockEmbeddingProvider (default) · Local · OpenAI
├── accessibility/ WCAG 2.2 AA thresholds — the single source
├── ui/            VirtualList · CitationView · SessionBrowser · ReaderView …
└── app/           bootstrapApp · router · LiveSync · Workspace · demo
```

Data flow of one query: documents are chunked and indexed incrementally (unchanged docs are never re-embedded); a question runs through BM25 lexical search plus vector cosine search fused by reciprocal rank fusion (k = 60); top results become citations with scores; the session is persisted (capped at 100) and exportable. Full detail: [ARCHITECTURE.md](ARCHITECTURE.md).

## Next steps

| I want to…                     | Go to                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| Contribute code                | [../CONTRIBUTING.md](../CONTRIBUTING.md), [CONTRIBUTOR_MAP.md](CONTRIBUTOR_MAP.md) |
| Evaluate the project honestly  | [EVALUATION.md](EVALUATION.md)                                                     |
| Connect real tactile hardware  | [HARDWARE_INTEGRATION.md](HARDWARE_INTEGRATION.md)                                 |
| Write a plugin                 | [PLUGIN_GUIDE.md](PLUGIN_GUIDE.md)                                                 |
| Tune retrieval / add providers | [RESEARCH_GUIDE.md](RESEARCH_GUIDE.md)                                             |

## Troubleshooting

**`npm run bootstrap` fails at the Node version check.**
Install Node.js 20 or newer (`node -v` must print `v20.x` or higher). No other toolchain is required.

**Port 5173 (or 4173) already in use.**
Both dev and preview use strict ports on purpose — Vite will not pick another. Stop whatever listens on the port, then retry. Find it: `npx cross-env` isn't needed; on Windows `netstat -ano | findstr :5173`, on macOS/Linux `lsof -i :5173`.

**Prettier or ESLint fails on my change.**
Run `npm run format:fix` and `npm run lint:fix`. The prettier scope includes root `*.md` files — README edits are format-checked too.

**Tests fail after I touched public contracts.**
Contracts (`Device`, `Plugin`, `EmbeddingProvider`, exported types) are additive-only: never remove or rename fields. Breaking changes require an RFC first — see [../CONTRIBUTING.md](../CONTRIBUTING.md).

**Search returns nothing in the browser app.**
The workspace starts empty until you ingest documents. Add files under `corpus/docs/` or paste content via the workspace UI. With the default mock embedding provider, retrieval is functional but not quality-tuned — see the honesty notes in the [README](../README.md).

**The demo prints `Demo failed`.**
Re-run `npm run bootstrap`; a stale or partially-installed `node_modules` is the usual cause. The demo never touches the network or hardware, so failures are almost always local environment issues.

**HID adapter does nothing.**
Expected without hardware. `HIDDevice` falls back gracefully when WebHID/node-hid are absent: `connect()` succeeds, reads return `null`. Driving a physical display is integration work — see [HARDWARE_INTEGRATION.md](HARDWARE_INTEGRATION.md).

**Something else.**
Check [DEVELOPMENT.md](DEVELOPMENT.md) for day-to-day workflow details, then open an issue and include the app's diagnostics report from the `#/devices` → diagnostics panel surface (metadata-only; secrets are redacted by design).
