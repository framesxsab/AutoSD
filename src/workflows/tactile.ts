/**
 * Tactile workflow — maps text to dot patterns for haptic devices.
 * Keeps Mock/Virtual/HID compatibility via Device contract.
 */
import type { Device } from "../core/Device.js";

export type BrailleGrade = 1 | 2;

export type BrailleEncodeOptions = {
  readonly grade?: BrailleGrade;
};

export type BrailleRenderResult = {
  readonly cells: Uint8Array;
  readonly unicode: string;
  readonly displayUnicode: string;
  readonly activeCells: number;
  readonly grade?: BrailleGrade;
  readonly sourceText?: string;
  readonly cellToCharIndex?: readonly number[];
};

export type BrailleCellInspection = {
  readonly cellIndex: number;
  readonly unicodeCell: string;
  readonly char: string;
  readonly word: string;
  readonly charIndex: number;
};

const CAPITAL_SIGN = 0x20; // dot 6 (⠠)
const CAPITAL_TERMINATOR_SECOND = 0x04; // dot 3 (⠄) — capital terminator is ⠠⠄
const NUMBER_SIGN = 0x3c; // dots 3-4-5-6 (⠼)
const GRADE1_LETTER_SIGN = 0x30; // dots 5-6 (⠰) — terminates numeric mode before a-j

const BRAILLE_LETTERS: Readonly<Record<string, number>> = {
  a: 0x01,
  b: 0x03,
  c: 0x09,
  d: 0x19,
  e: 0x11,
  f: 0x0b,
  g: 0x1b,
  h: 0x13,
  i: 0x0a,
  j: 0x1a,
  k: 0x05,
  l: 0x07,
  m: 0x0d,
  n: 0x1d,
  o: 0x15,
  p: 0x0f,
  q: 0x1f,
  r: 0x17,
  s: 0x0e,
  t: 0x1e,
  u: 0x25,
  v: 0x27,
  w: 0x3a,
  x: 0x2d,
  y: 0x3d,
  z: 0x35,
};

const DIGIT_LETTERS = ["j", "a", "b", "c", "d", "e", "f", "g", "h", "i"] as const;

const BRAILLE_PUNCT: Readonly<Record<string, number>> = {
  " ": 0x00,
  "\n": 0x00,
  "\r": 0x00,
  "\t": 0x00,
  ",": 0x02,
  ";": 0x06,
  ":": 0x12,
  ".": 0x32,
  "!": 0x16,
  "?": 0x26,
  "-": 0x24,
  "'": 0x04,
  "/": 0x0c,
};

/**
 * Standard 2-cell UEB Grade 1 punctuation and technical symbols.
 */
const BRAILLE_TWO_CELL_PUNCT: Readonly<Record<string, readonly [number, number]>> = {
  "(": [0x10, 0x23], // ⠐⠣
  ")": [0x10, 0x1c], // ⠐⠜
  "[": [0x28, 0x23], // ⠨⠣
  "]": [0x28, 0x1c], // ⠨⠜
  '"': [0x20, 0x36], // ⠠⠶ (UEB nondirectional double quote)
  "@": [0x08, 0x01], // ⠈⠁
  "#": [0x38, 0x39], // ⠸⠹
  $: [0x08, 0x0e], // ⠈⠎
  "%": [0x28, 0x34], // ⠨⠴
  "&": [0x08, 0x2f], // ⠈⠯
  "*": [0x10, 0x14], // ⠐⠔
  "+": [0x10, 0x16], // ⠐⠖
  "=": [0x10, 0x36], // ⠐⠶
  _: [0x28, 0x24], // ⠨⠤
};

const CELL_TO_LETTER: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(BRAILLE_LETTERS).map(([ch, mask]) => [mask, ch]),
);

const CELL_TO_DIGIT: Readonly<Record<number, string>> = Object.fromEntries(
  DIGIT_LETTERS.map((letter, digit) => [BRAILLE_LETTERS[letter], String(digit)]),
);

