import { hashContent } from "../chunker.js";
import { RetrievalPipeline, type RetrievalMode } from "../pipeline.js";
import type { EmbeddingProvider } from "../embedder.js";
import { MockEmbeddingProvider } from "../providers/MockEmbeddingProvider.js";
import { LexicalHashEmbeddingProvider } from "../providers/LexicalHashEmbeddingProvider.js";
import { LexicalReranker, type Reranker } from "../reranker.js";
import type { Document } from "../types.js";
import {
  collapseChunksToDocIds,
  macroAverage,
  mrr,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  roundMetric,
} from "./metrics.js";
import {
  parseQrelsTsv,
  parseQueriesTsv,
  type EvalQuery,
  type EvalQueryCategory,
  type QrelsMap,
} from "./qrels.js";

export const QUALITY_SCHEMA_ID = "autosd-retrieval-quality";
export const QUALITY_SCHEMA_VERSION = 1;

export type EvalCorpusFixture = {
  readonly id: string;
  readonly documents: readonly Document[];
  readonly queries: readonly EvalQuery[];
  readonly qrels: QrelsMap;
  readonly corpusHash: string;
  readonly qrelsHash: string;
};

export type QualityEvalConfig = {
  readonly id: string;
  readonly mode: RetrievalMode;
  readonly createProvider: () => EmbeddingProvider;
  readonly createReranker?: () => Reranker;
};

export type QualityMetricSummary = {
  readonly queryCount: number;
  readonly excludedQueryCount: number;
  readonly recallAt1: number;
  readonly recallAt5: number;
  readonly recallAt10: number;
  readonly precisionAt5: number;
  readonly mrrAt10: number;
  readonly ndcgAt5: number;
  readonly ndcgAt10: number;
};

export type CorpusConfigResult = {
  readonly configId: string;
  readonly providerId: string;
  readonly providerModel: string;
  readonly mode: RetrievalMode;
  readonly reranked: boolean;
  readonly overall: QualityMetricSummary;
  readonly byCategory: Partial<Record<EvalQueryCategory, QualityMetricSummary>>;
};

export type CorpusQualityReport = {
  readonly corpusId: string;
  readonly documentCount: number;
  readonly queryCount: number;
  readonly corpusHash: string;
  readonly qrelsHash: string;
  readonly results: readonly CorpusConfigResult[];
};

export type QualityEvalReport = {
  readonly schema: typeof QUALITY_SCHEMA_ID;
  readonly schemaVersion: typeof QUALITY_SCHEMA_VERSION;
  readonly judgmentProvenance: "maintainer-authored-provisional";
  readonly honestyNotice: string;
  readonly generatedAt?: string;
  readonly corpora: readonly CorpusQualityReport[];
  readonly macroOverall: Readonly<Record<string, QualityMetricSummary>>;
};

export type RunQualityEvalOptions = {
  readonly corpora?: readonly EvalCorpusFixture[];
  readonly rootDir?: string;
  readonly configs?: readonly QualityEvalConfig[];
  readonly ks?: readonly [number, number, number];
  readonly stamp?: boolean;
};

type QueryScoreRow = {
  readonly category: EvalQueryCategory;
  readonly recallAt1: number;
  readonly recallAt5: number;
  readonly recallAt10: number;
  readonly precisionAt5: number;
  readonly mrrAt10: number;
  readonly ndcgAt5: number;
  readonly ndcgAt10: number;
};

const CATEGORIES: readonly EvalQueryCategory[] = ["lexical", "paraphrase", "typo", "multi-doc"];

export const DEFAULT_QUALITY_CONFIGS: readonly QualityEvalConfig[] = [
  {
    id: "bm25",
    mode: "bm25",
    createProvider: () => new MockEmbeddingProvider(),
  },
  {
    id: "vector:mock",
    mode: "vector",
    createProvider: () => new MockEmbeddingProvider(),
  },
  {
    id: "hybrid:mock",
    mode: "hybrid",
    createProvider: () => new MockEmbeddingProvider(),
  },
  {
    id: "vector:lexical-hash",
    mode: "vector",
    createProvider: () => new LexicalHashEmbeddingProvider(),
  },
  {
    id: "hybrid:lexical-hash",
    mode: "hybrid",
    createProvider: () => new LexicalHashEmbeddingProvider(),
  },
  {
    id: "hybrid:lexical-hash+rerank",
    mode: "hybrid",
    createProvider: () => new LexicalHashEmbeddingProvider(),
    createReranker: () => new LexicalReranker(),
  },
];

