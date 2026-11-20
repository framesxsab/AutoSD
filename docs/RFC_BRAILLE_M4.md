# RFC: Standard UEB Braille Encoding & Cell-Aware Tactile Reading (M4)

> **Status:** Implemented (`SOFTWARE-VALIDATED` in unit/integration tests; tactile readability remains `USER-VALIDATION-PENDING` pending studies with blind and low-vision readers, per `docs/CAPABILITY_MATRIX.md`).
>
> **Additive Compatibility Guarantee:** Legacy `textToDots(text, dotCount)` (`charCode % 64`) is untouched and remains available for byte-stable fixtures, `demoVersion: 2`, and `"dots"` mode.

---

## 1. Motivation

AutoSD v1.0 shipped `textToDots()` as a deterministic, device-portable placeholder (`charCodeAt(i) % 64`). While useful for software verification and device-contract tests, `textToDots` is not readable braille and does not account for multi-cell UEB indicators (capital signs, number signs, 2-cell punctuation) when wrapping lines to a physical display width (20, 40, or 80 cells).

Milestone M4 introduces an additive **Unified English Braille (UEB)** pipeline covering:

1. Uncontracted **UEB Grade 1** (default) and optional contracted **UEB Grade 2** encoding/decoding.
2. Exact cell-width measurement and word-wrapped line/page packing (`paginateByCells`).
3. Source-character-to-cell mapping (`cellToCharIndex`) to support physical HID cursor-routing keys.
4. Persisted user preferences (`tactileMode`, `brailleGrade`, `displayCellCount`, `cellPaginationEnabled`) in `BrowserStore`.

---

## 2. Public API Surface (Additive Only)

All exports live in `src/workflows/tactile.ts` (re-exported from `src/index.ts`):

| Symbol                                            | Purpose                                                                                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `textToBraille(text, cellCount?, opts?)`          | Encodes text to 6-dot bitmasks (`0x00..0x3f`) + Unicode Braille (`U+2800..U+283F`), returning `cells`, `unicode`, `displayUnicode`, `activeCells`, `grade`, `sourceText`, and `cellToCharIndex`. |
| `brailleToText(input, opts?)`                     | Round-trip decoder from Unicode Braille string or 6-dot bitmask array back to plain text (Grade 1 default, Grade 2 optional).                                                                    |
| `unicodeBrailleToDots(unicode)`                   | Converts `U+2800..U+28FF` strings into 6-dot `Uint8Array` bitmasks.                                                                                                                              |
| `measureBrailleCells(text, opts?)`                | Exact cell count via the same internal encoder (`encodeBrailleRaw`), guaranteeing zero drift against `textToBraille`.                                                                            |
| `wrapTextToBrailleLines(text, cellCount?, opts?)` | Word-wraps text into `BrailleRenderResult[]` lines with `activeCells <= cellCount`, slicing overlong single tokens cleanly.                                                                      |
| `inspectBrailleCell(result, cellIndex)`           | Maps a physical cursor-routing cell index back to `{ cellIndex, unicodeCell, char, word, charIndex }` (or `null` on trailing padding).                                                           |
| `ReaderWorkflow.paginateByCells(doc, opts?)`      | Groups cell-wrapped lines into `ReaderPage[]` (`linesPerPage × cellCount`) for `ReaderView`.                                                                                                     |

---

## 3. UEB Encoding Rules

### 3.1 Grade 1 (Default)

- **Letters `a–z`**: Standard 6-dot UEB bitmasks (`dot1 = 0x01` .. `dot6 = 0x20`).
- **Capitalization**:
  - Single capital letter: `⠠` (`0x20`) prefix.
  - Capital word (2+ consecutive uppercase letters): `⠠⠠` (`0x20, 0x20`) prefix, terminated automatically by non-letters or explicitly by capital terminator `⠠⠄` (`0x20, 0x04`) when transitioning mid-word to lowercase (e.g., `HTMLReader`).
- **Numbers & Letter-Mode Disambiguation**:
  - Digit runs begin with number indicator `⠼` (`0x3c`) followed by `a–j` (`1–9, 0`).
  - Letters `a–j` immediately following a digit emit the Grade 1 letter-mode indicator `⠰` (`0x30`) so `1a` is not misread as `11`.
- **Punctuation & Symbols**:
  - Single-cell: `, ; : . ! ? - ' /` and whitespace (`0x00`).
  - Two-cell UEB signs: `( ) [ ] " @ # $ % & * + = _`.

### 3.2 Grade 2 (Opt-In: `{ grade: 2 }`)

- **Standing-alone alphabetic wordsigns**: 23 standard UEB single-letter wordsigns (`but`, `can`, `do`, `every`, `from`, `go`, `have`, `just`, `knowledge`, `like`, `more`, `not`, `people`, `quite`, `rather`, `so`, `that`, `us`, `very`, `will`, `it`, `you`, `as`). Literal standalone single letters (other than `a`, `i`, `o`) are prefixed with `⠰` (`0x30`) for unambiguous round-trip decoding.
- **Strong wordsigns & strong groupsigns**: `with`, `and`, `for`, `the`, `of`, `ing`, `ch`, `gh`, `sh`, `th`, `wh`, `ed`, `er`, `ou`, `ow`, `ar` — all using bitmasks disjoint from `a–z` and single-cell punctuation.
- **Non-goals for v1.1 Grade 2**: Shortforms, lower-cell groupsigns (`be`, `con`, `dis`), and context-dependent bridge rules (e.g., syllable-boundary exceptions) are out of scope for v1.1 and should be evaluated with certified braille transcribers before expanding.

---

## 4. Reader & HID Integration

- **Reader UI (`src/app/views/readerView.ts`)**:
  - Toolbar toggle (`Cell-aware pagination`) switches `ReaderView` between character pagination and `paginateByCells`, persisted in `BrowserStore` (`cellPaginationEnabled`) and mirrored in `#/settings` alongside `brailleGrade` and `displayCellCount`.
  - Active device changes (`DeviceManager.on("activeChanged")`) automatically re-paginate to the newly selected display's `dotCount`.
- **HID Input Handling (`parseHIDInputReport`)**:
  - `pan-right` / `pan-left`: steps braille lines and crosses page boundaries automatically (landing on line 1 of the next page or the last line of the previous page).
  - `routing`: inspects `currentBrailleLines[activeLineIndex]` via `inspectBrailleCell` and announces `Cell N: "<char>" in "<word>"`.
  - `select`: announces the plain text of the active braille line.
  - `chord`: decodes the 6-dot Perkins chord via `brailleToText([chordMask])` and announces it.

---

## 5. Validation & Evidence Boundaries

- **Software-validated:** Deterministic encoding/decoding round-trips, cell-measurement invariants, line wrapping, cell pagination, HID packet parsing, and jsdom UI tests (`tests/workflows/brailleIteration3.test.ts`, `tests/workflows/brailleIteration4.test.ts`, `tests/workflows/workflows.test.ts`).
- **Hardware-dependent:** Physical USB/Bluetooth HID braille displays (Usage Page `0x0041`) require live hardware verification per `docs/HARDWARE_INTEGRATION.md`.
- **User-validation-pending:** Tactile readability and Grade 1/2 ergonomic verdicts require structured testing with blind and low-vision readers; AutoSD makes no claim of proven tactile readability until such studies are published.