const SINGLE_CELL_TO_PUNCT: Readonly<Record<number, string>> = {
  0x02: ",",
  0x06: ";",
  0x12: ":",
  0x32: ".",
  0x16: "!",
  0x26: "?",
  0x24: "-",
  0x04: "'",
  0x0c: "/",
};

const TWO_CELL_TO_PUNCT: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(BRAILLE_TWO_CELL_PUNCT).map(([ch, [a, b]]) => [`${a}:${b}`, ch]),
);

/**
 * UEB Grade 2 alphabetic wordsigns (standing alone).
 * Single letters a, i, o are excluded because they stand for themselves.
 */
const GRADE2_WORD_TO_LETTER: Readonly<Record<string, string>> = {
  but: "b",
  can: "c",
  do: "d",
  every: "e",
  from: "f",
  go: "g",
  have: "h",
  just: "j",
  knowledge: "k",
  like: "l",
  more: "m",
  not: "n",
  people: "p",
  quite: "q",
  rather: "r",
  so: "s",
  that: "t",
  us: "u",
  very: "v",
  will: "w",
  it: "x",
  you: "y",
  as: "z",
};

const GRADE2_LETTER_TO_WORD: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(GRADE2_WORD_TO_LETTER).map(([word, letter]) => [letter, word]),
);

/**
 * UEB Grade 2 strong wordsigns & strong groupsigns (ordered longest-first).
 * Every cell mask is disjoint from BRAILLE_LETTERS and single-cell punctuation.
 */
const GRADE2_STRONG_SIGNS: readonly (readonly [string, number])[] = [
  ["with", 0x3e], // ⠾
  ["and", 0x2f], // ⠯
  ["for", 0x3f], // ⠿
  ["the", 0x2e], // ⠮
  ["ing", 0x2c], // ⠬
  ["of", 0x37], // ⠷
  ["ch", 0x21], // ⠡
  ["gh", 0x23], // ⠣
  ["sh", 0x29], // ⠩
  ["th", 0x39], // ⠹
  ["wh", 0x31], // ⠱
  ["ed", 0x2b], // ⠫
  ["er", 0x3b], // ⠻
  ["ou", 0x33], // ⠳
  ["ow", 0x2a], // ⠪
  ["ar", 0x1c], // ⠜
];

const CELL_TO_STRONG_SIGN: Readonly<Record<number, string>> = Object.fromEntries(
  GRADE2_STRONG_SIGNS.map(([text, mask]) => [mask, text]),
);

function isAsciiLetter(ch: string): boolean {
  return ch.length === 1 && BRAILLE_LETTERS[ch.toLowerCase()] !== undefined;
}

function isAsciiDigit(ch: string): boolean {
  return ch.length === 1 && ch >= "0" && ch <= "9";
}

function isUpperAsciiLetter(ch: string): boolean {
  const lower = ch.toLowerCase();
  return BRAILLE_LETTERS[lower] !== undefined && ch !== lower && ch === ch.toUpperCase();
}

function isDigitLetter(lower: string): boolean {
  return lower >= "a" && lower <= "j";
}

function classifySpanCase(span: string): "lower" | "upper" | "title" | "mixed" {
  let upperCount = 0;
  for (let i = 0; i < span.length; i++) {
    if (isUpperAsciiLetter(span[i])) upperCount += 1;
  }
  if (upperCount === 0) return "lower";
  if (upperCount === span.length) return "upper";
  if (upperCount === 1 && isUpperAsciiLetter(span[0])) return "title";
  return "mixed";
}

function applyCaseToWord(word: string, capWord: boolean, capNext: boolean): string {
  if (capWord) return word.toUpperCase();
  if (capNext) return word[0].toUpperCase() + word.slice(1);
  return word;
}

