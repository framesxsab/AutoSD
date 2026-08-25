# Security Policy — AutoSD

Applies to **AutoSD v0.9.0**. The full threat model and per-area audit live in
[`docs/SECURITY_ARCHITECTURE.md`](docs/SECURITY_ARCHITECTURE.md).

## Supported versions

| Version | Supported | Notes                                                          |
| ------- | --------- | -------------------------------------------------------------- |
| 0.9.x   | ✅ Yes    | Current release line (security-hardened)                       |
| < 0.9   | ❌ No     | Contains the XSS sinks fixed in 0.9 (see audit below); upgrade |

## Reporting a vulnerability

- **Preferred:** GitHub — _Security → Report a vulnerability_ (private disclosure).
- **Alternative:** open a minimal issue titled `[security]` **without** exploit
  details, and we will follow up privately.

Please include: affected area (see audit table), reproduction steps or PoC,
and impact assessment. We aim to acknowledge reports within **7 days** and to
publish a fix or mitigation within **30 days** for confirmed issues. Please do
not disclose details publicly until a fix is released.

There is no bug bounty. We credit reporters in release notes unless anonymity
is requested.

## Security audit summary (v0.8 → v0.9)

Audit scope: API keys, localStorage, JSON parsing, rendered content,
filenames, plugin manifests, dynamic imports, OpenAI configuration.
Methodology: source review + targeted grep sweeps (`process.env`,
`import.meta.env`, `localStorage`, `innerHTML`, `eval`, `new Function`,
dynamic `import()`, `API_KEY`/secret patterns). No dynamic analysis; no
benchmarks are claimed from this audit.

### Findings and mitigations

| #    | Severity | Area             | Finding (v0.8)                                                                                                                                          | Mitigation (v0.9)                                                                                                                                                                                               |
| ---- | -------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1  | **High** | Rendered content | `Workspace.ts` injected unsanitized corpus content (`documentId`, chunk id, content) via `innerHTML` — stored XSS if a malicious file enters the corpus | Rewritten with DOM APIs (`textContent`/`append`); no untrusted string ever reaches an HTML parser                                                                                                               |
| F-2  | Medium   | Rendered content | `CitationView.renderCitation()` interpolated ids into HTML attributes without escaping — attribute breakout when a filename contains quotes             | All interpolations escaped via shared `escapeHtml()` (`src/utils/sanitize.ts`)                                                                                                                                  |
| F-3  | Low      | Rendered content | `querySelector("[data-cited=\"${chunkId}\"]")` built CSS selectors from untrusted ids — selector injection / thrown `SyntaxError`                       | Values passed through `escapeSelector()` (CSS.escape with fallback)                                                                                                                                             |
| F-4  | Medium   | Error handling   | Provider errors embedded raw HTTP response bodies into exception messages; bootstrap failure dumped full error objects to console                       | Response bodies truncated and key-shaped strings redacted before inclusion; app-wide logger redacts `sk-…` keys, Bearer tokens, `key=`/`token=` params and registered secrets; stack traces only at debug level |
| F-5  | Info     | API keys         | `OPENAI_API_KEY` read only from process env (never bundled) — correct behavior confirmed                                                                | Preserved and documented; static browser builds have no key and fall back to the Mock provider automatically                                                                                                    |
| F-6  | Info     | VITE_ env leak   | No `import.meta.env` usage existed; nothing to leak                                                                                                     | `src/app/config.ts` validates only non-secret `VITE_` vars; `.env.example` documents that secrets must never use the `VITE_` prefix; `.dockerignore` blocks `.env*` from image builds                           |
| F-7  | Info     | localStorage     | Not used in v0.8                                                                                                                                        | v0.9 adds `OnboardingStore` — single namespaced key, boolean-only payload, schema-checked safe JSON parse, guarded access, no secrets/PII                                                                       |
| F-8  | Info     | JSON parsing     | Disk JSON parsed with bare `JSON.parse` inside try/catch                                                                                                | Centralized `safeJsonParse()` with optional structural guards (`persistence.ts`, sessions loader)                                                                                                               |
| F-9  | Info     | Dynamic imports  | Only Node builtins (aliased to empty stubs in browser builds) and optional deps (`node-hid`, `@xenova/transformers`) behind catch-fallbacks             | Confirmed constrained; documented in threat model. No user-controlled import specifiers anywhere                                                                                                                |
| F-10 | Info     | Plugins          | Plugins are statically registered objects implementing the constrained `Plugin` interface; no eval, no remote loading, no manifest fetches              | Policy codified: plugins ship in the bundle, run with page privileges, and may only call `registerWorkflow`/`unregisterWorkflow`                                                                                |
| F-11 | Info     | Filenames        | Corpus filenames become document/chunk ids rendered into the DOM                                                                                        | Ids now always rendered as text (F-1/F-2); `readdir` entries cannot contain path separators, so no traversal; dotfiles skipped                                                                                  |

### Hardening added in v0.9

- `src/app/config.ts` — validated, frozen config; never throws; warnings carry variable names only.
- `src/app/logger.ts` — leveled logging with secret redaction and length caps.
- `src/app/ErrorBoundary.ts` — global error containment with accessible fallback (`role="alert"`) and retry; sanitized messages only.
- `src/app/health.ts` — secret-free readiness report (`window.__AUTOSD__.health()`).
- `Dockerfile` + `docker/nginx.conf` — multi-stage build, non-root nginx, security headers incl. CSP, immutable asset caching, `/healthz` probe, `.env*` excluded from build context.

## Deployment notes

- The production image serves **static files only** — there is no backend, no database, and no server-side secret storage. Any secret placed in the image would be public by definition; none is.
- CSP allows `connect-src https://api.openai.com` so users who explicitly inject their own client-side key retain functionality; the shipped bundle contains no key material.
- Verify deployments with: `npm run verify` (typecheck, lint, format, tests, build).
