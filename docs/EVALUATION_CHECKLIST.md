# AutoSD Public Evaluation Checklist

Run this against a clean clone and report results. Every item is runnable or explicitly marked manual. Copy the report template at the bottom into a GitHub issue titled `evaluation: <os / node version / date>`. Partial reports are welcome.

Rules:

- Report what happened, not what should have happened.
- Never report numbers you did not generate yourself.
- Do not edit capability-matrix statuses; maintainers move rows per the evidence rules in [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md).

## Section A — Software verification (automated)

- [ ] **A1. Clean clone + bootstrap passes.** `git clone … && cd autosd && npm run bootstrap` → prints `✓ Bootstrap complete`. Record wall-clock time.
- [ ] **A2. Test suite green.** `npm test` → all files pass. Record the counts vitest prints (expected at time of writing: 49 files, 275 tests — record whatever you actually see).
- [ ] **A3. Demo runs offline.** `npm run demo` (disconnect network if you can) → 7 steps progress on stderr, JSON on stdout.
- [ ] **A4. Demo is byte-stable.** Run twice with `--out`, compare hashes (`sha256sum` / `Get-FileHash`). Identical: yes/no.
- [ ] **A5. Export shape sane.** The JSON contains `demo`, `demoVersion` (2), `query`, `corpus` (4 ids), `reader.pages`, `answer`, `confidence`, `citations[]`, `tactile.frames[]` (3), `diagnostics`. Confirm each present.
- [ ] **A6. No volatile fields.** The export contains no timestamps, no `sess-` ids, no environment paths.
- [ ] **A7. Production build works.** `npm run build` → `dist/` and `dist-app/` produced without warnings that fail the gate.
- [ ] **A8. Release audit passes** (needs Chrome). `npm run verify:release` → Lighthouse accessibility ≥ 95, performance ≥ 90. Record actual scores.

## Section B — Browser walkthrough (manual; `npm run dev`)

For each route, record: works / broken / surprising. Note anything a newcomer would trip over.

- [ ] **B1. `#/home`** — onboarding appears on first visit; dashboard after reload.
- [ ] **B2. `#/workspace`** — add a document (paste or drop `.md` into `corpus/docs/`) → it appears indexed within ~a second.
- [ ] **B3. Search** — query returns virtualized results with scores.
- [ ] **B4. Citations** — clicking a result shows citation detail with source and score.
- [ ] **B5. `#/research`** — run a question → answer, citations list, confidence value shown. Note: confidence is an uncalibrated retrieval score — does the UI communicate that?
- [ ] **B6. `#/sessions`** — session history lists your queries; export downloads valid JSON; delete works.
- [ ] **B7. `#/devices`** — VirtualDevice selectable; render controls work; HID entry degrades gracefully when absent.
- [ ] **B8. `#/demo`** — seven-step guided demo completes; copy/export works.
- [ ] **B9. Keyboard-only pass** — complete B2→B8 without touching the mouse. Record where focus gets lost.
- [ ] **B10. Screen-reader spot check** (if you use one) — record announcements during search and demo completion. This is NOT formal AT user testing; it's your observations.

## Section C — Hardware (only if you own tactile hardware)

- [ ] **C1.** State device model, connection path (WebHID browser vs node-hid Node), OS.
- [ ] **C2.** Follow [HARDWARE_INTEGRATION.md](HARDWARE_INTEGRATION.md) §"First contact procedure". Record every step that behaved differently from the doc.
- [ ] **C3.** Did `render()` produce physical cell movement? yes/no/partial — describe.
- [ ] **C4.** What failed first (enumeration, permissions, write format, timing)?
- [ ] **C5.** Attach logs/diagnostics metadata (no secrets).

If you cannot check any C item, say "not tested" — silence is worse than absence.

## Section D — Honesty audit of docs

- [ ] **D1.** Spot-check three claims in the [README](../README.md) against [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md). Any claim without a matrix row? List them.
- [ ] **D2.** Did any doc imply human validation of tactile output? Quote it if so.
- [ ] **D3.** Were setup instructions accurate on your machine? List deviations.

## Report template

```markdown
evaluation: <OS> / Node <version> / <date>

Environment

- OS:
- Node/npm:
- Commit:
- Hardware used (Section C only):

Results

- A: A1 ✓/✗ … A8 ✓/✗ (with recorded numbers)
- B: B1…B10 notes
- C: not tested | findings per C1–C5
- D: D1…D3 findings

Deviations from documented behavior:

1. …

Would you ship/study/build on this today? Why / why not?
```

Thank you. Honest negative results are contributions.
