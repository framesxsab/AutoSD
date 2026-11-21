/**
 * Scale/latency benchmarking and adversarial/abstention evaluation harness.
 * Zero runtime dependencies, deterministic synthetic corpus generation, and
 * explicit separation between clean-benchmark quality and adversarial stress.
 */
import { RetrievalPipeline, type RetrievalMode } from "../pipeline.js";
import { LexicalHashEmbeddingProvider } from "../providers/LexicalHashEmbeddingProvider.js";
import { LexicalReranker } from "../reranker.js";
import type { Document } from "../types.js";
import { ResearchWorkflow } from "../../workflows/research.js";
import { collapseChunksToDocIds, mrr, recallAtK, roundMetric } from "./metrics.js";

export type LatencySummary = {
  readonly queryCount: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly meanMs: number;
  readonly maxMs: number;
};

export type ScaleConfigResult = {
  readonly configId: string;
  readonly mode: RetrievalMode;
  readonly reranked: boolean;
  readonly ingestMs: number;
  readonly chunkCount: number;
  readonly heapDeltaMb: number;
  readonly latency: LatencySummary;
  readonly top1HitRate: number;
};

export type ScaleBenchmarkReport = {
  readonly documentCount: number;
  readonly queryCount: number;
  readonly results: readonly ScaleConfigResult[];
};

export type ScaleBenchmarkOptions = {
  readonly docCount?: number;
  readonly paragraphsPerDoc?: number;
  readonly queryCount?: number;
};

export type AbstentionSummary = {
  readonly queryCount: number;
  readonly baselineFalseCitationRate: number;
  readonly guardedAbstentionRate: number;
  readonly guardedFalseCitationRate: number;
  readonly guardedMaxConfidence: number;
};

export type OcrNoiseSummary = {
  readonly queryCount: number;
  readonly recallAt5: number;
  readonly mrrAt10: number;
};

export type MultiHopSummary = {
  readonly queryCount: number;
  readonly dualDocRecallAt5: number;
  readonly singleDocRecallAt5: number;
};

export type AdversarialEvalReport = {
  readonly abstention: AbstentionSummary;
  readonly ocrNoise: OcrNoiseSummary;
  readonly multiHop: MultiHopSummary;
};

type DomainCluster = {
  readonly id: string;
  readonly keywords: readonly string[];
  readonly sentences: readonly string[];
};

const CLUSTERS: readonly DomainCluster[] = [
  {
    id: "braille-hw",
    keywords: ["piezoelectric", "braille", "actuator", "cell", "refreshable", "pins"],
    sentences: [
      "Piezoelectric ceramic bimorph actuators raise tactile braille pins across a 40-cell refreshable display.",
      "USB HID Usage Page 0x0041 carries output dot bitmasks and cursor-routing input reports at 60 Hz.",
      "Compact 20-cell portable displays trade line length for lower battery draw during mobile reading.",
    ],
  },
  {
    id: "wcag-a11y",
    keywords: ["wcag", "landmark", "contrast", "focus", "live-region", "aria"],
    sentences: [
      "WCAG 2.2 AA requires visible focus indicators, logical heading hierarchy, and minimum 24px pointer targets.",
      "Polite aria-live regions announce status updates without interrupting active screen-reader speech.",
      "Skip links and landmark roles let keyboard-only readers jump directly to primary content.",
    ],
  },
  {
    id: "retrieval-rrf",
    keywords: ["bm25", "vector", "rrf", "reranker", "chunking", "snapshot"],
    sentences: [
      "Reciprocal Rank Fusion combines BM25 lexical rankings with cosine vector similarity using k equals 60.",
      "Deterministic 800-character chunking with 120-character overlap preserves sentence boundaries across pages.",
      "SHA-256 hash-diffed snapshot indexing avoids recomputing embeddings for unchanged corpus documents.",
    ],
  },
  {
    id: "ueb-encoding",
    keywords: ["ueb", "contraction", "wordsign", "indicator", "grade", "unicode"],
    sentences: [
      "Unified English Braille uses dot 6 capital indicators and dots 3-4-5-6 numeric prefixes for digits.",
      "Grade 1 letter-mode indicators disambiguate letters a through j immediately following numeric digits.",
      "Grade 2 contractions compress frequent English wordsigns and strong groupsigns to fit narrower cells.",
    ],
  },
  {
    id: "plugin-arch",
    keywords: ["plugin", "hotswap", "registry", "container", "workflow", "isolation"],
    sentences: [
      "PluginHost dispatches named workflows while isolating activation and deactivation lifecycle hooks.",
      "Atomic dependency injection hot-swaps allow operators to replace providers without restarting.",
      "Error-isolated device broadcasts ensure a failing display adapter never blocks other subscribers.",
    ],
  },
  {
    id: "security-csp",
    keywords: ["sanitize", "xss", "csp", "redaction", "traversal", "secret"],
    sentences: [
      "Untrusted corpus text is always rendered via textContent so hostile markup never executes scripts.",
      "Path traversal guards reject relative parent segments before touching local snapshot directories.",
      "Diagnostics exports redact bearer tokens and API keys before serializing metadata reports.",
    ],
  },
];

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return roundMetric(sorted[idx]);
}