function summarizeRows(
  rows: readonly QueryScoreRow[],
  excludedQueryCount = 0,
): QualityMetricSummary {
  return {
    queryCount: rows.length,
    excludedQueryCount,
    recallAt1: roundMetric(macroAverage(rows.map(r => r.recallAt1))),
    recallAt5: roundMetric(macroAverage(rows.map(r => r.recallAt5))),
    recallAt10: roundMetric(macroAverage(rows.map(r => r.recallAt10))),
    precisionAt5: roundMetric(macroAverage(rows.map(r => r.precisionAt5))),
    mrrAt10: roundMetric(macroAverage(rows.map(r => r.mrrAt10))),
    ndcgAt5: roundMetric(macroAverage(rows.map(r => r.ndcgAt5))),
    ndcgAt10: roundMetric(macroAverage(rows.map(r => r.ndcgAt10))),
  };
}

function summarizeAcrossCorpora(summaries: readonly QualityMetricSummary[]): QualityMetricSummary {
  const totalQueries = summaries.reduce((s, x) => s + x.queryCount, 0);
  const totalExcluded = summaries.reduce((s, x) => s + x.excludedQueryCount, 0);
  return {
    queryCount: totalQueries,
    excludedQueryCount: totalExcluded,
    recallAt1: roundMetric(macroAverage(summaries.map(x => x.recallAt1))),
    recallAt5: roundMetric(macroAverage(summaries.map(x => x.recallAt5))),
    recallAt10: roundMetric(macroAverage(summaries.map(x => x.recallAt10))),
    precisionAt5: roundMetric(macroAverage(summaries.map(x => x.precisionAt5))),
    mrrAt10: roundMetric(macroAverage(summaries.map(x => x.mrrAt10))),
    ndcgAt5: roundMetric(macroAverage(summaries.map(x => x.ndcgAt5))),
    ndcgAt10: roundMetric(macroAverage(summaries.map(x => x.ndcgAt10))),
  };
}

function normalizeLf(raw: string): string {
  return raw.replace(/\r\n/g, "\n");
}

export function computeCorpusHash(documents: readonly Document[]): string {
  const sorted = [...documents].sort((a, b) => a.id.localeCompare(b.id));
  const payload = sorted.map(d => `${d.id}\0${normalizeLf(d.content)}`).join("\n---\n");
  return hashContent(payload);
}

export function computeQrelsHash(queriesRaw: string, qrelsRaw: string): string {
  const normalized = `${normalizeLf(queriesRaw).trim()}\n===\n${normalizeLf(qrelsRaw).trim()}`;
  return hashContent(normalized);
}

