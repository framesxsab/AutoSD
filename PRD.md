# PRD — AutoSD v0.3.0 (reflects existing implementation)

> Status: `Accepted` — describes the system **as built** at v0.3.0 (stable baseline). No speculative features. Every requirement maps to shipped code or explicit gap.

---

## 1. Vision

AutoSD is a **plugin-first, device-agnostic platform** that makes tactile, readable, and research-driven content equally available through any haptic/display device — whether that device is real hardware (HID), a simulator (VirtualDevice), or a deterministic fixture (MockDevice).

The vision is **one API, every device**: authors write workflows once; operators swap devices without rewriting features; users get WCAG 2.2 AA guarantees by default.

Non-goals: AutoSD is not a hardware driver suite, not a code generator, and not a hosted SaaS — it is the orchestration layer (DeviceManager + Registry + DI + PluginHost) that makes those pieces composable.

## 2. Problem Statement

- **Device fragmentation:** Tactile/haptic hardware is heterogeneous. Teams reimplement the same reader/marketplace/research logic per device.
- **Testability gap:** Hardware-dependent code cannot be CI-tested deterministically.
- **Plugin sprawl:** Without a stable Device contract and hot-swap, plugins fork per device and break on upgrades.
- **Accessibility debt:** WCAG claims are often bolted on; AutoSD guarantees AA structurally via a single `a11y` gate.
- **Onboarding cost:** New contributors face unclear setup, ad-hoc scripts, and no verified bootstrap.

AutoSD solves these by fixing the **Device seam** (`src/core/Device.ts`) and the **plugin seam** (`src/plugins/types.ts`) as additive-only contracts, with `Registry`, `DIContainer`, `DeviceManager`, and `PluginHost` handling hot-swap without restart.

## 3. Target Users

| Segment                            | Needs                                               | How AutoSD serves                                                                                             |
| ---------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Tactile reader** (primary)       | Read long documents on haptic hardware or simulator | `ReaderWorkflow` paginates with `ariaLabel`; `TactileWorkflow` maps pages to dot patterns; any Device renders |
| **Researcher**                     | Ask questions over corpora, cite sources            | `ResearchWorkflow` returns answer + citations + confidence                                                    |
| **Curator / marketplace explorer** | Discover and install plugins                        | `MarketplaceWorkflow` catalog, search, install                                                                |
| **Plugin author**                  | Ship a workflow once, run everywhere                | `Plugin` contract (`activate`/`deactivate`), `ctx.api.registerWorkflow`                                       |
| **Operator / CI**                  | Deterministic, headless runs                        | `MockDevice`/`VirtualDevice`, `npm run verify` green without hardware                                         |

All users benefit from the WCAG 2.2 AA guarantees and the `npm run bootstrap` one-command setup.

## 4. User Personas

### A — Maya, 23 — Tactile Reader (primary)

Uses a 40-cell display. Wants to open a 5,000-word report, read page by page, and have page transitions rendered haptically. Needs focus order that matches reading order and large-target controls. Uses `VirtualDevice` at home, real hardware at lab — same workflow.

### B — Dr. Chen, 41 — Researcher

Collects citations for a literature review. Runs queries over a corpus snapshot; needs `confidence` and `citations[]` to judge trust. Works offline with `MockDevice`; never touches HID.

### C — Jamal, 29 — Marketplace Curator

Browses plugins (`reader`, `braille`, `tts`). Searches catalog, previews description/downloads, installs one. Expects search to be fast and install to be reversible.

### D — Priya, 34 — Plugin Developer

Authors `autosd-my-capsule`. Implements `Plugin.activate(ctx)` and registers a workflow. Tests locally against `MockDevice`, publishes without worrying about HID quirks.

### E — Alex, 27 — Operator / DevOps

Maintains CI. Requires `npm ci && npm run verify` to be green on a fresh clone with no hardware attached. Relies on `MockDevice`/`VirtualDevice` for deterministic tests.

## 5. Core Workflows (as implemented)

### 5.1 Device lifecycle (all devices)

```
connect() → write()/render() ↔ read() → disconnect()
      ↕ on("connected" | "disconnected" | "error" | "input" | "display")
```

`DeviceManager.register()` makes a device discoverable; `setActive(id)` chooses the render target; `broadcast(pattern)` fans out to every registered device with per-device error isolation; `hotSwap(id, next)` replaces impl atomically.

### 5.2 Research workflow

