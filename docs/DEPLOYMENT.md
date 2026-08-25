# Deployment Guide

How to build AutoSD, preview it locally, and host it. The supported deployment target today is a **static site**. There is no server component, no database, and no Dockerfile in the repo as of v0.8.x.

## What the build produces

```bash
npm run build
```

This runs `tsc -p tsconfig.json && vite build` and produces two outputs:

| Output      | Contents                                                      | Used for                     |
| ----------- | ------------------------------------------------------------- | ---------------------------- |
| `dist/`     | TypeScript compilation: JS, declarations, source maps         | library consumers, typecheck |
| `dist-app/` | Vite bundle of the browser app (`src/main.ts` + `index.html`) | static hosting               |

Only `dist-app/` is deployable as a website. Node built-ins used by retrieval (`node:fs`, `node:path`, `node:crypto`) are aliased to empty stubs for the browser build (see `vite.config.ts`), so file watching and disk persistence simply no-op in the browser while search over an ingested index still works.

## Preview locally

```bash
npm run build
npm run preview   # serves dist-app/ on http://localhost:4173, strict port
```

For development with hot reload use `npm run dev` instead (port 5173, also strict). Both ports fail fast if occupied; free them rather than expecting a fallback.

## Environment

Build-time requirements:

| Tool    | Version |
| ------- | ------- |
| Node.js | >=20    |
| npm     | >=10    |

Runtime environment variables for the static app: **none required**. The default embedding provider is `MockEmbeddingProvider`, which needs no configuration.

About `OPENAI_API_KEY`: only relevant if you explicitly wire `OpenAIEmbeddingProvider`. Do not embed API keys in a static bundle. A browser build cannot keep secrets, so treat any key you ship as public. If you need OpenAI embeddings, proxy the calls from your own server or run AutoSD's workflow layer under Node where the key stays private.

## Static hosting

`dist-app/` is plain static files. Any static host works:

- **GitHub Pages**: publish the contents of `dist-app/` to the `gh-pages` branch or a Pages artifact workflow.
- **Netlify / Vercel / Cloudflare Pages**: set the build command to `npm run build` and the publish directory to `dist-app`.
- **nginx / Apache / any web server**: copy `dist-app/*` into the document root.

Notes:

- The app is a single-page bundle with no router, so no rewrite rules are needed.
- Deploying under a subdirectory works without extra config because asset paths are relative to `index.html`. Verify after your first deploy.
- User corpus state lives in `corpus/` on the machine running the workflow layer. A pure static deploy has no shared corpus; each user brings their own documents through the UI.

### Docker

No Dockerfile ships with the repo. Since the output is static, containerizing it means serving `dist-app/` with any web server image. That is a decision for your infrastructure, not something AutoSD prescribes. If you add one to your fork, keep it minimal: build stage running `npm ci && npm run build`, runtime stage copying only `dist-app/`.

## CI gates that guard deploys

Two workflows run on pushes to `main` and PRs (see `.github/workflows/`):

| Workflow         | Steps                                                               | Fails when                             |
| ---------------- | ------------------------------------------------------------------- | -------------------------------------- |
| `ci.yml`         | install, typecheck, lint, format check, tests, build                | any gate fails                         |
| `lighthouse.yml` | build, serve `dist-app/` on 127.0.0.1:4173, run Lighthouse headless | accessibility < 95 or performance < 90 |

Treat both as deploy blockers. A red `main` means do not cut a release.

## Release checklist

1. `main` is green on both workflows.
2. Bump `version` in `package.json` following semver. Remember the additive-only contract rule: no removals in minor versions.
3. Update docs if behavior changed (`CONTRIBUTING.md`, `docs/*.md`, `BOOTSTRAP.md`, `PRD.md` status lines).
4. Run `npm run verify` one final time from a clean clone.
5. Tag the release (`git tag vX.Y.Z`) and attach the built `dist-app/` artifact if your distribution flow uses tags.

## Known limits, stated plainly

- No server-side rendering. The app mounts client-side into `#app`.
- No CDN-side corpus sharing. Persistence is local files under Node, absent in the browser.
- Lighthouse thresholds (a11y 95+, performance 90+) are enforced in CI; regressions will block merges, so budget for them when touching UI.