function encodeBrailleRaw(
  text: string,
  maxCells?: number,
  grade: BrailleGrade = 1,
): { cells: number[]; charIndices: number[] } {
  const cells: number[] = [];
  const charIndices: number[] = [];
  const limit = maxCells ?? Number.POSITIVE_INFINITY;
  let inNumber = false;
  let inCapWord = false;

  const pushCells = (seq: readonly number[], charIdx: number): boolean => {
    if (cells.length + seq.length > limit) return false;
    for (const c of seq) {
      cells.push(c);
      charIndices.push(charIdx);
    }
    return true;
  };

  for (let i = 0; i < text.length; i++) {
    if (cells.length >= limit) break;
    const ch = text[i];

    if (isAsciiDigit(ch)) {
      inCapWord = false;
      const digitMask = BRAILLE_LETTERS[DIGIT_LETTERS[Number(ch)]];
      const seq = inNumber ? [digitMask] : [NUMBER_SIGN, digitMask];
      if (!pushCells(seq, i)) break;
      inNumber = true;
      continue;
    }

    const lower = ch.toLowerCase();
    const letterMask = BRAILLE_LETTERS[lower];
    if (letterMask !== undefined) {
      const prevCh = i > 0 ? text[i - 1] : "";
      const atWordStart = !isAsciiLetter(prevCh) && !isAsciiDigit(prevCh);

      // UEB Grade 2 contractions (standing-alone alphabetic wordsigns + strong signs)
      if (grade === 2 && !inNumber) {
        if (atWordStart) {
          let wordEnd = i;
          while (wordEnd < text.length && isAsciiLetter(text[wordEnd])) wordEnd += 1;
          const afterWord = wordEnd < text.length ? text[wordEnd] : "";
          const standingAlone = !isAsciiDigit(afterWord);
          const wordSpan = text.slice(i, wordEnd);
          const wordLower = wordSpan.toLowerCase();
          const wsLetter = standingAlone ? GRADE2_WORD_TO_LETTER[wordLower] : undefined;
          if (wsLetter !== undefined) {
            const spanCase = classifySpanCase(wordSpan);
            if (spanCase !== "mixed") {
              const seq: number[] = [];
              if (spanCase === "upper") {
                seq.push(CAPITAL_SIGN, CAPITAL_SIGN);
              } else if (spanCase === "title") {
                seq.push(CAPITAL_SIGN);
              }
              seq.push(BRAILLE_LETTERS[wsLetter]);
              if (!pushCells(seq, i)) break;
              inCapWord = false;
              i = wordEnd - 1;
              continue;
            }
          }
        }

        // Strong wordsigns & groupsigns
        let matchedStrong = false;
        for (const [pattern, mask] of GRADE2_STRONG_SIGNS) {
          if (i + pattern.length > text.length) continue;
          const span = text.slice(i, i + pattern.length);
          if (span.toLowerCase() !== pattern) continue;
          const spanCase = classifySpanCase(span);
          if (spanCase === "mixed") continue;
          if (spanCase === "title" && inCapWord) continue;

          const seq: number[] = [];
          if (spanCase === "upper") {
            if (!inCapWord) {
              seq.push(CAPITAL_SIGN, CAPITAL_SIGN);
              inCapWord = true;
            }
          } else if (spanCase === "title") {
            seq.push(CAPITAL_SIGN);
          } else if (inCapWord) {
            seq.push(CAPITAL_SIGN, CAPITAL_TERMINATOR_SECOND);
            inCapWord = false;
          }
          seq.push(mask);
          if (!pushCells(seq, i)) {
            matchedStrong = true;
            i = text.length;
            break;
          }
          i += pattern.length - 1;
          matchedStrong = true;
          break;
        }
        if (matchedStrong) continue;
      }

      const upper = isUpperAsciiLetter(ch);
      const seq: number[] = [];
      const nextCh = i + 1 < text.length ? text[i + 1] : "";
      const isStandingAloneSingleLetter =
        grade === 2 &&
        atWordStart &&
        !isAsciiLetter(nextCh) &&
        !isAsciiDigit(nextCh) &&
        GRADE2_LETTER_TO_WORD[lower] !== undefined;

      if ((inNumber && isDigitLetter(lower)) || isStandingAloneSingleLetter) {
        seq.push(GRADE1_LETTER_SIGN);
      }
      inNumber = false;

      if (upper) {
        if (!inCapWord) {
          if (nextCh && isUpperAsciiLetter(nextCh)) {
            seq.push(CAPITAL_SIGN, CAPITAL_SIGN);
            inCapWord = true;
          } else {
            seq.push(CAPITAL_SIGN);
          }
        }
      } else if (inCapWord) {
        seq.push(CAPITAL_SIGN, CAPITAL_TERMINATOR_SECOND);
        inCapWord = false;
      }

      seq.push(letterMask);
      if (!pushCells(seq, i)) break;
      continue;
    }

    inNumber = false;
    inCapWord = false;

    const twoCell = BRAILLE_TWO_CELL_PUNCT[ch];
    if (twoCell !== undefined) {
      if (!pushCells(twoCell, i)) break;
      continue;
    }

    const punctMask = BRAILLE_PUNCT[ch];
    if (punctMask !== undefined) {
      if (!pushCells([punctMask], i)) break;
      continue;
    }

    if (!pushCells([ch.charCodeAt(0) % 64], i)) break;
  }

  return { cells, charIndices };
}

