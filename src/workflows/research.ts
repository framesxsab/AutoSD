/**
 * ResearchWorkflow — upgraded with hybrid retrieval.
 * Additive: preserves old run({id,question,corpusIds}) signature.
 * New: ingest, searchable corpus, citations, confidence, reproducible session, export.
 */
import { RetrievalPipeline, type RetrievalMode } from "../retrieval/pipeline.js";
import { SnapshotIndex, hashDocument } from "../retrieval/snapshot.js";
import { MockEmbeddingProvider } from "../retrieval/providers/MockEmbeddingProvider.js";
import { LexicalReranker, type Reranker } from "../retrieval/reranker.js";
import type { EmbeddingProvider } from "../retrieval/embedder.js";
import type { Chunk, Document, IndexManifest, RetrievalResult } from "../retrieval/types.js";
import { assertSafePath, safeJsonParse } from "../utils/sanitize.js";
import type { DIContainer } from "../core/DIContainer.js";
import { container as globalContainer } from "../core/DIContainer.js";

export type AnswerMode = "extractive" | "template";

export type ResearchQuery = {
  id: string;
  question: string;
  corpusIds?: string[];
  mode?: RetrievalMode;
  answerMode?: AnswerMode;
};

export type PersistedWorkflowState = {
  readonly documents: Document[];
  readonly snapshot?: {
    version: string;
    documentHashes: Record<string, string>;
    chunks: Chunk[];
    manifests: IndexManifest[];
  };
  readonly sessions: ResearchSession[];
};

function reconstructDocumentContent(chunks: readonly Chunk[]): string {
  const sorted = [...chunks].sort((a, b) => a.start - b.start);
  let text = "";
  for (const c of sorted) {
    if (c.start <= text.length) {
      const overlap = text.length - c.start;
      if (overlap < c.content.length) {
        text += c.content.slice(overlap);
      }
    } else {
      if (text.length > 0) text += "\n";
      text += c.content;
    }
  }
  return text;
}

/**
 * Read a UTF-8 file that may legitimately not exist. Returns null only for
 * ENOENT (or the empty browser fs alias); any other I/O failure is rethrown.
 */
async function readOptionalFile(path: string): Promise<string | null> {
  const safePath = assertSafePath(path);
  const fs = await import("node:fs/promises");
  if (typeof fs.readFile !== "function") return null;
  try {
    return await fs.readFile(safePath, "utf8");
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === "ENOENT") return null;
    throw err;
  }
}