function summarizeLatencies(samples: readonly number[]): LatencySummary {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    queryCount: sorted.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    meanMs: sorted.length > 0 ? roundMetric(sum / sorted.length) : 0,
    maxMs: sorted.length > 0 ? roundMetric(sorted[sorted.length - 1]) : 0,
  };
}

function generateSyntheticCorpus(docCount: number, paragraphsPerDoc: number): Document[] {
  const docs: Document[] = [];
  for (let i = 0; i < docCount; i++) {
    const cluster = CLUSTERS[i % CLUSTERS.length];
    const parts: string[] = [];
    for (let p = 0; p < paragraphsPerDoc; p++) {
      const s0 = cluster.sentences[(i + p) % cluster.sentences.length];
      const s1 = cluster.sentences[(i + p + 1) % cluster.sentences.length];
      const tokenTag = `record_${cluster.id}_${i}_sec_${p}`;
      parts.push(
        `Section ${p + 1} (${tokenTag}): ${s0} ${s1} ` +
          `Additional deterministic filler text for cluster ${cluster.id} item ${i} paragraph ${p} ` +
          `ensuring realistic multi-chunk splitting across 800-character windows.`,
      );
    }
    docs.push({
      id: `scale-${cluster.id}-${i}`,
      path: `scale/${cluster.id}/doc-${i}.md`,
      content: parts.join("\n\n"),
    });
  }
  return docs;
}