export function textToDots(text: string, dotCount = 40): Uint8Array {
  const pattern = new Uint8Array(dotCount);
  for (let i = 0; i < Math.min(text.length, dotCount); i++) {
    pattern[i] = text.charCodeAt(i) % 64; // 6-dot braille cell range
  }
  return pattern;
}

export function dotsToUnicodeBraille(cells: Uint8Array | readonly number[]): string {
  let out = "";
  for (let i = 0; i < cells.length; i++) {
    out += String.fromCharCode(0x2800 + (cells[i] & 0x3f));
  }
  return out;
}

/**
 * Convert a Unicode Braille Patterns string (`U+2800..U+28FF`) into a
 * 6-dot cell bitmask array (`0x00..0x3f`).
 */
export function unicodeBrailleToDots(unicode: string): Uint8Array {
  const out = new Uint8Array(unicode.length);
  for (let i = 0; i < unicode.length; i++) {
    const code = unicode.charCodeAt(i);
    out[i] = code >= 0x2800 && code <= 0x28ff ? (code - 0x2800) & 0x3f : 0;
  }
  return out;
}

/**
 * Additive UEB Braille encoder (Grade 1 default, optional Grade 2 contractions):
 * translates text into 6-dot cell bitmasks (`0x00..0x3f`) and Unicode Braille
 * Patterns (`U+2800..U+283F`), supporting capital letter/word indicators,
 * numeric mode with Grade 1 letter-mode disambiguation, and UEB punctuation.
 */
export function textToBraille(
  text: string,
  cellCount = 40,
  opts: BrailleEncodeOptions = {},
): BrailleRenderResult {
  const grade: BrailleGrade = opts.grade === 2 ? 2 : 1;
  const { cells: encoded, charIndices } = encodeBrailleRaw(text, cellCount, grade);
  const cells = new Uint8Array(cellCount);
  const used = Math.min(encoded.length, cellCount);
  for (let i = 0; i < used; i++) cells[i] = encoded[i];

  return {
    cells,
    unicode: dotsToUnicodeBraille(cells.subarray(0, used)),
    displayUnicode: dotsToUnicodeBraille(cells),
    activeCells: used,
    grade,
    sourceText: text,
    cellToCharIndex: charIndices.slice(0, used),
  };
}

function isLetterOrStrongCell(cell: number): boolean {
  return CELL_TO_LETTER[cell] !== undefined || CELL_TO_STRONG_SIGN[cell] !== undefined;
}

/**
 * Decode UEB Braille (Grade 1 default, optional Grade 2 contractions) from a
 * 6-dot bitmask array or Unicode Braille string back into plain text.
 */
