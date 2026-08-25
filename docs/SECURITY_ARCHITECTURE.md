# AutoSD Security Architecture (v0.9)

Companion to [`SECURITY.md`](../SECURITY.md) (policy + audit summary). This
document describes the trust model, the per-area audit, and the controls that
keep AutoSD safe as a **static, backend-free SPA**.

---

## 1. System overview

AutoSD is a plugin-first research workspace: a Vite-built static bundle
(`dist-app/`) that runs entirely in the browser. Optional Node-side features
(corpus watching, disk persistence, HID, local transformers) degrade to no-ops
in the browser via build-time aliases (`src/utils/empty.ts`) and guarded
dynamic imports.

```
┌────────────────────────── Browser origin ──────────────────────────┐
│  Static bundle (index.html + JS/CSS assets)                        │
│  ├── UI layer        ReaderView / Workspace / SessionBrowser       │
│  ├── App layer       bootstrap / router / config / logger / health │
│  ├── Workflows       research / reader / tactile / marketplace     │
│  ├── Retrieval       pipeline / snapshot / bm25 / providers        │
│  └── Plugins         statically registered Plugin objects          │
└───────────────┬────────────────────────────────────────────────────┘
                │ optional outbound HTTPS
                ▼
   api.openai.com (only if a user explicitly supplies a client-side key)
```

**There is no backend, no database, and no server-side session state.**
Everything shipped in the bundle is public by definition.

## 2. Assets and trust boundaries

| Asset | Sensitivity | Boundary crossed |
| ----- | ----------- | ---------------- |
| OpenAI API key | Secret | Process env → provider instance only. Never bundled, never logged |
| Corpus files (`corpus/docs/*`) | **Untrusted input** | Filesystem / user drop → DOM, index, persistence |
| Document/chunk ids (derived from filenames) | Untrusted | → DOM text, CSS selectors, JSON on disk |
| Session history (`corpus/sessions.json`, `index.json`) | Semi-trusted | Disk → in-memory objects → DOM |
| localStorage (`autosd:onboardingComplete`) | Non-sensitive | Browser → app (boolean flag only) |
| Plugin code | Trusted-as-bundle | Ships inside the JS bundle; page-privileged |

Primary attackers considered:

1. **Malicious corpus author** — plants a file whose content/filename carries
   HTML/JS payloads; goal is stored XSS in the reader UI.
2. **Malicious session data** — hand-edits `sessions.json`/`index.json` on
   disk; goals: XSS via rendered sessions, logic corruption.
3. **Curious local user** — inspects the bundle for secrets.
4. **Network observer** — sees only static asset fetches unless the user
   opted into a client-side OpenAI key (then: TLS-protected API calls).

## 3. Per-area audit

### 3.1 API keys

- `OPENAI_API_KEY` is read **only** from the process environment
  (`OpenAIEmbeddingProvider` default parameter, guarded `globalThis.process`).
  In browser builds `process` does not exist → key is `""` → provider reports
  unconfigured → bootstrap falls back to Mock. The key therefore cannot enter
  the client bundle through this path.
- `import.meta.env` is consumed exclusively by `src/app/config.ts`, which
  reads only non-secret `VITE_` variables. No secret is ever prefixed
  `VITE_`; `.env.example` documents the rule and `.dockerignore` excludes
  `.env*` from image builds.
- `diagnostics.ts` reports OpenAI configuration as a **boolean** only.

### 3.2 localStorage

Single consumer: `OnboardingStore` (`autosd:onboardingComplete`).

- Payload: `{ version: 1, complete: boolean }` — no secrets, no PII, no content.
- Reads are schema-checked with fallback to defaults; writes/removals are
  try/catch-guarded (private mode, quota). Corrupt payloads can never inject
  anything — they are parsed by `JSON.parse` (no reviver) and field-checked.

### 3.3 JSON parsing

- Shared helper `safeJsonParse()` (`src/utils/sanitize.ts`): never throws,
  never uses revivers, optional structural guard.
- `persistence.loadManifest()` validates `version: string` + `documents`
  presence before accepting; `loadJson()` returns null on any failure.
- `ResearchWorkflow.loadFromDisk()` filters restored sessions to those with
  string `id`, present `query` and `results`, caps at `MAX_SESSIONS`.
- Restored values are treated as untrusted downstream: they reach the DOM
  only through text-rendering paths (§3.4).

### 3.4 Rendered content (XSS)

Rule: **untrusted strings must never be handed to an HTML parser.**

- `Workspace.ts` chunk list and inspector were rewritten from `innerHTML`
  interpolation to DOM construction (`createElement` + `textContent` +
  `append`). This was the one High-severity finding of the v0.8 audit.
