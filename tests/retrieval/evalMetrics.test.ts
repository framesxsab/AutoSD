import { describe, it, expect } from "vitest";
import {
  collapseChunksToDocIds,
  macroAverage,
  mrr,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  roundMetric,
} from "../../src/retrieval/eval/metrics.js";
import { parseQrelsTsv, parseQueriesTsv } from "../../src/retrieval/eval/qrels.js";

describe("retrieval eval metrics", () => {
  it("collapseChunksToDocIds deduplicates preserving first-seen rank order", () => {
    expect(collapseChunksToDocIds(["d2", "d1", "d2", "d3", "d1", "d4"])).toEqual([
      "d2",
      "d1",
      "d3",
      "d4",
    ]);
    expect(collapseChunksToDocIds([])).toEqual([]);
  });

  it("computes recallAtK, precisionAtK, mrr and roundMetric accurately", () => {
    const relevant = new Map<string, number>([
      ["d1", 3],
      ["d3", 1],
      ["d4", 0], // grade 0 is non-relevant
    ]);
    const ranked = ["d2", "d1", "d5", "d3"];

    expect(recallAtK(ranked, relevant, 1)).toBe(0);
    expect(recallAtK(ranked, relevant, 2)).toBe(0.5);
    expect(recallAtK(ranked, relevant, 10)).toBe(1); // k larger than ranked list

    expect(precisionAtK(ranked, relevant, 1)).toBe(0);
    expect(precisionAtK(ranked, relevant, 2)).toBe(0.5);
    expect(precisionAtK(ranked, relevant, 4)).toBe(0.5);
    expect(precisionAtK(ranked, relevant, 5)).toBe(0.4); // divides by k=5

    expect(mrr(ranked, relevant)).toBe(0.5);
    expect(mrr(ranked, relevant, 1)).toBe(0);
    expect(mrr(ranked, relevant, 2)).toBe(0.5);
    expect(roundMetric(1 / 3, 4)).toBe(0.3333);
    expect(macroAverage([0.5, 1.0, 0])).toBeCloseTo(0.5, 10);
    expect(macroAverage([])).toBe(0);
  });

  it("computes hand-checked graded ndcgAtK for ideal, reversed, and empty cases", () => {
    const relevant = new Map<string, number>([
      ["a", 3], // gain 7
      ["b", 2], // gain 3
      ["c", 1], // gain 1
      ["d", 0], // gain 0
    ]);

    // Ideal ordering yields 1.0
    expect(ndcgAtK(["a", "b", "c"], relevant, 3)).toBeCloseTo(1.0, 10);

    // Hand-computed: ["c", "d", "a"] at k=3
    // DCG = (2^1-1)/log2(2) + 0 + (2^3-1)/log2(4) = 1/1 + 7/2 = 4.5
    // IDCG = 7/log2(2) + 3/log2(3) + 1/log2(4) = 7 + 3/1.584962500721156 + 0.5
    const expectedIdcg = 7 + 3 / Math.log2(3) + 0.5;
    expect(ndcgAtK(["c", "d", "a"], relevant, 3)).toBeCloseTo(4.5 / expectedIdcg, 10);

    // Empty relevance set returns 0 safely
    const emptyRel = new Map<string, number>([["z", 0]]);
    expect(recallAtK(["z"], emptyRel, 5)).toBe(0);
    expect(ndcgAtK(["z"], emptyRel, 5)).toBe(0);
    expect(mrr(["z"], emptyRel, 5)).toBe(0);
    expect(ndcgAtK(["a"], relevant, 0)).toBe(0);
  });
});

describe("qrels & queries TSV parsers", () => {
  it("parses valid queries.tsv and qrels.tsv ignoring comments and blank lines", () => {
    const queriesRaw = [
      "# comment",
      "",
      "q1\tlexical\tWhat is braille?",
      "q2\tparaphrase\tHow do tactile dots form letters?",
    ].join("\n");
    const queries = parseQueriesTsv(queriesRaw);
    expect(queries).toEqual([
      { id: "q1", category: "lexical", question: "What is braille?" },
      { id: "q2", category: "paraphrase", question: "How do tactile dots form letters?" },
    ]);

    const qrelsRaw = ["# qrels", "q1\td1\t3", "q1\td2\t0", "q2\td1\t2"].join("\n");
    const qIds = new Set(queries.map(q => q.id));
    const docIds = new Set(["d1", "d2"]);
    const qrels = parseQrelsTsv(qrelsRaw, qIds, docIds);
    expect(qrels.get("q1")?.get("d1")).toBe(3);
    expect(qrels.get("q1")?.get("d2")).toBe(0);
    expect(qrels.get("q2")?.get("d1")).toBe(2);
  });

  it("throws line-numbered errors on invalid queries.tsv rows", () => {
    expect(() => parseQueriesTsv("q1\tunknown\tquestion")).toThrow(/line 1.*invalid category/);
    expect(() => parseQueriesTsv("q1\tlexical\tq1\nq1\ttypo\tq2")).toThrow(/line 2.*duplicate/);
    expect(() => parseQueriesTsv("only-two\tlexical")).toThrow(/line 1.*expected 3/);
  });

  it("throws line-numbered errors on invalid qrels.tsv rows", () => {
    const qIds = new Set(["q1"]);
    const docIds = new Set(["d1"]);

    expect(() => parseQrelsTsv("q1\td1\t4", qIds, docIds)).toThrow(/line 1.*invalid grade/);
    expect(() => parseQrelsTsv("q1\td1\t-1", qIds, docIds)).toThrow(/line 1.*invalid grade/);
    expect(() => parseQrelsTsv("q1\td1\t2\nq1\td1\t3", qIds, docIds)).toThrow(
      /line 2.*duplicate judgment/,
    );
    expect(() => parseQrelsTsv("q99\td1\t2", qIds, docIds)).toThrow(/line 1.*unknown queryId/);
    expect(() => parseQrelsTsv("q1\td99\t2", qIds, docIds)).toThrow(/line 1.*unknown docId/);
  });
});
