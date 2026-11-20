import { describe, it, expect } from "vitest";
import {
  buildCorpusFixture,
  buildQualityMarkdown,
  loadDiskCorpora,
  runQualityEval,
} from "../../src/retrieval/eval/runner.js";

describe("retrieval quality evaluation runner", () => {
  it("computes exact expected metrics on a synthetic 3-doc/3-query fixture", async () => {
    const fixture = buildCorpusFixture(
      "tiny",
      [
        { id: "d1", content: "piezoelectric actuator braille pin mechanism" },
        { id: "d2", content: "sourdough starter fermentation flour recipe" },
        { id: "d3", content: "contrast luminance ratio visual accessibility" },
      ],
      [
        "q1\tlexical\tpiezoelectric actuator braille",
        "q2\tlexical\tsourdough flour fermentation",
        "q3\tlexical\tcontrast luminance accessibility",
      ].join("\n"),
      ["q1\td1\t3", "q2\td2\t3", "q3\td3\t3"].join("\n"),
    );

    const report = await runQualityEval({ corpora: [fixture] });
    expect(report.macroOverall["bm25"].recallAt1).toBe(1);
    expect(report.macroOverall["bm25"].mrrAt10).toBe(1);
    expect(report.macroOverall["bm25"].ndcgAt10).toBe(1);
    expect(report.macroOverall["hybrid:lexical-hash"].ndcgAt10).toBe(1);
  });

  it("evaluates frozen disk corpora deterministically with byte-identical JSON", async () => {
    const corpora = await loadDiskCorpora();
    expect(corpora.map(c => c.id)).toEqual(["accessibility-standards", "demo", "tactile-history"]);

    const first = await runQualityEval({ corpora });
    const second = await runQualityEval({ corpora });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.generatedAt).toBeUndefined();
    expect(first.judgmentProvenance).toBe("maintainer-authored-provisional");

    expect(first.macroOverall["hybrid:lexical-hash"].ndcgAt10).toBeGreaterThanOrEqual(
      first.macroOverall["bm25"].ndcgAt10,
    );
    expect(first.macroOverall["hybrid:lexical-hash"].recallAt10).toBeGreaterThanOrEqual(
      first.macroOverall["bm25"].recallAt10,
    );
    expect(first.macroOverall["vector:lexical-hash"].ndcgAt10).toBeGreaterThan(
      first.macroOverall["vector:mock"].ndcgAt10,
    );

    const md = buildQualityMarkdown(first);
    for (const c of first.corpora) {
      expect(md).toContain(c.corpusHash);
      expect(md).toContain(c.qrelsHash);
    }
    expect(md).toContain("hybrid:lexical-hash");
    expect(md).toContain("maintainer-authored provisional");
  });
});