export function brailleToText(
  input: Uint8Array | readonly number[] | string,
  opts: BrailleEncodeOptions = {},
): string {
  const grade: BrailleGrade = opts.grade === 2 ? 2 : 1;
  const cells = typeof input === "string" ? unicodeBrailleToDots(input) : input;
  let out = "";
  let inNumber = false;
  let capNext = false;
  let capWord = false;
  let grade1Next = false;
  let inWordChars = false;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i] & 0x3f;
    const next = i + 1 < cells.length ? cells[i + 1] & 0x3f : -1;

    if (cell === 0x00) {
      out += " ";
      inNumber = false;
      capNext = false;
      capWord = false;
      grade1Next = false;
      inWordChars = false;
      continue;
    }

    if (cell === NUMBER_SIGN) {
      inNumber = true;
      capNext = false;
      capWord = false;
      grade1Next = false;
      inWordChars = false;
      continue;
    }

    if (cell === GRADE1_LETTER_SIGN) {
      inNumber = false;
      grade1Next = true;
      continue;
    }

    if (cell === CAPITAL_SIGN && next === CAPITAL_SIGN) {
      capWord = true;
      capNext = false;
      inNumber = false;
      i += 1;
      continue;
    }

    if (cell === CAPITAL_SIGN && next === CAPITAL_TERMINATOR_SECOND && capWord) {
      capWord = false;
      i += 1;
      continue;
    }

    if (next >= 0) {
      const twoCellChar = TWO_CELL_TO_PUNCT[`${cell}:${next}`];
      if (twoCellChar !== undefined) {
        out += twoCellChar;
        inNumber = false;
        capNext = false;
        capWord = false;
        grade1Next = false;
        inWordChars = false;
        i += 1;
        continue;
      }
    }

    if (cell === CAPITAL_SIGN) {
      capNext = true;
      inNumber = false;
      continue;
    }

    if (inNumber && CELL_TO_DIGIT[cell] !== undefined) {
      out += CELL_TO_DIGIT[cell];
      inWordChars = true;
      continue;
    }

    if (grade === 2 && !grade1Next) {
      const strong = CELL_TO_STRONG_SIGN[cell];
      if (strong !== undefined) {
        inNumber = false;
        out += applyCaseToWord(strong, capWord, capNext);
        capNext = false;
        inWordChars = true;
        continue;
      }
    }

    const letter = CELL_TO_LETTER[cell];
    if (letter !== undefined) {
      inNumber = false;
      const nextContinuesWord =
        next >= 0 &&
        (isLetterOrStrongCell(next) ||
          next === CAPITAL_SIGN ||
          next === NUMBER_SIGN ||
          next === GRADE1_LETTER_SIGN);
      if (
        grade === 2 &&
        !grade1Next &&
        !inWordChars &&
        !nextContinuesWord &&
        GRADE2_LETTER_TO_WORD[letter] !== undefined
      ) {
        out += applyCaseToWord(GRADE2_LETTER_TO_WORD[letter], capWord, capNext);
        capNext = false;
        capWord = false;
        inWordChars = true;
        continue;
      }
      out += capWord || capNext ? letter.toUpperCase() : letter;
      capNext = false;
      grade1Next = false;
      inWordChars = true;
      continue;
    }

    const punct = SINGLE_CELL_TO_PUNCT[cell];
    if (punct !== undefined) {
      inNumber = false;
      capNext = false;
      capWord = false;
      grade1Next = false;
      inWordChars = false;
      out += punct;
      continue;
    }

    inNumber = false;
    capNext = false;
    capWord = false;
    grade1Next = false;
    inWordChars = false;
    out += String.fromCharCode(0x2800 + cell);
  }

  return out;
}

/**
 * Inspect the character and enclosing word corresponding to a physical
 * cursor-routing cell index on a rendered braille line.
 */
