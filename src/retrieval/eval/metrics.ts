export function collapseChunksToDocIds(documentIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of documentIds) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function positiveRelevantIds(relevant: ReadonlyMap<string, number>): Set<string> {
  const rel = new Set<string>();
  for (const [docId, grade] of relevant) {
    if (grade > 0) rel.add(docId);
  }
  return rel;
}

export function recallAtK(
  rankedDocIds: readonly string[],
  relevant: ReadonlyMap<string, number>,
  k: number,
): number {
  if (k <= 0) return 0;
  const relIds = positiveRelevantIds(relevant);
  if (relIds.size === 0) return 0;

  const hits = new Set<string>();
  for (const docId of rankedDocIds.slice(0, k)) {
    if (relIds.has(docId)) hits.add(docId);
  }
  return hits.size / relIds.size;
}

export function precisionAtK(
  rankedDocIds: readonly string[],
  relevant: ReadonlyMap<string, number>,
  k: number,
): number {
  if (k <= 0) return 0;
  const relIds = positiveRelevantIds(relevant);

  const hits = new Set<string>();
  for (const docId of rankedDocIds.slice(0, k)) {
    if (relIds.has(docId)) hits.add(docId);
  }
  return hits.size / k;
}

export function mrr(
  rankedDocIds: readonly string[],
  relevant: ReadonlyMap<string, number>,
  k?: number,
): number {
  if (k !== undefined && k <= 0) return 0;
  const slice = k !== undefined ? rankedDocIds.slice(0, k) : rankedDocIds;
  for (let i = 0; i < slice.length; i++) {
    if ((relevant.get(slice[i]) ?? 0) > 0) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

export function ndcgAtK(
  rankedDocIds: readonly string[],
  relevant: ReadonlyMap<string, number>,
  k: number,
): number {
  if (k <= 0) return 0;

  const idealGrades: number[] = [];
  for (const grade of relevant.values()) {
    if (grade > 0) idealGrades.push(grade);
  }
  if (idealGrades.length === 0) return 0;

  idealGrades.sort((a, b) => b - a);
  const idealTop = idealGrades.slice(0, k);
  let idcg = 0;
  for (let i = 0; i < idealTop.length; i++) {
    idcg += (2 ** idealTop[i] - 1) / Math.log2(i + 2);
  }
  if (idcg === 0) return 0;

  const limit = Math.min(k, rankedDocIds.length);
  let dcg = 0;
  for (let i = 0; i < limit; i++) {
    const grade = relevant.get(rankedDocIds[i]) ?? 0;
    if (grade > 0) {
      dcg += (2 ** grade - 1) / Math.log2(i + 2);
    }
  }
  return dcg / idcg;
}

export function macroAverage(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export function roundMetric(value: number, decimals = 4): number {
  return Number(value.toFixed(decimals));
}
