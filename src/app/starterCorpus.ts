import type { Document } from "../retrieval/types.js";

/**
 * Self-contained starter documents for first-time browser sessions.
 * Safe, deterministic, offline-only — never touches user files.
 */
export const STARTER_CORPUS: readonly Document[] = [
  {
    id: "autosd-overview",
    path: "starter/autosd-overview.md",
    content:
      "AutoSD turns a local document corpus into grounded, citation-backed answers and renders reading passages onto any tactile display. " +
      "Every retrieval query combines BM25 lexical matching with vector embeddings via Reciprocal Rank Fusion, then attaches exact chunk citations and a retrieval confidence score. " +
      "Documents remain entirely on your device with no account or telemetry.",
  },
  {
    id: "tactile-braille-guide",
    path: "starter/tactile-braille-guide.md",
    content:
      "Unified English Braille (UEB) Grade 1 encodes letters, digits, capitalization, and punctuation into six-dot braille cells. " +
      "Cells map directly to Unicode Braille Patterns (U+2800 to U+283F) so refreshable tactile displays and software simulators render consistent dot masks. " +
      "A 40-cell line holds one reading slice, while VirtualDevice and HIDDevice share one identical Device interface.",
  },
  {
    id: "keyboard-accessibility",
    path: "starter/keyboard-accessibility.md",
    content:
      "AutoSD targets WCAG 2.2 AA accessibility across every route. " +
      "Primary view headings receive focus on navigation, live regions announce corpus updates politely, and all interactive controls keep at least a 36px target height with high-contrast focus outlines.",
  },
];
