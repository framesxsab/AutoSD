import type { Chunk, Document } from "./types.js";

export type ChunkerOptions = {
  readonly chunkSize?: number;
  readonly overlap?: number;
  readonly minChunkSize?: number;
};

const DEFAULT_SIZE = 800;
const DEFAULT_OVERLAP = 120;
const DEFAULT_MIN = 50;

export function hashContent(content: string): string {
  let h1 = 2166136261;
  let h2 = 379857213;
  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 16777619);
    h2 ^= c + 0x9e3779b9;
    h2 = Math.imul(h2, 2246822519);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

export function chunkDocument(doc: Document, opts: ChunkerOptions = {}): Chunk[] {
  const chunkSize = opts.chunkSize ?? DEFAULT_SIZE;
  const rawOverlap = opts.overlap ?? DEFAULT_OVERLAP;
  const overlap = rawOverlap >= chunkSize ? Math.max(0, chunkSize - 1) : rawOverlap;
  const minChunkSize = opts.minChunkSize ?? DEFAULT_MIN;

  const text = doc.content;
  if (text.length === 0) return [];
  if (text.length <= chunkSize) {
    return [
      {
        id: `${doc.id}#0`,
        documentId: doc.id,
        content: text,
        start: 0,
        end: text.length,
        hash: hashContent(text),
      },
    ];
  }

  const chunks: Chunk[] = [];
  let start = 0;
  let idx = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    // Respect sentence/line boundaries when possible
    if (end < text.length) {
      const slice = text.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(". "));
      if (lastBreak > chunkSize * 0.5) {
        end = start + lastBreak + 1;
      }
    }

    const content = text.slice(start, end);
    if (content.trim().length >= minChunkSize || end === text.length) {
      chunks.push({
        id: `${doc.id}#${idx++}`,
        documentId: doc.id,
        content,
        start,
        end,
        hash: hashContent(content),
      });
    }

    if (end >= text.length) break;
    start = end - overlap;
    // Guard against infinite loop
    if (start < 0) start = 0;
  }

  return chunks;
}

export function chunkDocuments(docs: Document[], opts?: ChunkerOptions): Chunk[] {
  return docs.flatMap(d => chunkDocument(d, opts));
}