export async function runScaleBenchmark(
  opts: ScaleBenchmarkOptions = {},
): Promise<ScaleBenchmarkReport> {
  const docCount = Math.max(12, Math.floor(opts.docCount ?? 150));
  const paragraphsPerDoc = Math.max(1, Math.floor(opts.paragraphsPerDoc ?? 4));
  const queryCount = Math.max(6, Math.floor(opts.queryCount ?? 30));

  const docs = generateSyntheticCorpus(docCount, paragraphsPerDoc);
  const queries = Array.from({ length: queryCount }, (_, i) => {
    const targetIdx = (i * 7) % docCount;
    const cluster = CLUSTERS[targetIdx % CLUSTERS.length];
    const kw0 = cluster.keywords[i % cluster.keywords.length];
    const kw1 = cluster.keywords[(i + 1) % cluster.keywords.length];
    return {
      text: `record_${cluster.id}_${targetIdx}_sec_0 ${kw0} ${kw1}`,
      expectedDocId: `scale-${cluster.id}-${targetIdx}`,
    };
  });

  const configs: readonly { id: string; mode: RetrievalMode; reranked: boolean }[] = [
    { id: "bm25", mode: "bm25", reranked: false },
    { id: "hybrid:lexical-hash", mode: "hybrid", reranked: false },
    { id: "hybrid:lexical-hash+rerank", mode: "hybrid", reranked: true },
  ];

  const results: ScaleConfigResult[] = [];
  for (const cfg of configs) {
    const provider = new LexicalHashEmbeddingProvider();
    const reranker = cfg.reranked ? new LexicalReranker() : undefined;
    const pipeline = new RetrievalPipeline(provider, { topK: 5, mode: cfg.mode }, reranker);

    const heapBefore = typeof process !== "undefined" ? process.memoryUsage().heapUsed : 0;
    const t0 = performance.now();
    await pipeline.ingest(docs);
    const ingestMs = roundMetric(performance.now() - t0);
    const heapAfter = typeof process !== "undefined" ? process.memoryUsage().heapUsed : 0;
    const heapDeltaMb = roundMetric(Math.max(0, heapAfter - heapBefore) / (1024 * 1024));

    const latencies: number[] = [];
    let top1Hits = 0;
    for (const q of queries) {
      const qt0 = performance.now();
      const hits = await pipeline.search(q.text, { topK: 5, mode: cfg.mode });
      latencies.push(performance.now() - qt0);
      if (hits[0]?.chunk.documentId === q.expectedDocId) {
        top1Hits += 1;
      }
    }

    results.push({
      configId: cfg.id,
      mode: cfg.mode,
      reranked: cfg.reranked,
      ingestMs,
      chunkCount: pipeline.getChunks().length,
      heapDeltaMb,
      latency: summarizeLatencies(latencies),
      top1HitRate: roundMetric(top1Hits / queries.length),
    });
  }

  return {
    documentCount: docCount,
    queryCount,
    results,
  };
}

