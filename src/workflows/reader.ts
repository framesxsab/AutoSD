/**
 * Reader workflow — loads content and emits accessible reading order.
 */
import { measureBrailleCells, textToBraille, type BrailleGrade } from "./tactile.js";

export type ReaderDocument = {
  id: string;
  title: string;
  content: string;
};

export type ReaderPage = {
  docId: string;
  index: number;
  text: string;
  ariaLabel: string;
  brailleLines?: readonly string[];
  cellCount?: number;
};

export type PaginateOptions = {
  readonly charsPerPage?: number;
  readonly wordBoundary?: boolean;
};

export type CellPaginateOptions = {
  readonly cellCount?: number;
  readonly linesPerPage?: number;
  readonly mode?: "braille" | "dots";
  readonly grade?: BrailleGrade;
};

export class ReaderWorkflow {
  paginate(doc: ReaderDocument, charsPerPageOrOpts: number | PaginateOptions = 1000): ReaderPage[] {
    const opts: PaginateOptions =
      typeof charsPerPageOrOpts === "number"
        ? { charsPerPage: charsPerPageOrOpts, wordBoundary: false }
        : charsPerPageOrOpts;
    const charsPerPage = Math.max(1, opts.charsPerPage ?? 1000);
    const wordBoundary = opts.wordBoundary ?? false;
    const pages: ReaderPage[] = [];

    if (!wordBoundary) {
      for (let i = 0; i < doc.content.length; i += charsPerPage) {
        const text = doc.content.slice(i, i + charsPerPage);
        pages.push({
          docId: doc.id,
          index: pages.length,
          text,
          ariaLabel: `${doc.title} — page ${pages.length + 1}`,
        });
      }
      return pages;
    }

    let start = 0;
    while (start < doc.content.length) {
      let end = Math.min(start + charsPerPage, doc.content.length);
      if (end < doc.content.length) {
        const slice = doc.content.slice(start, end);
        const lastSpace = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\n"));
        if (lastSpace > charsPerPage * 0.5) {
          end = start + lastSpace + 1;
        }
      }
      const text = doc.content.slice(start, end);
      pages.push({
        docId: doc.id,
        index: pages.length,
        text,
        ariaLabel: `${doc.title} — page ${pages.length + 1}`,
      });
      start = end;
    }
    return pages;
  }

  /**
   * M4 cell-aware pagination: packs words into display-width tactile lines
   * (`cellCount` cells per line, accounting for UEB Grade 1 capital and number
   * prefixes when `mode === "braille"`), and groups `linesPerPage` lines into
   * each `ReaderPage` so no line overflows the hardware braille display.
   */
  paginateByCells(doc: ReaderDocument, opts: CellPaginateOptions = {}): ReaderPage[] {
    const cellCount = Math.max(8, Math.floor(opts.cellCount ?? 40));
    const linesPerPage = Math.max(1, Math.floor(opts.linesPerPage ?? 5));
    const mode = opts.mode ?? "braille";
    const grade: BrailleGrade = opts.grade === 2 ? 2 : 1;
    const measure = (s: string): number =>
      mode === "braille" ? measureBrailleCells(s, { grade }) : s.length;

    const words = doc.content.replace(/\r\n/g, "\n").split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];

    const textLines: string[] = [];
    let currentLine = "";

    for (const word of words) {
      const candidate = currentLine.length === 0 ? word : `${currentLine} ${word}`;
      if (measure(candidate) <= cellCount) {
        currentLine = candidate;
        continue;
      }
      if (currentLine.length > 0) {
        textLines.push(currentLine);
        currentLine = "";
      }
      if (measure(word) <= cellCount) {
        currentLine = word;
      } else {
        let slice = "";
        for (const ch of word) {
          if (measure(slice + ch) > cellCount && slice.length > 0) {
            textLines.push(slice);
            slice = ch;
          } else {
            slice += ch;
          }
        }
        currentLine = slice;
      }
    }
    if (currentLine.length > 0) textLines.push(currentLine);

    const pages: ReaderPage[] = [];
    for (let i = 0; i < textLines.length; i += linesPerPage) {
      const pageLines = textLines.slice(i, i + linesPerPage);
      const brailleLines = pageLines.map(l => textToBraille(l, cellCount, { grade }).unicode);
      pages.push({
        docId: doc.id,
        index: pages.length,
        text: pageLines.join("\n"),
        ariaLabel: `${doc.title} — page ${pages.length + 1} (${pageLines.length} × ${cellCount}-cell lines)`,
        brailleLines,
        cellCount,
      });
    }
    return pages;
  }

  toLiveRegion(page: ReaderPage): string {
    return `${page.ariaLabel}: ${page.text.slice(0, 120)}…`;
  }
}