`ResearchWorkflow.run({ id, question, corpusIds }) → { queryId, answer, citations[], confidence }`

Deterministic stub in v0.3.0 (retrieval + LLM fan-out is deferred behind the `Registry`/`DI` seams). Produces traceable citations that downstream renderers and the traceability matrix can consume when retrieval ships.

### 5.3 Marketplace workflow

`MarketplaceWorkflow.search(query) → Plugin[]`; `install(id) → Plugin`; `catalog() → Plugin[]`

Catalog is an in-repo fixture (reader/tts/braille). Search is substring over `name`/`id`/`description`. Install is reversible (no side effects in v0.3.0; plugin injection stays via `PluginRegistry`).

### 5.4 Reader + tactile workflow

`ReaderWorkflow.paginate(doc, charsPerPage=1000) → ReaderPage[]` (`ariaLabel: "Title — page N"`; `toLiveRegion(page)` for polite announcements) → `TactileWorkflow.renderText(device, text)` (`textToDots` 6-dot mapping, `device.render(pattern)`) or `renderPages(device, pages)`.

Pagination + aria is unit-tested; tactile mapping is byte-stable and any `Device` can render it.

## 6. Functional Requirements

| ID   | Requirement                                                                                                     | Shipped | Notes                                            |
| ---- | --------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------ |
| F-01 | `Device` interface with `connect`/`disconnect`/`write`/`read`/`render`/`on`/`off` + `DeviceInfo`/`Capabilities` | ✓       | `src/core/Device.ts`                             |
| F-02 | `MockDevice` deterministic, in-memory                                                                           | ✓       | fixture-friendly `getLastPattern()`              |
| F-03 | `VirtualDevice` framebuffer simulation                                                                          | ✓       | `snapshot()`, configurable `dotCount`, 30 Hz     |
| F-04 | `HIDDevice` optional adapter (WebHID / node-hid dynamic import, graceful fallback)                              | ✓       | no hard dep; `connect()` succeeds without HID    |
| F-05 | Every feature works with **all three** devices                                                                  | ✓       | contract tests param'd over Mock/Virtual/HID     |
| F-06 | `Registry<T>` generic, `register`/`unregister`/`swap`/`hotSwap`, `swapped` event                                | ✓       | `src/core/Registry.ts`                           |
| F-07 | `DIContainer` `register`/`resolve`/`hotSwap`/`unregister` with singleton/transient + disposer                   | ✓       | `src/core/DIContainer.ts` + exported `container` |
| F-08 | `DeviceManager` plugin-first: `register`/`unregister`/`hotSwap`/`broadcast`/`setActive`/`getActive`             | ✓       | error-isolated broadcast                         |
| F-09 | `Plugin` contract (`id`, `version`, `activate`, optional `deactivate`)                                          | ✓       | `src/plugins/types.ts`                           |
| F-10 | `PluginRegistry` `register`/`activate`/`deactivate`/`hotSwap`                                                   | ✓       | per-id atomic                                    |
| F-11 | `PluginHost` workflow dispatch (`registerWorkflow`/`runWorkflow`/`hasWorkflow`/`listWorkflows`)                 | ✓       | single entry point                               |
| F-12 | `ResearchWorkflow` citation-shaped results                                                                      | ✓       | stubbed, additive seam                           |
| F-13 | `MarketplaceWorkflow` catalog/search/install                                                                    | ✓       | fixture catalog                                  |
| F-14 | `ReaderWorkflow` pagination + aria labels                                                                       | ✓       | `toLiveRegion` helper                            |
| F-15 | `TactileWorkflow` text→dots→`device.render`                                                                     | ✓       | `textToDots` 6-dot range                         |
| F-16 | `npm run bootstrap` verified from clean clone                                                                   | ✓       | `scripts/bootstrap.mjs`, see BOOTSTRAP.md        |
| F-17 | `npm run verify` gate (typecheck+lint+format+test+build)                                                        | ✓       | CI + local                                       |

No functional requirement is speculative — each row is traceable to a file above.

## 7. Non-Functional Requirements

