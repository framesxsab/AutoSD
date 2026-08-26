# Accessibility Handoff — Assistive-Tech Readiness

**Status:** No user validation has happened. All claims below are `SOFTWARE-VALIDATED` (automated tests + Lighthouse) or `USER-VALIDATION-PENDING`. Do not claim screen-reader or keyboard-only success without a participant study.

## What is implemented (software-verified)

| Area                             | Implementation                                                                                                                                                                            | Evidence                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Focus order**                  | `AppRouter` + `Workspace` + `VirtualList` manage roving tabIndex; `onFocus` restores.                                                                                                     | `tests/ui/virtualList.test.ts`, `tests/app/router-lazy.test.ts` |
| **Headings**                     | Each view has `h1`/`h2` with `aria-labelledby`; `ReaderView` paginates with `ariaLabel` containing doc title + page number.                                                               | `src/ui/ReaderView.ts`, `src/workflows/reader.ts`               |
| **Live regions**                 | `LiveSync` status badge `role="status" aria-live="polite"`, `createLiveRegion` in `accessibility/a11y.ts` announces `Corpus updated`; `DemoPanel` live region announces evaluation steps. | `src/app/LiveSync.ts`, `src/accessibility/a11y.ts`              |
| **Status announcements**         | `Evaluation` tasks report via `aria-live` in `DemoPanel`; `DiagnosticsPanel` is `aria-live="polite"`.                                                                                     | `src/ui/DemoPanel.ts`                                           |
| **Keyboard navigation**          | `VirtualList` handles ArrowUp/Down, Home/End, Enter; `SessionBrowser` keyboard-navigable; `AppNav` skip links.                                                                            | `tests/ui/virtualList.test.ts`                                  |
| **Virtualized list semantics**   | `VirtualList` uses `role="grid"` with `aria-rowcount`/`aria-colcount`, windowed rendering preserves semantics.                                                                            | `src/ui/VirtualList.ts`                                         |
| **Reader / citation navigation** | `ReaderView` paginates with `ariaLabel`; `CitationView` lists `citations[]` with `cite` and score.                                                                                        | `src/ui/CitationView.ts`, `src/ui/ReaderView.ts`                |
| **Error recovery**               | `ErrorBoundary` + `LiveSync` `onError` + `DeviceManager` `trySetActive` guard + `VirtualDevice` pre-connect rejection; all announce via `aria-live`.                                      | `src/app/ErrorBoundary.ts`, `src/app/LiveSync.ts`               |

## What is NOT validated (user-pending)

- Keyboard-only task completion (no participant has done `clone→evaluate` keyboard-only).
- Screen-reader task completion (NVDA/JAWS/VoiceOver — no study).
- Low-vision tooling (magnifier, high-contrast, 200% zoom) — automated Lighthouse checks pass, but no human has verified.
- Browser accessibility features (e.g., forced-colors) — not tested.

## How an accessibility contributor can validate without fabricating

1. **Keyboard-only:** unplug mouse, `npm run dev`, `Tab` through `clone→install→verify→demo→evaluate→inspect→report` — record where focus is lost, file a `a11y` issue with steps.
2. **Screen reader:** start NVDA/VoiceOver, repeat the path, record announcements vs expected `aria-live` text — file `a11y` issue with transcript.
3. **Low-vision:** enable magnifier/high-contrast, check `dist-app` contrast and target sizes (WCAG 2.2 AA thresholds in `src/accessibility/a11y.ts`).
4. Never claim `USER-VALIDATED` — file as `MANUAL` with `validationLevel: SOFTWARE-SCAFFOLDED` and notes; maintainers will triage to `USER-VALIDATED` only after a real participant methodology is documented.

## Handoff checklist for the next contributor

- [ ] `npm run verify:release` still enforces `accessibility ≥95` via Lighthouse.
- [ ] `npm run evaluate` `T05-READER` and `T08-TACTILE` still pass — they exercise the same ARIA paths.
- [ ] No doc outside `CAPABILITY_MATRIX.md` claims user validation — grep `USER-VALIDATED` shows only matrix and this file's pending disclaimer.
