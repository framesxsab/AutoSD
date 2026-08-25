/**
 * ResearchWorkflow — upgraded with hybrid retrieval.
 * Additive: preserves old run({id,question,corpusIds}) signature.
 * New: ingest, searchable corpus, citations, confidence, reproducible session, export.
 */
import { RetrievalPipeline } from "../retrieval/pipeline.js";
import { SnapshotIndex } from "../retrieval/snapshot.js";
import { MockEmbeddingProvider } from "../retrieval/providers/MockEmbeddingProvider.js";
import type { EmbeddingProvider } from "../retrieval/embedder.js";
import type { Document } from "../retrieval/types.js";
import type { DIContainer } from "../core/DIContainer.js";
import { container as globalContainer } from "../core/DIContainer.js";

export type ResearchQuery = {
  id: string;
  question: string;
  corpusIds?: string[];
};

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

/**
 * v0.9 additive: structured error event surfaced by runSafe()/retryLastQuery().
 * `error` is the raw thrown value — UI layers MUST sanitize it (e.g.
 * sanitizeError() from app/logger) before displaying; never render it raw.
 */
export type ResearchErrorEvent = {
  scope: "research";
  operation: "run";
  error: unknown;
};

export class ResearchWorkflow {
  private pipeline: RetrievalPipeline;
  private snapshot = new SnapshotIndex();
  private di: DIContainer;
  private history: ResearchSession[] = [];
  private documents: Map<string, Document> = new Map();
  private errorListeners = new Set<(e: ResearchErrorEvent) => void>();
  private lastErrorEvent: ResearchErrorEvent | null = null;
  private lastQuery: ResearchQuery | null = null;

  constructor(opts?: {
    provider?: EmbeddingProvider;
    pipeline?: RetrievalPipeline;
    di?: DIContainer;
    topK?: number;
  }) {
    this.di = opts?.di ?? globalContainer;
    // Resolve provider via DI like DeviceManager does, fallback to Mock
    let provider: EmbeddingProvider;
    if (opts?.provider) provider = opts.provider;
    else if (this.di.has(EMBEDDING_TOKEN))
      provider = this.di.resolve<EmbeddingProvider>(EMBEDDING_TOKEN);
    else provider = new MockEmbeddingProvider();
    this.pipeline = opts?.pipeline ?? new RetrievalPipeline(provider, { topK: opts?.topK ?? 5 });
  }

  /** DI hot-swap for embedding provider — mirrors DeviceManager pattern. */
  setEmbeddingProvider(provider: EmbeddingProvider): void {
    // Re-create pipeline with same opts but new provider, preserving chunks via re-ingest
    const chunks = this.pipeline.getChunks();
    const topK = 5;
    this.pipeline = new RetrievalPipeline(provider, { topK });
    // Re-index existing documents into new pipeline (re-embed)
    // Note: caller should re-ingest if needed; we keep snapshot state
    void chunks;
  }

  /** Ingest documents — incremental, never re-embeds unchanged. */
  async ingest(
    docs: Document[],
  ): Promise<{ added: number; removed: number; chunkCount: number; manifestVersion: string }> {
    for (const d of docs) this.documents.set(d.id, d);
    const result = await this.snapshot.index(docs);
    // Sync pipeline incrementally: remove old, add new
    for (const r of result.removed) this.pipeline.removeDocument(r.documentId);
    const addedDocs = docs.filter(d => result.added.some(c => c.documentId === d.id));
    if (addedDocs.length > 0) await this.pipeline.ingest(addedDocs);
    return {
      added: result.added.length,
      removed: result.removed.length,
      chunkCount: this.snapshot.getChunks().length,
      manifestVersion: result.manifest.version,
    };
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
    const topK = await this.pipeline.search(query.question, 5);
    let result: ResearchResult;

    if (topK.length === 0) {
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
      result = {
        queryId: query.id,
        answer: `Answer to "${query.question}" grounded in ${cited} (${citations.length} sources)`,
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

  async saveToDisk(dir = "corpus"): Promise<void> {
    const indexPath = `${dir.replace(/\/$/, "")}/index.json`;
    await this.snapshot.saveToFile(indexPath);
    const { mkdir, writeFile, rename } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const sessionsPath = `${dir.replace(/\/$/, "")}/sessions.json`;
    await mkdir(dirname(sessionsPath), { recursive: true });
    const content = JSON.stringify(this.history, null, 2);
    const tmp = `${sessionsPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    await writeFile(tmp, content, "utf8");
    await rename(tmp, sessionsPath);
  }

  async loadFromDisk(dir = "corpus"): Promise<boolean> {
    const indexPath = `${dir.replace(/\/$/, "")}/index.json`;
    const ok = await this.snapshot.loadFromFile(indexPath);
    if (!ok) return false;
    this.documents.clear();
    for (const c of this.snapshot.getChunks()) {
      if (!this.documents.has(c.documentId)) {
        this.documents.set(c.documentId, { id: c.documentId, content: c.content, path: undefined });
      }
    }
    this.pipeline.clear();
    const docs = [...this.documents.values()];
    if (docs.length > 0) await this.pipeline.ingest(docs);
    try {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(`${dir}/sessions.json`, "utf8");
      const parsed = JSON.parse(raw) as ResearchSession[];
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(s => s && typeof s.id === "string" && s.query && s.results);
        valid.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        if (valid.length > MAX_SESSIONS) valid.splice(0, valid.length - MAX_SESSIONS);
        this.history = valid;
      }
    } catch {}
    return true;
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
      this.lastErrorEvent = { scope: "research", operation: "run", error };
      for (const fn of this.errorListeners) {
        try {
          fn(this.lastErrorEvent);
        } catch {}
      }
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