export function buildCorpusFixture(
  id: string,
  documents: readonly Document[],
  queriesRaw: string,
  qrelsRaw: string,
): EvalCorpusFixture {
  const normalizedDocs: Document[] = documents
    .map(d => ({ ...d, content: normalizeLf(d.content) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const queries = parseQueriesTsv(queriesRaw);
  const queryIds = new Set(queries.map(q => q.id));
  const docIds = new Set(normalizedDocs.map(d => d.id));
  const qrels = parseQrelsTsv(qrelsRaw, queryIds, docIds);

  return {
    id,
    documents: normalizedDocs,
    queries,
    qrels,
    corpusHash: computeCorpusHash(normalizedDocs),
    qrelsHash: computeQrelsHash(queriesRaw, qrelsRaw),
  };
}

/**
 * Load frozen evaluation corpora from `fixtures/eval/`.
 * Note: uses dynamic `node:fs`/`node:path` imports (works in Node/Vitest; Vite
 * SSR scripts must load files in Node and pass `{ corpora }` via `buildCorpusFixture`).
 */
export async function loadDiskCorpora(rootDir = "fixtures/eval"): Promise<EvalCorpusFixture[]> {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join, extname } = await import("node:path");

  const entries = await readdir(rootDir, { withFileTypes: true });
  const corpusDirs = entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b));

  const corpora: EvalCorpusFixture[] = [];
  for (const corpusId of corpusDirs) {
    const corpusDir = join(rootDir, corpusId);
    const docsDir = join(corpusDir, "docs");
    const docFiles = (await readdir(docsDir))
      .filter(f => f.endsWith(".md"))
      .sort((a, b) => a.localeCompare(b));

    const documents: Document[] = [];
    for (const file of docFiles) {
      const id = file.slice(0, -extname(file).length);
      const raw = await readFile(join(docsDir, file), "utf8");
      documents.push({
        id,
        path: `${corpusId}/docs/${file}`,
        content: normalizeLf(raw),
      });
    }

    const queriesRaw = await readFile(join(corpusDir, "queries.tsv"), "utf8");
    const qrelsRaw = await readFile(join(corpusDir, "qrels.tsv"), "utf8");
    corpora.push(buildCorpusFixture(corpusId, documents, queriesRaw, qrelsRaw));
  }

  return corpora;
}

export async function runQualityEval(opts: RunQualityEvalOptions = {}): Promise<QualityEvalReport> {
  const corpora = opts.corpora ?? (await loadDiskCorpora(opts.rootDir));
  const configs = opts.configs ?? DEFAULT_QUALITY_CONFIGS;
  const [k1, k5, k10] = opts.ks ?? [1, 5, 10];
  const maxK = Math.max(k1, k5, k10);

  const corpusReports: CorpusQualityReport[] = [];
  const perConfigCorpusSummaries = new Map<string, QualityMetricSummary[]>();
  for (const cfg of configs) perConfigCorpusSummaries.set(cfg.id, []);

  for (const corpus of corpora) {
    const configResults: CorpusConfigResult[] = [];

    for (const cfg of configs) {
      const provider = cfg.createProvider();
      const reranker = cfg.createReranker?.();
      const pipeline = new RetrievalPipeline(provider, { topK: maxK, mode: cfg.mode }, reranker);
      await pipeline.ingest([...corpus.documents]);

      const rows: QueryScoreRow[] = [];
      let excludedQueryCount = 0;

      for (const query of corpus.queries) {
        const relevant = corpus.qrels.get(query.id) ?? new Map<string, number>();
        const hasPositive = [...relevant.values()].some(g => g > 0);
        if (!hasPositive) {
          excludedQueryCount++;
          continue;
        }

        const hits = await pipeline.search(query.question, maxK);
        const rankedDocIds = collapseChunksToDocIds(hits.map(h => h.chunk.documentId));

        rows.push({
          category: query.category,
          recallAt1: recallAtK(rankedDocIds, relevant, k1),
          recallAt5: recallAtK(rankedDocIds, relevant, k5),
          recallAt10: recallAtK(rankedDocIds, relevant, k10),
          precisionAt5: precisionAtK(rankedDocIds, relevant, k5),
          mrrAt10: mrr(rankedDocIds, relevant, k10),
          ndcgAt5: ndcgAtK(rankedDocIds, relevant, k5),
          ndcgAt10: ndcgAtK(rankedDocIds, relevant, k10),
        });
      }

      const overall = summarizeRows(rows, excludedQueryCount);
      perConfigCorpusSummaries.get(cfg.id)!.push(overall);

      const byCategory: Partial<Record<EvalQueryCategory, QualityMetricSummary>> = {};
      for (const cat of CATEGORIES) {
        const catRows = rows.filter(r => r.category === cat);
        if (catRows.length > 0) {
          byCategory[cat] = summarizeRows(catRows, 0);
        }
      }

      configResults.push({
        configId: cfg.id,
        providerId: provider.id,
        providerModel: provider.model,
        mode: cfg.mode,
        reranked: Boolean(reranker),
        overall,
        byCategory,
      });
    }

    corpusReports.push({
      corpusId: corpus.id,
      documentCount: corpus.documents.length,
      queryCount: corpus.queries.length,
      corpusHash: corpus.corpusHash,
      qrelsHash: corpus.qrelsHash,
      results: configResults,
    });
  }

  const macroOverall: Record<string, QualityMetricSummary> = {};
  for (const cfg of configs) {
    macroOverall[cfg.id] = summarizeAcrossCorpora(perConfigCorpusSummaries.get(cfg.id) ?? []);
  }

  return {
    schema: QUALITY_SCHEMA_ID,
    schemaVersion: QUALITY_SCHEMA_VERSION,
    judgmentProvenance: "maintainer-authored-provisional",
    honestyNotice:
      "Evaluated offline on frozen in-repo fixtures with maintainer-authored provisional relevance judgments. Scores compare internal AutoSD retrieval configurations only and must not be cited as external comparative benchmarks.",
    ...(opts.stamp ? { generatedAt: new Date().toISOString() } : {}),
    corpora: corpusReports,
    macroOverall,
  };
}

