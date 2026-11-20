export type EvalQueryCategory = "lexical" | "paraphrase" | "typo" | "multi-doc";

export type EvalQuery = {
  readonly id: string;
  readonly category: EvalQueryCategory;
  readonly question: string;
};

export type QrelsMap = Map<string, Map<string, number>>;

const VALID_CATEGORIES = new Set<EvalQueryCategory>(["lexical", "paraphrase", "typo", "multi-doc"]);

export function parseQueriesTsv(raw: string): EvalQuery[] {
  const lines = raw.split(/\r?\n/);
  const queries: EvalQuery[] = [];
  const seenIds = new Set<string>();

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = idx + 1;
    const trimmed = lines[idx].trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    const parts = lines[idx].split("\t");
    if (parts.length !== 3) {
      throw new Error(
        `queries.tsv line ${lineNo}: expected 3 tab-separated columns (queryId, category, question), got ${parts.length}`,
      );
    }

    const id = parts[0].trim();
    const category = parts[1].trim() as EvalQueryCategory;
    const question = parts[2].trim();

    if (!id) {
      throw new Error(`queries.tsv line ${lineNo}: empty queryId`);
    }
    if (seenIds.has(id)) {
      throw new Error(`queries.tsv line ${lineNo}: duplicate queryId "${id}"`);
    }
    if (!VALID_CATEGORIES.has(category)) {
      throw new Error(
        `queries.tsv line ${lineNo}: invalid category "${parts[1].trim()}" (expected lexical | paraphrase | typo | multi-doc)`,
      );
    }
    if (!question) {
      throw new Error(`queries.tsv line ${lineNo}: empty question for query "${id}"`);
    }

    seenIds.add(id);
    queries.push({ id, category, question });
  }

  return queries;
}

export function parseQrelsTsv(
  raw: string,
  knownQueryIds?: ReadonlySet<string>,
  knownDocIds?: ReadonlySet<string>,
): QrelsMap {
  const lines = raw.split(/\r?\n/);
  const qrels: QrelsMap = new Map();

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = idx + 1;
    const trimmed = lines[idx].trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    const parts = lines[idx].split("\t");
    if (parts.length !== 3) {
      throw new Error(
        `qrels.tsv line ${lineNo}: expected 3 tab-separated columns (queryId, docId, grade), got ${parts.length}`,
      );
    }

    const queryId = parts[0].trim();
    const docId = parts[1].trim();
    const gradeStr = parts[2].trim();

    if (!queryId) {
      throw new Error(`qrels.tsv line ${lineNo}: empty queryId`);
    }
    if (!docId) {
      throw new Error(`qrels.tsv line ${lineNo}: empty docId`);
    }
    if (!/^[0-3]$/.test(gradeStr)) {
      throw new Error(
        `qrels.tsv line ${lineNo}: invalid grade "${gradeStr}" (expected integer 0..3)`,
      );
    }
    const grade = Number(gradeStr);

    if (knownQueryIds && !knownQueryIds.has(queryId)) {
      throw new Error(`qrels.tsv line ${lineNo}: unknown queryId "${queryId}"`);
    }
    if (knownDocIds && !knownDocIds.has(docId)) {
      throw new Error(`qrels.tsv line ${lineNo}: unknown docId "${docId}"`);
    }

    let docMap = qrels.get(queryId);
    if (!docMap) {
      docMap = new Map();
      qrels.set(queryId, docMap);
    }
    if (docMap.has(docId)) {
      throw new Error(`qrels.tsv line ${lineNo}: duplicate judgment for (${queryId}, ${docId})`);
    }
    docMap.set(docId, grade);
  }

  return qrels;
}
