import type { Chunk, Document, IndexManifest, DocumentManifestEntry } from "./types.js";
import { chunkDocument, hashContent } from "./chunker.js";

export function hashDocument(doc: Document): string {
  return hashContent(doc.content);
}

export function nextVersion(prev?: string): string {
  if (!prev) return "1.0.0";
  const parts = prev.split(".").map(Number);
  parts[2] = (parts[2] ?? 0) + 1;
  return parts.join(".");
}

export type IncrementalResult = {
  added: Chunk[];
  removed: Chunk[];
  unchanged: string[];
  manifest: IndexManifest;
};

export class SnapshotIndex {
  private manifests = new Map<string, IndexManifest>();
  private documentHashes = new Map<string, string>();
  private chunksByDoc = new Map<string, Chunk[]>();
  private allChunks: Chunk[] = [];
  private version = "0.0.0";

  getVersion(): string {
    return this.version;
  }

  getChunks(): readonly Chunk[] {
    return this.allChunks;
  }

  getManifest(): IndexManifest | undefined {
    return this.manifests.get(this.version);
  }

  listManifests(): IndexManifest[] {
    return [...this.manifests.values()];
  }

  /**
   * Incremental indexing — never re-indexes unchanged files.
   * Returns added/removed chunks and new manifest.
   */
  async index(
    docs: Document[],
    opts: { chunkSize?: number; overlap?: number; embeddingModel?: string } = {},
  ): Promise<IncrementalResult> {
    const chunkSize = opts.chunkSize ?? 800;
    const overlap = opts.overlap ?? 120;
    const embeddingModel = opts.embeddingModel ?? "mock-384";

    const added: Chunk[] = [];
    const removed: Chunk[] = [];
    const unchanged: string[] = [];

    const nextHashes = new Map<string, string>();
    for (const doc of docs) nextHashes.set(doc.id, hashDocument(doc));

    // Detect removed documents
    for (const [id] of this.documentHashes) {
      if (!nextHashes.has(id)) {
        const oldChunks = this.chunksByDoc.get(id) ?? [];
        removed.push(...oldChunks);
        this.chunksByDoc.delete(id);
        this.allChunks = this.allChunks.filter(c => c.documentId !== id);
      }
    }

    // Detect added/changed
    for (const doc of docs) {
      const newHash = nextHashes.get(doc.id)!;
      const oldHash = this.documentHashes.get(doc.id);
      if (oldHash === newHash) {
        unchanged.push(doc.id);
        continue;
      }
      // Changed or new — remove old chunks if any
      const oldChunks = this.chunksByDoc.get(doc.id) ?? [];
      if (oldChunks.length > 0) {
        removed.push(...oldChunks);
        this.allChunks = this.allChunks.filter(c => c.documentId !== doc.id);
      }
      const newChunks = chunkDocument(doc, { chunkSize, overlap });
      this.chunksByDoc.set(doc.id, newChunks);
      added.push(...newChunks);
      this.allChunks.push(...newChunks);
    }

    // Update hashes
    for (const doc of docs) this.documentHashes.set(doc.id, nextHashes.get(doc.id)!);
    for (const r of removed) {
      if (!docs.some(d => d.id === r.documentId)) this.documentHashes.delete(r.documentId);
    }

    this.version = nextVersion(this.version === "0.0.0" ? undefined : this.version);
    const now = new Date().toISOString();

    const entries: DocumentManifestEntry[] = docs.map(d => ({
      id: d.id,
      path: d.path,
      hash: this.documentHashes.get(d.id)!,
      chunkIds: (this.chunksByDoc.get(d.id) ?? []).map(c => c.id),
      indexedAt: now,
    }));

    const manifest: IndexManifest = {
      version: this.version,
      createdAt: this.manifests.size === 0 ? now : [...this.manifests.values()][0].createdAt,
      updatedAt: now,
      chunkCount: this.allChunks.length,
      documentCount: docs.length,
      documents: entries,
      config: { chunkSize, overlap, embeddingModel },
    };

    this.manifests.set(this.version, manifest);

    return { added, removed, unchanged, manifest };
  }

  snapshotHash(): string {
    const sorted = [...this.documentHashes.entries()].sort(([a], [b]) => a.localeCompare(b));
    const payload = sorted.map(([id, h]) => `${id}:${h}`).join("|");
    return hashContent(payload);
  }

  exportManifest(version?: string): string {
    const m = version ? this.manifests.get(version) : this.getManifest();
    if (!m) throw new Error("SnapshotIndex: no manifest");
    return JSON.stringify(m, null, 2);
  }

  clear(): void {
    this.documentHashes.clear();
    this.chunksByDoc.clear();
    this.allChunks = [];
    this.manifests.clear();
    this.version = "0.0.0";
  }

  toPersistedState(): {
    version: string;
    documentHashes: Record<string, string>;
    chunks: Chunk[];
    manifests: IndexManifest[];
  } {
    return {
      version: this.version,
      documentHashes: Object.fromEntries(this.documentHashes),
      chunks: [...this.allChunks],
      manifests: [...this.manifests.values()],
    };
  }

  fromPersistedState(state: {
    version: string;
    documentHashes: Record<string, string>;
    chunks: Chunk[];
    manifests: IndexManifest[];
  }): void {
    this.version = state.version;
    this.documentHashes = new Map(Object.entries(state.documentHashes));
    this.allChunks = [...state.chunks];
    this.chunksByDoc.clear();
    for (const c of this.allChunks) {
      const arr = this.chunksByDoc.get(c.documentId) ?? [];
      arr.push(c);
      this.chunksByDoc.set(c.documentId, arr);
    }
    this.manifests.clear();
    for (const m of state.manifests) this.manifests.set(m.version, m);
  }

  async saveToFile(filePath = "corpus/index.json"): Promise<void> {
    try {
      const { mkdir, writeFile, rename } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(filePath), { recursive: true });
      const state = this.toPersistedState();
      const content = JSON.stringify(state, null, 2);
      const tmp = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
      await writeFile(tmp, content, "utf8");
      await rename(tmp, filePath);
    } catch {
      return;
    }
  }

  async loadFromFile(filePath = "corpus/index.json"): Promise<boolean> {
    try {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      // Support both legacy manifest-only and new full-state format
      if (parsed.manifests && parsed.documentHashes) {
        this.fromPersistedState(parsed);
        return true;
      }
      if (parsed.version && parsed.documents) {
        // Legacy manifest-only file — hydrate minimal state
        const m = parsed as IndexManifest;
        this.version = m.version;
        this.manifests.set(m.version, m);
        for (const d of m.documents) this.documentHashes.set(d.id, d.hash);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}