| Area                  | Requirement                                                | How met (v0.3.0)                                                     |
| --------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| Type safety           | `strict` TypeScript, `noEmitOnError`, declarations         | `tsconfig.json` strict, `tsc --noEmit` gate                          |
| Code quality          | Lint + format gates                                        | `eslint` 9 + `typescript-eslint` 8, `prettier` 3.3, `npm run verify` |
| Determinism           | Mock/Virtual devices deterministic; no flaky tests         | `MockDevice`/`VirtualDevice` in-memory, 15 tests ~1s                 |
| Compatibility         | No runtime `dependencies`; Node >=20                       | `package.json` `dependencies: {}`                                    |
| Performance           | Test + build <5s on dev hardware                           | vitest ~1s, tsc <1s, verify <5s                                      |
| Zero breaking changes | Additive only since v0.1                                   | Device/Plugin contracts additive; no field removals                  |
| Reproducibility       | `npm ci` + `npm run verify` deterministic from clean clone | `scripts/bootstrap.mjs` idempotent                                   |
| CI                    | Ubuntu + Node 20, same gate as local                       | `.github/workflows/ci.yml`                                           |

## 8. Accessibility Requirements (WCAG 2.2 AA)

AutoSD guarantees AA structurally via `src/accessibility/a11y.ts` (single gate, not per-feature duplication):

| WCAG 2.2 | Criterion             | Level | Implementation                                                       | Test                      |
| -------- | --------------------- | ----- | -------------------------------------------------------------------- | ------------------------- |
| 1.4.3    | Contrast (Minimum)    | AA    | `passesContrast(lumA, lumB, isLarge)` ≥4.5 (3.0 large)               | `tests/a11y/a11y.test.ts` |
| 2.4.3    | Focus Order           | A     | `auditFocusOrder(domOrder, tabOrder)` equality                       | test                      |
| 2.4.7    | Focus Visible         | AA    | DOM-order + tabOrder audit covers (focus delegation in future UI)    | test scaffold             |
| 2.5.8    | Target Size (Minimum) | AA    | `auditTargetSize(w,h)` ≥24 px (`WCAG.minTargetSizePx`)               | test                      |
| 4.1.3    | Status Messages       | AA    | `createLiveRegion(message)` → `{ role:"status", ariaLive:"polite" }` | test                      |

`ReaderWorkflow` emits `ariaLabel` per page; `TactileWorkflow` keeps text alternative via `ReaderPage.text` (non-haptic fallback). Reduced-motion is respected via `prefersReducedMotion()` (window.matchMedia guard). No UI ships in v0.3.0 that violates these helpers — workflow code must import from `a11y.ts`, not duplicate thresholds.

## 9. Plugin Ecosystem Specification

**Contract:** `Plugin { id, version, description?, activate(ctx), deactivate? }` (`src/plugins/types.ts`). `PluginContext` provides `appVersion` + `api: { registerWorkflow, unregisterWorkflow }`.

**Lifecycle:** `PluginRegistry.register` → `activate` (may call `registerWorkflow`) → `deactivate` → `hotSwap(next)` (deactivate old, register new, activate). All per-`id` atomically; `PluginState` tracked.

**Distribution:** `MarketplaceWorkflow.catalog()` is the v0.3.0 registry; `search` is substring; `install` is lookup. No network in v0.3.0; networked discovery is a deferred Phase-0 RFC.

**Rules (additive-only):** New plugin fields must be optional. `PluginHost.runWorkflow(id, payload)` is the sole dispatch. Plugins must not reach into `DeviceManager` internals; they receive `Device` via DI/workflow args.

**Conformance:** `tests/core/registry.test.ts` proves `hotSwap` rebinds workflows atomically (v1→v2).

## 10. Research Workflow (as implemented)

Input: `ResearchQuery { id, question, corpusIds? }` → Output: `ResearchResult { queryId, answer, citations: { source, chunkId }[], confidence }`.

v0.3.0 is a **deterministic stub** (no retrieval/LLM). It exists so the **seam** is exercised: callers handle citations, UI can render provenance, and the fixture is swappable via `Registry`/`DI` without touching call sites. The checklist for the real retrieval (BM25 → hybrid) lives as a deferred RFC (see §14) — consistent with the additive-only rule.

## 11. Marketplace Workflow (as implemented)

Catalog: `autosd-reader@0.3.0`, `autosd-tts@0.2.0`, `autosd-braille@0.1.5` with `downloads`. `search(query)` lowercases and matches `name`/`id`/`description`. `install(id)` returns the entry or throws `not found`. No side effects in v0.3.0 (install does not auto-register a plugin; operator wires via `PluginRegistry`). This keeps the flow testable without a package manager.

## 12. Reader + Tactile Workflow (as implemented)