export function inspectBrailleCell(
  result: BrailleRenderResult,
  cellIndex: number,
): BrailleCellInspection | null {
  if (cellIndex < 0 || cellIndex >= result.cells.length) return null;
  const unicodeCell = String.fromCharCode(0x2800 + (result.cells[cellIndex] & 0x3f));
  const map = result.cellToCharIndex;
  const source = result.sourceText;
  if (!map || source === undefined || cellIndex >= map.length) {
    return null;
  }
  const charIndex = map[cellIndex];
  if (charIndex < 0 || charIndex >= source.length) return null;
  const char = source[charIndex];

  let start = charIndex;
  let end = charIndex;
  if (!/\s/.test(char)) {
    while (start > 0 && !/\s/.test(source[start - 1])) start -= 1;
    while (end + 1 < source.length && !/\s/.test(source[end + 1])) end += 1;
  }
  const word = /\s/.test(char) ? "space" : source.slice(start, end + 1);

  return {
    cellIndex,
    unicodeCell,
    char,
    word,
    charIndex,
  };
}

/**
 * Compute the exact number of UEB Braille cells required to encode `text`
 * without truncation (accounting for capital indicators, number signs,
 * Grade 1 letter-mode indicators, 2-cell punctuation, and optional Grade 2 contractions).
 */
export function measureBrailleCells(text: string, opts: BrailleEncodeOptions = {}): number {
  const grade: BrailleGrade = opts.grade === 2 ? 2 : 1;
  return encodeBrailleRaw(text, undefined, grade).cells.length;
}

/**
 * Split arbitrary text into word-wrapped tactile lines where every line is
 * guaranteed to fit within `cellCount` UEB Braille cells without
 * mid-word truncation.
 */
export function wrapTextToBrailleLines(
  text: string,
  cellCount = 40,
  opts: BrailleEncodeOptions = {},
): BrailleRenderResult[] {
  const safeCells = Math.max(4, Math.floor(cellCount));
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return [textToBraille("", safeCells, opts)];
  }

  const rawLines: string[] = [];
  for (const paragraph of normalized.split(/\n+/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let currentLine = "";

    for (const word of words) {
      const candidate = currentLine.length === 0 ? word : `${currentLine} ${word}`;
      if (measureBrailleCells(candidate, opts) <= safeCells) {
        currentLine = candidate;
        continue;
      }
      if (currentLine.length > 0) {
        rawLines.push(currentLine);
        currentLine = "";
      }
      if (measureBrailleCells(word, opts) <= safeCells) {
        currentLine = word;
      } else {
        // Single token longer than display width: slice into cell-fitting chunks
        let chunk = "";
        for (const ch of word) {
          if (measureBrailleCells(chunk + ch, opts) > safeCells && chunk.length > 0) {
            rawLines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        currentLine = chunk;
      }
    }
    if (currentLine.length > 0) {
      rawLines.push(currentLine);
    }
  }

  return rawLines.length > 0
    ? rawLines.map(line => textToBraille(line, safeCells, opts))
    : [textToBraille("", safeCells, opts)];
}

export class TactileWorkflow {
  async renderText(device: Device, text: string): Promise<void> {
    const pattern = textToDots(text, device.info.capabilities.dotCount ?? 40);
    await device.render(pattern);
  }

  async renderBraille(
    device: Device,
    text: string,
    opts: BrailleEncodeOptions = {},
  ): Promise<BrailleRenderResult> {
    const cellCount = device.info.capabilities.dotCount ?? 40;
    const encoded = textToBraille(text, cellCount, opts);
    await device.render(encoded.cells);
    return encoded;
  }

  async renderBrailleLines(
    device: Device,
    text: string,
    opts: BrailleEncodeOptions = {},
  ): Promise<BrailleRenderResult[]> {
    const cellCount = device.info.capabilities.dotCount ?? 40;
    const lines = wrapTextToBrailleLines(text, cellCount, opts);
    for (const line of lines) {
      await device.render(line.cells);
    }
    return lines;
  }

  async renderPages(device: Device, pages: string[]): Promise<void> {
    for (const page of pages) {
      await this.renderText(device, page);
    }
  }
}