- `CitationView.renderCitation()` escapes every interpolation (ids included)
  with shared `escapeHtml()`. `createCitationList()` sets all dynamic values
  via `textContent`/`setAttribute` (attribute-safe by specification).
- All remaining `innerHTML = ""` occurrences are pure container clears.
- CSS selector injection closed: ids passed to `querySelector` go through
  `escapeSelector()` (CSS.escape with quote/backslash fallback).
- CSP deployed at the nginx layer (`script-src 'self'`) provides defense in
  depth against any future markup regression.

### 3.5 Filenames

- `CorpusWatcher` derives document ids from `readdir` entries. POSIX/Windows
  `readdir` entries cannot contain path separators → no path traversal;
  `join(dir, entry)` stays inside the watched directory. Dotfiles are skipped
  by default; extensions are allow-listed (`.md`, `.txt`, `.json`).
- Because filenames become ids, every render path treats ids as untrusted
  (see §3.4). Ids also flow into `index.json`/`sessions.json`; restore paths
  re-validate shape (§3.3).

### 3.6 Plugin manifests

- There are **no manifest files, no remote plugin fetches, no runtime code
  loading**. A plugin is an object implementing the constrained `Plugin`
  interface (`id`, `version`, `activate(ctx)`), registered statically through
  `PluginRegistry.register()`.
- The exposed `PluginContext.api` surface is exactly two functions:
  `registerWorkflow` / `unregisterWorkflow`. Plugins run with ordinary page
  privileges — they are part of the bundle and reviewed like bundle code.
- Policy: adding remote plugin loading would require signed manifests, a
  dedicated review, and CSP changes; it is out of scope for v0.9.

### 3.7 Dynamic imports

All dynamic `import()` sites are static-literal and non-user-controlled:

| Site | Purpose | Browser behavior |
| ---- | ------- | ---------------- |
| `node:fs`, `node:fs/promises`, `node:path` | watcher/persistence (Node only) | Aliased to empty stub module |
| `node-hid` | HID devices | `.catch(() => null)` → feature off |
| `@xenova/transformers` | Local embeddings | `.catch(() => null)` → feature off |

No `eval`, no `new Function`, no `setTimeout(string)` anywhere in `src/`.

### 3.8 OpenAI configuration

- Endpoint/model are configurable via non-secret `VITE_OPENAI_BASE_URL` /
  `VITE_OPENAI_MODEL`; `config.ts` strips userinfo from URLs and falls back
  to the official endpoint on malformed input.
- Error hygiene: failed responses contribute only the HTTP status plus a
  truncated (300-char), key-redacted body fragment to exception messages.
- Availability contract: missing key ⇒ Mock provider ⇒ full offline function.

## 4. Controls summary

| Control | Implementation |
| ------- | -------------- |
| Env validation | `src/app/config.ts` — frozen, never throws, name-only warnings |
| Log redaction | `src/app/logger.ts` — `sk-…`, Bearer, `key=`/`token=` patterns + registered literals; length caps; stacks debug-only |
| Error containment | `src/app/ErrorBoundary.ts` — window handlers, `role="alert"` fallback, retry, sanitized output |
| Output encoding | DOM APIs everywhere; `escapeHtml`/`escapeSelector` where strings are unavoidable |
| Safe parsing | `safeJsonParse` + structural guards |
| Readiness | `src/app/health.ts` + static `/healthz.json` probe (nginx) |
| Transport/host hardening | `docker/nginx.conf` — CSP, nosniff, DENY framing, referrer policy, immutable asset cache, dotfile deny, non-root user |
| Build hygiene | `.dockerignore` blocks `.env*`, corpus, coverage; sourcemaps disabled in production builds |

## 5. Residual risks & accepted limitations

1. **Client-side user-supplied OpenAI keys** would be visible to anyone with
   devtools on that machine — inherent to backend-free apps; documented, not
   mitigable without a proxy backend (explicitly out of scope).
2. **Plugins are fully page-privileged.** Acceptable because plugins ship in
   the reviewed bundle; treat malicious-plugin risk as supply-chain risk.
3. **CSP allows inline styles** (`style-src 'unsafe-inline'`) due to the
   styled `index.html` shell; scripts remain `'self'`-only.
4. **Corpus integrity** is hash-based change detection, not authentication:
   anyone who can write to `corpus/` controls its content. Deployment docs
   should keep corpus directories owner-writable only.

## 6. Verification checklist for releases

- [ ] `npm run verify` green (typecheck, lint, format, tests, build).
- [ ] Grep sweeps clean: no new `innerHTML` with interpolation, no `eval`,
      no `VITE_`-prefixed secrets, no user-controlled `import()`.
- [ ] `dist-app/` contains no `.env`, no source maps, no corpus data.
- [ ] Docker image: `docker history` shows no env-file layers; `/healthz`
      returns 200; security headers present (`curl -I`).