**Reader:** `ReaderWorkflow.paginate(doc, charsPerPage=1000)` splits `content` into `ReaderPage[]` with `ariaLabel` incorporating `title` + page number; `toLiveRegion(page)` yields a polite-status excerpt for screen readers.

**Tactile:** `textToDots(text, dotCount=40) → Uint8Array` maps each char to 6-dot range (`charCode % 64`); `TactileWorkflow.renderText(device, text)` builds the pattern from `device.info.capabilities.dotCount` and calls `device.render(pattern)`; `renderPages` iterates. Because `Device.render` is stable, any of Mock/Virtual/HID renders the same bytes — verified by `tests/workflows/workflows.test.ts` and `tests/devices/devices.test.ts`.

## 13. Success Metrics

| Metric                                | v0.3.0 target                                       | How measured                                 |
| ------------------------------------- | --------------------------------------------------- | -------------------------------------------- |
| `npm run verify` green on clean clone | 100%                                                | `scripts/bootstrap.mjs` + CI                 |
| Device-contract compatibility         | 3/3 (Mock, Virtual, HID)                            | param'd device tests                         |
| Tests green                           | 15/15, ~1s, 0 flaky                                 | `vitest run`                                 |
| Typecheck + lint + format             | 0 errors                                            | `tsc --noEmit`, `eslint`, `prettier --check` |
| WCAG 2.2 AA helpers pass              | 4/4                                                 | `tests/a11y/a11y.test.ts`                    |
| Hot-swap without restart              | DI, Device, Plugin each swap atomically             | `tests/core/registry.test.ts`                |
| Plugin workflows discoverable         | `listWorkflows()` reflects `registerWorkflow` calls | `PluginHost` tests                           |
| Time-to-first-traceable render        | <5 min from clone (bootstrap + `renderText`)        | `BOOTSTRAP.md` quick start                   |
| Zero breaking changes                 | 0 removals since v0.1                               | contract audit (Device/Plugin additive)      |

## 14. Release Roadmap (v0.4 → v1.0)

> Additive only. No existing API is removed. Each item has a re-entry trigger; nothing ships by calendar alone.

**v0.4 — Retrieval-grounded research (deferred from v0.3 stub)**

- Real hybrid retrieval behind `ResearchWorkflow` (BM25 baseline → dense+RRF gated on measured recall@k, per `prior-art-report.md` checklist).
- Corpus snapshot ingestion (frozen snapshot + per-chunk `source_url`/`capture_date` provenance, schema-first, pipeline later).
- Update `ResearchResult.citations` to resolve against snapshot chunk IDs (mechanical citation verification).

**v0.5 — Marketplace + plugin sandbox**

- Networked catalog search, signed installs, version pinning, provenance manifest per vendored plugin (license scan in CI already exists).
- Plugin sandbox + resource limits; `hotSwap` telemetry.

**v0.6 — Reader excellence**

- Full `arc42`/`MADR` rendering beside Mermaid, traceability matrix (`reader doc → tactile bytes → device`), edit loop (patch IR → revalidate → rerender).

**v0.7 — Tactile fidelity**

- Calibrated dot-count profiles per device, haptic timing, HID capability probing (`hasHaptics`/`hasDisplay`/`refreshRateHz`).

**v1.0 — Community + guarantees**

- Stable semver, `SECURITY.md` + threat model, `CONTRIBUTING.md` filled (RFC/ADR process), plugin discovery survey gate (≥3 documented use-cases before plugin API freeze), full WCAG 2.2 AA audit on any shipped UI, micro-benchmark publication (10–15 real docs, survival outcomes).

---

## Appendix — Traceability (file → requirement)

| Requirement                               | Files                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| Device contract                           | `src/core/Device.ts`                                                                        |
| Mock/Virtual/HID                          | `src/devices/*.ts`                                                                          |
| Registry + DI + DeviceManager             | `src/core/{Registry,DIContainer,DeviceManager}.ts`                                          |
| Plugin system                             | `src/plugins/{types,PluginRegistry,PluginHost}.ts`                                          |
| Research / Marketplace / Reader / Tactile | `src/workflows/*.ts`                                                                        |
| WCAG 2.2 AA                               | `src/accessibility/a11y.ts`, `tests/a11y/a11y.test.ts`                                      |
| Bootstrap + verify                        | `scripts/bootstrap.mjs`, `.github/workflows/ci.yml`, `package.json#scripts`, `BOOTSTRAP.md` |

No requirement in this PRD is imaginary — each row is importable from `src/index.ts`.