export async function runAdversarialEval(): Promise<AdversarialEvalReport> {
  // 1. Unanswerable / Out-of-Domain Abstention Suite
  const domainDocs: Document[] = CLUSTERS.map(c => ({
    id: `adv-${c.id}`,
    path: `adv/${c.id}.md`,
    content: c.sentences.join(" "),
  }));

  const unanswerableQueries = [
    "sourdough starter hydration percentage fermentation temperature",
    "Grand Prix motorsport pit stop slick tire compound strategy",
    "ancient Roman aqueduct pozzolanic volcanic concrete recipe",
    "quantum chromodynamics gluon color confinement lattice",
    "baroque harpsichord basso continuo figured bass realization",
    "photosynthesis rubisco carbon fixation calvin cycle",
    "alpine mountaineering crampon glacier crevasse rescue",
    "espresso extraction pressure bar grind size distribution",
  ];

  const baselineWf = new ResearchWorkflow({
    provider: new LexicalHashEmbeddingProvider(),
    reranker: true,
    abstainOnLowEvidence: false,
  });
  await baselineWf.ingest(domainDocs);

  const guardedWf = new ResearchWorkflow({
    provider: new LexicalHashEmbeddingProvider(),
    reranker: true,
    abstainOnLowEvidence: true,
    minVectorScore: 0.45,
  });
  await guardedWf.ingest(domainDocs);

  let baselineFalseCitations = 0;
  let guardedAbstentions = 0;
  let guardedFalseCitations = 0;
  let guardedMaxConfidence = 0;

  for (let i = 0; i < unanswerableQueries.length; i++) {
    const q = unanswerableQueries[i];
    const baseRes = await baselineWf.run({ id: `u-base-${i}`, question: q });
    if (baseRes.citations.length > 0) baselineFalseCitations += 1;

    const guardRes = await guardedWf.run({ id: `u-guard-${i}`, question: q });
    if (guardRes.abstained) guardedAbstentions += 1;
    if (guardRes.citations.length > 0) guardedFalseCitations += 1;
    if (guardRes.confidence > guardedMaxConfidence) guardedMaxConfidence = guardRes.confidence;
  }

  // 2. OCR-Corrupted / Noisy Document Suite
  const ocrDocs: Document[] = [
    {
      id: "ocr-braille",
      path: "ocr/braille.md",
      content:
        "Refre5hab1e brai11e disp1ays use piezo- electric actuators to raise 6-dot tactile cells on 40-ce11 hardware.",
    },
    {
      id: "ocr-wcag",
      path: "ocr/wcag.md",
      content:
        "WCAG 2.2 AA focus order, contrast rati0 4.5:1, and po1ite aria-1ive status regions support screen-reader navigation.",
    },
    {
      id: "ocr-rrf",
      path: "ocr/rrf.md",
      content:
        "Reciproca1 Rank Fusi0n (RRF k=60) merges BM25 lexica1 search and vector cosine similarity with SHA-256 snapshots.",
    },
    {
      id: "ocr-ueb",
      path: "ocr/ueb.md",
      content:
        "Unified Eng1ish Brai11e (UEB) Grade 2 contractions shorten frequent wordsigns and strong groupsigns for narrow displays.",
    },
    {
      id: "ocr-hid",
      path: "ocr/hid.md",
      content:
        "USB HID Usage Page 0x0041 carries pan-left, pan-right, cursor-routing cells, and Perkins chord input reports.",
    },
    {
      id: "ocr-sec",
      path: "ocr/sec.md",
      content:
        "Sanitizing untrusted corpus markup via textContent prevents XSS execution and redacts API secrets in diagnostics.",
    },
  ];
  const ocrQueries: readonly { question: string; expectedDoc: string }[] = [
    { question: "piezo electric actuators tactile cells hardware", expectedDoc: "ocr-braille" },
    { question: "WCAG 2.2 focus order status regions screen reader", expectedDoc: "ocr-wcag" },
    { question: "RRF merges BM25 vector cosine similarity SHA-256", expectedDoc: "ocr-rrf" },
    { question: "UEB Grade 2 contractions wordsigns strong groupsigns", expectedDoc: "ocr-ueb" },
    { question: "USB HID Usage Page 0x0041 cursor routing Perkins chord", expectedDoc: "ocr-hid" },
    { question: "textContent prevents XSS execution redacts API secrets", expectedDoc: "ocr-sec" },
  ];

  const ocrPipe = new RetrievalPipeline(
    new LexicalHashEmbeddingProvider(),
    { topK: 10, mode: "hybrid" },
    new LexicalReranker(),
  );
  await ocrPipe.ingest(ocrDocs);

  let ocrRecallSum = 0;
  let ocrMrrSum = 0;
  for (const q of ocrQueries) {
    const hits = await ocrPipe.search(q.question, { topK: 10 });
    const rankedDocs = collapseChunksToDocIds(hits.map(h => h.chunk.documentId));
    const rel = new Map([[q.expectedDoc, 2]]);
    ocrRecallSum += recallAtK(rankedDocs, rel, 5);
    ocrMrrSum += mrr(rankedDocs, rel, 10);
  }

  // 3. Multi-Hop Synthesis Suite (each query requires 2 distinct evidence documents in top-5)
  const multiHopQueries: readonly { question: string; requiredDocs: readonly [string, string] }[] =
    [
      {
        question: "piezoelectric braille pins and WCAG focus indicators",
        requiredDocs: ["adv-braille-hw", "adv-wcag-a11y"],
      },
      {
        question: "Reciprocal Rank Fusion BM25 and SHA-256 path traversal security",
        requiredDocs: ["adv-retrieval-rrf", "adv-security-csp"],
      },
      {
        question: "Unified English Braille contractions and 20-cell portable displays",
        requiredDocs: ["adv-ueb-encoding", "adv-braille-hw"],
      },
      {
        question: "PluginHost lifecycle hot-swap and aria-live screen-reader announcements",
        requiredDocs: ["adv-plugin-arch", "adv-wcag-a11y"],
      },
      {
        question: "textContent XSS sanitization and deterministic 800-character chunking",
        requiredDocs: ["adv-security-csp", "adv-retrieval-rrf"],
      },
      {
        question: "Grade 1 letter-mode indicators and error-isolated device broadcasts",
        requiredDocs: ["adv-ueb-encoding", "adv-plugin-arch"],
      },
    ];

  const mhPipe = new RetrievalPipeline(
    new LexicalHashEmbeddingProvider(),
    { topK: 5, mode: "hybrid" },
    new LexicalReranker(),
  );
  await mhPipe.ingest(domainDocs);

  let dualHits = 0;
  let singleHits = 0;
  for (const q of multiHopQueries) {
    const hits = await mhPipe.search(q.question, { topK: 5 });
    const top5 = new Set(collapseChunksToDocIds(hits.map(h => h.chunk.documentId)).slice(0, 5));
    const hasA = top5.has(q.requiredDocs[0]);
    const hasB = top5.has(q.requiredDocs[1]);
    if (hasA && hasB) dualHits += 1;
    if (hasA || hasB) singleHits += 1;
  }

  return {
    abstention: {
      queryCount: unanswerableQueries.length,
      baselineFalseCitationRate: roundMetric(baselineFalseCitations / unanswerableQueries.length),
      guardedAbstentionRate: roundMetric(guardedAbstentions / unanswerableQueries.length),
      guardedFalseCitationRate: roundMetric(guardedFalseCitations / unanswerableQueries.length),
      guardedMaxConfidence: roundMetric(guardedMaxConfidence),
    },
    ocrNoise: {
      queryCount: ocrQueries.length,
      recallAt5: roundMetric(ocrRecallSum / ocrQueries.length),
      mrrAt10: roundMetric(ocrMrrSum / ocrQueries.length),
    },
    multiHop: {
      queryCount: multiHopQueries.length,
      dualDocRecallAt5: roundMetric(dualHits / multiHopQueries.length),
      singleDocRecallAt5: roundMetric(singleHits / multiHopQueries.length),
    },
  };
}

