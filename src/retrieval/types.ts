export type Document = {
  readonly id: string;
  readonly content: string;
  readonly path?: string;
  readonly metadata?: Record<string, unknown>;
};

export type Chunk = {
  readonly id: string;
  readonly documentId: string;
  readonly content: string;
  readonly start: number;
  readonly end: number;
  readonly hash: string;
};

export type ChunkWithEmbedding = Chunk & {
  readonly embedding: number[];
  readonly embeddingModel: string;
};

export type RetrievalResult = {
  readonly chunk: Chunk;
  readonly score: number;
  readonly source: "bm25" | "vector" | "hybrid" | "rerank";
  readonly details?: Record<string, unknown>;
};

export type RankedResult = RetrievalResult & {
  readonly rank: number;
};

export type IndexManifest = {
  readonly version: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly chunkCount: number;
  readonly documentCount: number;
  readonly documents: DocumentManifestEntry[];
  readonly config: {
    readonly chunkSize: number;
    readonly overlap: number;
    readonly embeddingModel: string;
  };
};

export type DocumentManifestEntry = {
  readonly id: string;
  readonly path?: string;
  readonly hash: string;
  readonly chunkIds: string[];
  readonly indexedAt: string;
};

export type SnapshotMetadata = {
  readonly version: string;
  readonly hash: string;
  readonly createdAt: string;
  readonly documentHashes: Record<string, string>;
};