function fmt(n: number): string {
  return n.toFixed(4);
}

export function buildQualityMarkdown(report: QualityEvalReport): string {
  const lines: string[] = [
    "# AutoSD Retrieval Quality Report",
    "",
    `- Schema: \`${report.schema}\` v${report.schemaVersion}`,
    `- Judgment provenance: **${report.judgmentProvenance}**`,
    ...(report.generatedAt ? [`- Generated at: ${report.generatedAt}`] : []),
    "",
    `> ${report.honestyNotice}`,
    "",
    "## Macro Overall (unweighted across corpora)",
    "",
    "| Config | Queries | R@1 | R@5 | R@10 | P@5 | MRR@10 | nDCG@5 | nDCG@10 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const [configId, m] of Object.entries(report.macroOverall)) {
    lines.push(
      `| \`${configId}\` | ${m.queryCount} | ${fmt(m.recallAt1)} | ${fmt(m.recallAt5)} | ${fmt(m.recallAt10)} | ${fmt(m.precisionAt5)} | ${fmt(m.mrrAt10)} | ${fmt(m.ndcgAt5)} | ${fmt(m.ndcgAt10)} |`,
    );
  }

  for (const corpus of report.corpora) {
    lines.push(
      "",
      `## Corpus: \`${corpus.corpusId}\``,
      "",
      `- Documents: ${corpus.documentCount} · Queries: ${corpus.queryCount}`,
      `- Corpus hash: \`${corpus.corpusHash}\``,
      `- Qrels hash: \`${corpus.qrelsHash}\``,
      "",
      "| Config | Mode | Provider | R@1 | R@5 | R@10 | P@5 | MRR@10 | nDCG@5 | nDCG@10 |",
      "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    );

    for (const res of corpus.results) {
      const m = res.overall;
      lines.push(
        `| \`${res.configId}\` | ${res.mode}${res.reranked ? "+rerank" : ""} | ${res.providerId} | ${fmt(m.recallAt1)} | ${fmt(m.recallAt5)} | ${fmt(m.recallAt10)} | ${fmt(m.precisionAt5)} | ${fmt(m.mrrAt10)} | ${fmt(m.ndcgAt5)} | ${fmt(m.ndcgAt10)} |`,
      );
    }

    lines.push(
      "",
      `### Category breakdown (\`${corpus.corpusId}\` — nDCG@10 / R@5)`,
      "",
      "| Config | lexical | paraphrase | typo | multi-doc |",
      "| --- | --- | --- | --- | --- |",
    );

    for (const res of corpus.results) {
      const cell = (cat: EvalQueryCategory): string => {
        const c = res.byCategory[cat];
        return c ? `${fmt(c.ndcgAt10)} / ${fmt(c.recallAt5)}` : "n/a";
      };
      lines.push(
        `| \`${res.configId}\` | ${cell("lexical")} | ${cell("paraphrase")} | ${cell("typo")} | ${cell("multi-doc")} |`,
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}