export function buildStressMarkdown(
  scale: ScaleBenchmarkReport,
  adversarial: AdversarialEvalReport,
): string {
  const lines: string[] = [
    "# AutoSD Scale & Adversarial Retrieval Report",
    "",
    `## 1. Scale & Latency Benchmark (${scale.documentCount} docs · ${scale.queryCount} queries)`,
    "",
    "| Config | Chunks | Ingest (ms) | Heap Δ (MB) | p50 (ms) | p95 (ms) | p99 (ms) | Top-1 Hit |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const r of scale.results) {
    lines.push(
      `| ${r.configId} | ${r.chunkCount} | ${r.ingestMs.toFixed(1)} | ${r.heapDeltaMb.toFixed(2)} | ${r.latency.p50Ms.toFixed(2)} | ${r.latency.p95Ms.toFixed(2)} | ${r.latency.p99Ms.toFixed(2)} | ${(r.top1HitRate * 100).toFixed(1)}% |`,
    );
  }
  lines.push(
    "",
    "## 2. Adversarial & Abstention Suite",
    "",
    `- **Unanswerable Abstention (${adversarial.abstention.queryCount} queries):** baseline false-citation rate = ${(adversarial.abstention.baselineFalseCitationRate * 100).toFixed(1)}%; with \`abstainOnLowEvidence: true\`, abstention rate = **${(adversarial.abstention.guardedAbstentionRate * 100).toFixed(1)}%**, false-citation rate = **${(adversarial.abstention.guardedFalseCitationRate * 100).toFixed(1)}%**, max confidence = ${adversarial.abstention.guardedMaxConfidence}.`,
    `- **OCR-Corrupted Text (${adversarial.ocrNoise.queryCount} queries):** R@5 = **${adversarial.ocrNoise.recallAt5.toFixed(4)}**, MRR@10 = **${adversarial.ocrNoise.mrrAt10.toFixed(4)}**.`,
    `- **Multi-Hop Dual-Doc Recall (${adversarial.multiHop.queryCount} queries):** dual-doc R@5 = **${(adversarial.multiHop.dualDocRecallAt5 * 100).toFixed(1)}%**, single-doc R@5 = ${(adversarial.multiHop.singleDocRecallAt5 * 100).toFixed(1)}%.`,
    "",
  );
  return lines.join("\n");
}