const EXTRACTIVE_STOP_WORDS = new Set([
  "about",
  "after",
  "all",
  "also",
  "and",
  "any",
  "are",
  "because",
  "been",
  "before",
  "between",
  "both",
  "but",
  "can",
  "could",
  "did",
  "does",
  "doing",
  "down",
  "during",
  "each",
  "for",
  "from",
  "further",
  "had",
  "has",
  "have",
  "having",
  "her",
  "here",
  "him",
  "his",
  "how",
  "into",
  "its",
  "just",
  "more",
  "most",
  "much",
  "not",
  "now",
  "off",
  "once",
  "only",
  "other",
  "our",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "too",
  "under",
  "until",
  "very",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

function stemToken(token: string): string {
  if (token.length >= 6 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length >= 5 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length >= 5 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length >= 4 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function buildExtractiveAnswer(
  question: string,
  citations: readonly ResearchCitation[],
  topK: readonly RetrievalResult[],
): string {
  const rawTokens = question
    .toLowerCase()
    .split(/\W+/)
    .filter(t => t.length >= 3);
  const contentTokens = rawTokens.filter(t => !EXTRACTIVE_STOP_WORDS.has(t));
  const activeTokens = contentTokens.length > 0 ? contentTokens : rawTokens;
  const qStems = new Set(activeTokens.map(stemToken));

  const scored: { sentence: string; chunkId: string; score: number; order: number }[] = [];
  const seen = new Set<string>();
  let order = 0;

  topK.forEach((r, idx) => {
    const rawSentences = r.chunk.content
      .split(/(?<=[.!?])\s+|\n+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    rawSentences.forEach((sentence, sentIdx) => {
      const norm = sentence.toLowerCase();
      if (seen.has(norm)) return;
      seen.add(norm);
      const words = norm.split(/\W+/).filter(Boolean);
      const matchedStems = new Set<string>();
      let totalHits = 0;
      for (const w of words) {
        if (EXTRACTIVE_STOP_WORDS.has(w) && contentTokens.length > 0) continue;
        const st = stemToken(w);
        if (qStems.has(st)) {
          matchedStems.add(st);
          totalHits++;
        }
      }
      const distinctCoverage = qStems.size > 0 ? matchedStems.size / qStems.size : 0;
      const densityBonus = Math.min(0.45, totalHits * 0.1);
      const rankScore = 1 / (idx + 1);
      const leadBonus = 0.12 / (sentIdx + 1);
      scored.push({
        sentence,
        chunkId: r.chunk.id,
        score: distinctCoverage * 2.5 + densityBonus + rankScore + leadBonus,
        order: order++,
      });
    });
  });

  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  const picked: string[] = [];
  let charBudget = 0;
  for (const item of scored) {
    if (picked.length >= 2) break;
    if (picked.length > 0 && charBudget + item.sentence.length > 320) break;
    picked.push(`${item.sentence} [${item.chunkId}]`);
    charBudget += item.sentence.length;
  }

  const cited = [...new Set(citations.map(c => c.documentId))].join(", ");
  if (picked.length === 0) {
    return `Answer to "${question}" grounded in ${cited} (${citations.length} sources)`;
  }
  return `${picked.join(" ")} (Grounded in ${cited} · ${citations.length} sources)`;
}

export type ResearchCitation = {
  source: string;
  chunkId: string;
  documentId: string;
  content: string;
  score: number;
};

export type ResearchResult = {
  queryId: string;
  answer: string;
  citations: ResearchCitation[];
  confidence: number;
};

export type ResearchSession = {
  readonly id: string;
  readonly query: ResearchQuery;
  readonly results: ResearchResult;
  readonly manifest: { version: string; snapshotHash: string; chunkCount: number };
  readonly topK: RetrievalSessionResult[];
  readonly createdAt: string;
};

export type RetrievalSessionResult = {
  chunkId: string;
  documentId: string;
  score: number;
  source: string;
};

export const EMBEDDING_TOKEN = "embedding:provider";
export const MAX_SESSIONS = 100;

export function isValidRestoredSession(s: unknown): s is ResearchSession {
  if (!s || typeof s !== "object") return false;
  const rec = s as Record<string, unknown>;
  if (typeof rec.id !== "string" || typeof rec.createdAt !== "string") return false;
  const q = rec.query as Record<string, unknown> | undefined;
  const r = rec.results as Record<string, unknown> | undefined;
  if (!q || typeof q !== "object" || typeof q.question !== "string") return false;
  if (!r || typeof r !== "object" || !Array.isArray(r.citations)) return false;
  return r.citations.every(
    (c: unknown) =>
      Boolean(c) &&
      typeof c === "object" &&
      typeof (c as ResearchCitation).chunkId === "string" &&
      typeof (c as ResearchCitation).documentId === "string" &&
      typeof (c as ResearchCitation).content === "string" &&
      typeof (c as ResearchCitation).score === "number",
  );
}

/**
 * v0.9 additive: structured error event surfaced by runSafe()/retryLastQuery().
 * `error` is the raw thrown value — UI layers MUST sanitize it (e.g.
 * sanitizeError() from app/logger) before displaying; never render it raw.
 */
export type ResearchErrorEvent = {
  scope: "research";
  operation: "run" | "reindex";
  error: unknown;
};

export class ResearchWorkflow {
  private pipeline: RetrievalPipeline;
  private provider: EmbeddingProvider;
  private snapshot = new SnapshotIndex();
  private di: DIContainer;
  private history: ResearchSession[] = [];
  private documents: Map<string, Document> = new Map();
  private errorListeners = new Set<(e: ResearchErrorEvent) => void>();
  private lastErrorEvent: ResearchErrorEvent | null = null;
  private lastQuery: ResearchQuery | null = null;
  private topK: number;
  private mode: RetrievalMode;
  private reranker?: Reranker;
  private answerMode: AnswerMode;
  /**
   * Tail of the serialized mutation queue. Every corpus mutation (ingest,
   * remove, provider re-index, restore) runs strictly after the previous one,
   * so snapshot/pipeline state can never interleave across awaits.
   */
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(opts?: {
    provider?: EmbeddingProvider;
    pipeline?: RetrievalPipeline;
    di?: DIContainer;
    topK?: number;
    mode?: RetrievalMode;
    reranker?: Reranker | boolean;
    answerMode?: AnswerMode;
  }) {
    this.di = opts?.di ?? globalContainer;
    this.topK = opts?.topK ?? 5;
    this.mode = opts?.mode ?? "hybrid";
    this.answerMode = opts?.answerMode ?? "extractive";
    // Resolve provider via DI like DeviceManager does, fallback to Mock
    let provider: EmbeddingProvider;
    if (opts?.provider) provider = opts.provider;
    else if (this.di.has(EMBEDDING_TOKEN))
      provider = this.di.resolve<EmbeddingProvider>(EMBEDDING_TOKEN);
    else provider = new MockEmbeddingProvider();
    this.provider = provider;
    this.reranker =
      opts?.reranker === true
        ? new LexicalReranker()
        : opts?.reranker === false
          ? undefined
          : opts?.reranker;
    this.pipeline =
      opts?.pipeline ??
      new RetrievalPipeline(provider, { topK: this.topK, mode: this.mode }, this.reranker);
  }

  getProvider(): EmbeddingProvider {
    return this.provider;
  }

  getRetrievalMode(): RetrievalMode {
    return typeof this.pipeline.getMode === "function" ? this.pipeline.getMode() : this.mode;
  }

  setRetrievalMode(mode: RetrievalMode): void {
    this.mode = mode;
    if (typeof this.pipeline.setMode === "function") {
      this.pipeline.setMode(mode);
    }
  }

  isRerankingEnabled(): boolean {
    const r =
      typeof this.pipeline.getReranker === "function" ? this.pipeline.getReranker() : this.reranker;
    return r !== undefined;
  }

  setReranker(reranker?: Reranker | boolean): void {
    this.reranker =
      reranker === true ? new LexicalReranker() : reranker === false ? undefined : reranker;
    if (typeof this.pipeline.setReranker === "function") {
      this.pipeline.setReranker(this.reranker);
    }
  }

  /** DI hot-swap for embedding provider — mirrors DeviceManager pattern. */
  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.provider = provider;
    const mode = this.getRetrievalMode();
    const reranker =
      typeof this.pipeline.getReranker === "function" ? this.pipeline.getReranker() : this.reranker;
    const pipeline = new RetrievalPipeline(provider, { topK: this.topK, mode }, reranker);
    this.pipeline = pipeline;
    // Re-embed whatever the corpus contains once earlier mutations settle.
    this.enqueue(async () => {
      const docs = [...this.documents.values()];
      if (docs.length > 0 && this.pipeline === pipeline) await pipeline.ingest(docs);
    }).catch((error: unknown) => {
      this.emitError({ scope: "research", operation: "reindex", error });
    });
  }

  /** Ingest documents — incremental, never re-embeds unchanged. */
  ingest(
    docs: Document[],
  ): Promise<{ added: number; removed: number; chunkCount: number; manifestVersion: string }> {
    return this.enqueue(async () => {
      for (const d of docs) this.documents.set(d.id, d);
      const allDocs = [...this.documents.values()];
      const result = await this.snapshot.index(allDocs, {
        embeddingModel: this.provider.model,
      });
      // Sync pipeline incrementally: remove deleted/stale, ingest newly added/modified docs
      for (const r of result.removed) this.pipeline.removeDocument(r.documentId);
      const reindexedIds = new Set(result.added.map(c => c.documentId));
      const toIngest = allDocs.filter(d => reindexedIds.has(d.id));
      if (toIngest.length > 0) await this.pipeline.ingest(toIngest);
      return {
        added: result.added.length,
        removed: result.removed.length,
        chunkCount: this.snapshot.getChunks().length,
        manifestVersion: result.manifest.version,
      };
    });
  }

  removeDocument(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      if (!this.documents.has(id)) return false;
      this.documents.delete(id);
      this.pipeline.removeDocument(id);
      await this.snapshot.index([...this.documents.values()], {
        embeddingModel: this.provider.model,
      });
      return true;
    });
  }

  /** Resolves once every mutation queued so far has settled (success or failure). */
  whenIdle(): Promise<void> {
    return this.mutationTail;
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(op);
    // The tail only tracks ordering; the failure itself still rejects `result`
    // for the caller, so later mutations are not blocked by an earlier error.
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private emitError(event: ResearchErrorEvent): void {
    this.lastErrorEvent = event;
    for (const fn of this.errorListeners) {
      try {
        fn(event);
      } catch (listenerError) {
        console.error("ResearchWorkflow: error listener threw", listenerError);
      }
    }
  }

  getDocument(id: string): Document | undefined {
    return this.documents.get(id);
  }

  getManifest(): ReturnType<SnapshotIndex["getManifest"]> {
    return this.snapshot.getManifest();
  }

  listDocuments(): Document[] {
    return [...this.documents.values()];
  }

  getSnapshotHash(): string {
    return this.snapshot.snapshotHash();
  }

  async run(query: ResearchQuery): Promise<ResearchResult> {
    // Reads never interleave with a half-applied mutation.
    await this.mutationTail;
    const topK = await this.pipeline.search(query.question, {
      topK: this.topK,
      documentIds: query.corpusIds,
      mode: query.mode,
    });
    let result: ResearchResult;

    if (topK.length === 0 && this.documents.size === 0) {
      // Preserve backward compat: deterministic stub when corpus empty
      result = {
        queryId: query.id,
        answer: `Answer to "${query.question}" (no indexed corpus)`,
        citations: (query.corpusIds ?? ["corpus-1"]).map(c => ({
          source: c,
          chunkId: `${c}#1`,
          documentId: c,
          content: "",
          score: 0,
        })),
        confidence: 0.1,
      };
    } else if (topK.length === 0) {
      result = {
        queryId: query.id,
        answer: `No matching passages found in indexed corpus for "${query.question}".`,
        citations: [],
        confidence: 0.1,
      };
    } else {
      const citations: ResearchCitation[] = topK.map(r => ({
        source: r.chunk.documentId,
        chunkId: r.chunk.id,
        documentId: r.chunk.documentId,
        content: r.chunk.content.slice(0, 200),
        score: r.score,
      }));
      const maxScore = Math.max(...topK.map(r => r.score), 0);
      const confidence = Math.min(
        0.95,
        Math.max(0.15, maxScore > 1 ? 0.7 + maxScore / 10 : maxScore),
      );
      const cited = citations.map(c => c.documentId).join(", ");
      const mode = query.answerMode ?? this.answerMode;
      const answer =
        mode === "template"
          ? `Answer to "${query.question}" grounded in ${cited} (${citations.length} sources)`
          : buildExtractiveAnswer(query.question, citations, topK);
      result = {
        queryId: query.id,
        answer,
        citations,
        confidence,
      };
    }

    const session: ResearchSession = {
      id: `sess-${Date.now()}-${query.id}-${Math.random().toString(36).slice(2, 7)}`,
      query,
      results: result,
      manifest: {
        version: this.snapshot.getVersion(),
        snapshotHash: this.getSnapshotHash(),
        chunkCount: this.snapshot.getChunks().length,
      },
      topK: topK.map(r => ({
        chunkId: r.chunk.id,
        documentId: r.chunk.documentId,
        score: r.score,
        source: r.source,
      })),
      createdAt: new Date().toISOString(),
    };
    this.history.push(session);
    if (this.history.length > MAX_SESSIONS) {
      this.history.splice(0, this.history.length - MAX_SESSIONS);
    }
    this.history.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return result;
  }

  list(): ResearchResult[] {
    return this.history.map(s => s.results);
  }

  listSessions(): ResearchSession[] {
    return [...this.history];
  }

  getSession(id: string): ResearchSession | undefined {
    return this.history.find(s => s.id === id);
  }

  exportSession(id: string): string {
    const sess = this.getSession(id);
    if (!sess) throw new Error(`ResearchWorkflow: session "${id}" not found`);
    return JSON.stringify(sess, null, 2);
  }

  exportLastSession(): string {
    if (this.history.length === 0) throw new Error("ResearchWorkflow: no sessions");
    return this.exportSession(this.history[this.history.length - 1].id);
  }

  clear(): void {
    this.history = [];
    this.documents.clear();
    this.snapshot.clear();
    this.pipeline.clear();
  }

  toPersistedState(): PersistedWorkflowState {
    return {
      documents: this.listDocuments(),
      snapshot: this.snapshot.toPersistedState(),
      sessions: this.listSessions(),
    };
  }

  fromPersistedState(state: PersistedWorkflowState): Promise<void> {
    return this.enqueue(async () => {
      this.clear();
      if (state.snapshot && state.snapshot.manifests && state.snapshot.documentHashes) {
        this.snapshot.fromPersistedState(state.snapshot);
      }
      for (const d of state.documents ?? []) {
        if (d && typeof d.id === "string" && typeof d.content === "string") {
          this.documents.set(d.id, d);
        }
      }
      if (this.documents.size === 0 && this.snapshot.getChunks().length > 0) {
        this.reconstructDocumentsFromSnapshot();
      } else if (this.documents.size > 0 && this.snapshot.getChunks().length === 0) {
        await this.snapshot.index([...this.documents.values()], {
          embeddingModel: this.provider.model,
        });
      }
      const docs = [...this.documents.values()];
      if (docs.length > 0) await this.pipeline.ingest(docs);
      if (Array.isArray(state.sessions)) {
        const valid = state.sessions.filter(isValidRestoredSession);
        valid.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        if (valid.length > MAX_SESSIONS) valid.splice(0, valid.length - MAX_SESSIONS);
        this.history = valid;
      }
    });
  }

  private reconstructDocumentsFromSnapshot(): void {
    const byDoc = new Map<string, Chunk[]>();
    for (const c of this.snapshot.getChunks()) {
      const arr = byDoc.get(c.documentId) ?? [];
      arr.push(c);
      byDoc.set(c.documentId, arr);
    }
    const manifestEntries = this.snapshot.getManifest()?.documents ?? [];
    const manifestDocs = new Map(manifestEntries.map(d => [d.id, d.path]));
    for (const [docId, chunks] of byDoc) {
      this.documents.set(docId, {
        id: docId,
        content: reconstructDocumentContent(chunks),
        path: manifestDocs.get(docId),
      });
    }
    // chunkDocument() yields zero chunks only for empty content, so such
    // documents exist solely in the manifest — restore them instead of dropping them.
    for (const entry of manifestEntries) {
      if (!this.documents.has(entry.id) && entry.chunkIds.length === 0) {
        this.documents.set(entry.id, { id: entry.id, content: "", path: entry.path });
      }
    }
  }

  async saveToDisk(dir = "corpus"): Promise<void> {
    const safeDir = assertSafePath(dir).replace(/\/$/, "");
    const indexPath = assertSafePath(`${safeDir}/index.json`);
    await this.snapshot.saveToFile(indexPath);
    const fs = await import("node:fs/promises");
    if (typeof fs.writeFile !== "function") return; // browser build: no filesystem
    const { dirname } = await import("node:path");
    const writeAtomic = async (target: string, content: string): Promise<void> => {
      await fs.mkdir(dirname(target), { recursive: true });
      const tmp = `${target}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
      await fs.writeFile(tmp, content, "utf8");
      await fs.rename(tmp, target);
    };
    // Full document text: chunk reconstruction cannot recover text inside
    // skipped whitespace-only spans, so restores prefer this exact copy.
    await writeAtomic(
      assertSafePath(`${safeDir}/documents.json`),
      JSON.stringify(this.listDocuments(), null, 2),
    );
    await writeAtomic(
      assertSafePath(`${safeDir}/sessions.json`),
      JSON.stringify(this.history, null, 2),
    );
  }

  async loadFromDisk(dir = "corpus"): Promise<boolean> {
    let safeDir: string;
    try {
      safeDir = assertSafePath(dir).replace(/\/$/, "");
    } catch {
      return false; // invalid path → documented "nothing loaded" result
    }
    return this.enqueue(async () => {
      const indexPath = `${safeDir}/index.json`;
      const ok = await this.snapshot.loadFromFile(indexPath);
      if (!ok) return false;
      this.documents.clear();
      this.reconstructDocumentsFromSnapshot();
      await this.applyExactDocumentsFromDisk(safeDir);
      this.pipeline.clear();
      const docs = [...this.documents.values()];
      if (docs.length > 0) await this.pipeline.ingest(docs);
      const rawSessions = await readOptionalFile(`${safeDir}/sessions.json`);
      const parsed =
        rawSessions === null ? null : safeJsonParse<unknown[]>(rawSessions, Array.isArray);
      if (parsed) {
        const valid = parsed.filter(isValidRestoredSession);
        valid.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        if (valid.length > MAX_SESSIONS) valid.splice(0, valid.length - MAX_SESSIONS);
        this.history = valid;
      }
      return true;
    });
  }

  /**
   * Replace chunk-reconstructed documents with exact copies from documents.json,
   * but only where the copy's content hash matches the loaded index — a stale or
   * tampered documents.json can never diverge from what was actually indexed.
   */
  private async applyExactDocumentsFromDisk(safeDir: string): Promise<void> {
    const raw = await readOptionalFile(`${safeDir}/documents.json`);
    if (raw === null) return; // older corpus dirs have no documents.json
    const parsed = safeJsonParse<unknown[]>(raw, Array.isArray);
    if (!parsed) return;
    const indexedHashes = this.snapshot.toPersistedState().documentHashes;
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const d = item as Document;
      if (typeof d.id !== "string" || typeof d.content !== "string") continue;
      if (!Object.prototype.hasOwnProperty.call(indexedHashes, d.id)) continue;
      if (indexedHashes[d.id] !== hashDocument(d)) continue;
      this.documents.set(d.id, {
        id: d.id,
        content: d.content,
        path: typeof d.path === "string" ? d.path : this.documents.get(d.id)?.path,
        ...(d.metadata && typeof d.metadata === "object" ? { metadata: d.metadata } : {}),
      });
    }
  }

  deleteSession(id: string): boolean {
    const idx = this.history.findIndex(s => s.id === id);
    if (idx === -1) return false;
    this.history.splice(idx, 1);
    return true;
  }

  // v0.9 additive: error surfacing & recovery (no existing API changed)

  /** Subscribe to errors from runSafe(); returns an unsubscribe function. */
  onError(fn: (e: ResearchErrorEvent) => void): () => void {
    this.errorListeners.add(fn);
    return () => {
      this.errorListeners.delete(fn);
    };
  }

  getLastError(): ResearchErrorEvent | null {
    return this.lastErrorEvent;
  }

  clearError(): void {
    this.lastErrorEvent = null;
  }

  /**
   * Non-throwing variant of run(): resolves null on failure after notifying
   * onError listeners. UI layers turn the failure into an ErrorStateView whose
   * retry handler calls retryLastQuery().
   */
  async runSafe(query: ResearchQuery): Promise<ResearchResult | null> {
    this.lastQuery = query;
    try {
      return await this.run(query);
    } catch (error) {
      this.emitError({ scope: "research", operation: "run", error });
      return null;
    }
  }

  hasRecoverableQuery(): boolean {
    return this.lastQuery !== null;
  }

  /** Recovery path: re-invokes the last attempted query through runSafe(). */
  async retryLastQuery(): Promise<ResearchResult | null> {
    if (!this.lastQuery) return null;
    return this.runSafe(this.lastQuery);
  }
}
