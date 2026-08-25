# AutoSD Performance & Accessibility Report (v0.9)

Scope: bundle audit, route-level code splitting, startup path, keyboard/screen-reader
flows, reduced motion, responsive layout, and Lighthouse verification against the
real served build (`vite preview`).

## Lighthouse results

Baseline (v0.8, `vite preview` :4175): Performance 100 · Accessibility 98 ·
Best Practices 96 · SEO 91.

Current (v0.9, same setup, Chrome headless, Lighthouse 12.8.2, mobile preset,
two consecutive runs — identical):

| Category       | v0.8 baseline | v0.9 current |
| -------------- | ------------- | ------------ |
| Performance    | 100           | **100**      |
| Accessibility  | 98            | **100**      |
| Best Practices | 96            | **100**      |
| SEO            | 91            | **100**      |

Metrics (run 3): FCP 1.2 s · LCP 1.5 s · TBT 10 ms · CLS 0 · Speed Index 1.2 s.

Raw evidence: `lighthouse-v09.json` (repo root) and
`docs/lighthouse-v09-summary.json`. The two fixes that lifted Best Practices and
SEO were additive static assets/config only:

- `favicon.ico` 404 removed via inline SVG data-URI icon in `index.html`
  (this was also the single console error).
- `public/robots.txt` added (`Allow: /`), copied verbatim into `dist-app/`.

## Bundle audit

Production build (`npm run build`, vite 8, no runtime dependencies):

| Artifact                          | Size     | gzip    | Loaded          |
| --------------------------------- | -------- | ------- | --------------- |
| `index-*.js` (initial chunk)      | 75.71 kB | 22.96 kB| on startup      |
| `workspaceView-*.js`              | 19.01 kB | 5.80 kB | on first visit  |
| `readerView-*.js`                 | 3.92 kB  | 1.54 kB | on first visit  |
| `devicesView-*.js`                | 2.47 kB  | 0.91 kB | on first visit  |
| `researchView-*.js`               | 1.55 kB  | 0.69 kB | on first visit  |
| `demoView-*.js`                   | 0.29 kB  | 0.22 kB | on first visit  |
| `dist-app` total (incl. html)     | ~105 kB  | —       | —               |

- No new runtime dependencies were added (package.json has none; all tooling is
  devDependencies).
- Route splitting keeps ~27 kB minified (~9 kB gzip) of view code out of the
  critical path; chunks are fetched lazily per route.
- After first paint the router prefetches all lazy chunks from a
  `requestIdleCallback` (1.5 s `setTimeout` fallback), so subsequent navigation
  is instant without competing with startup.

## Lazy routes

`src/app/router.ts` resolves `reader`, `workspace`, `devices`, and `research`
through dynamic `import()` (`LAZY_VIEW_LOADERS`). While a chunk loads, an
accessible shell mounts:

- `role="status"` paragraph announces "Loading \<Route\>…" politely.
- On success the real view swaps in, focus moves to the view heading, and the
  live region announces "\<Route\> ready".
- On failure the shell renders `role="alert"` with a native Retry button
  (Enter/Space work); focus is never trapped.
- Navigating away mid-load never force-swaps a stale view; the resolved view is
  cached and served synchronously on revisit.

Tests: `tests/app/router-lazy.test.ts` covers shell → real swap, cached revisit,
stale-navigation guard, retry-after-failure, devices-without-manager, and the
route live region.

## Startup path

`bootstrapApp({ background: true })` (new, opt-in — default remains the fully
awaited v0.8 semantics used by tests) resolves immediately and runs corpus
`loadFromDisk` + `LiveSync.start()` detached; their outcome settles into
`ready` (never rejects). `src/main.ts` uses background mode so ingest never
blocks first paint, records `performance.mark`/`measure`
(`autosd:startup`) and logs the duration. In browser builds the node:fs layer
is stubbed, so these calls settle near-instantly; the flag guarantees the
non-blocking shape as corpus features grow.

Tests: `tests/app/bootstrap.background.test.ts`.

## Keyboard & screen reader flows (verified)

- Skip link (`Skip to content`) targets `#main-content`; visible on focus.
- Primary nav keeps DOM order == tab order, arrow/Home/End roving focus,
  `aria-current="page"` on the active link.
- Route changes move focus to the view heading (`tabindex="-1"`) and announce
  through a persistent polite live region ("X view loaded", "X ready").
- All async state changes (research results, device ops, corpus sync, exports,
  lazy-load progress/failure) surface via `role="status"` / `role="alert"`.
- No focus traps outside explicitly modal surfaces (onboarding/error views trap
  intentionally and restore focus on close).

## Reduced motion

- `prefersReducedMotion()` (JS) gates nav transitions, onboarding focus
  behavior, and now Reader citation scrolling
  (`scrollIntoView behavior: "auto"` under reduced motion).
- CSS `@media (prefers-reduced-motion: reduce)` disables transitions/animations
  for nav and onboarding.

## Responsive layout

- No fixed-width containers: `#app` is `max-width: 1100px` with fluid padding;
  nav wraps; onboarding panel is viewport-clamped (`max-height`, scrollable).
- Added small-screen rules in `index.html`: reduced body padding ≤480px and
  `overflow-wrap: anywhere` for `dd/pre/code` so long snapshot hashes and chunk
  ids cannot overflow 320–480 px viewports.

## Reproducing the Lighthouse run

```powershell
npm run build
npx vite preview --port 4175 --strictPort   # serves dist-app/
npx lighthouse http://localhost:4175 `
  --output=json --output-path=lighthouse-v09.json `
  --chrome-flags="--headless=new" --quiet
```

Scores above were produced with Lighthouse 12.8.2 / Chrome headless on the
served production build (not the dev server).
