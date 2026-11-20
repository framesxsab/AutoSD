import type { EmbeddingProvider } from "../embedder.js";
import { MockEmbeddingProvider } from "./MockEmbeddingProvider.js";

export type TransformersFeatureExtractor = (
  text: string,
  options?: { pooling?: "mean" | "cls" | "none"; normalize?: boolean },
) => Promise<{ data?: ArrayLike<number> } | ArrayLike<number>>;

export type TransformersModuleLike = {
  pipeline?: (task: string, model: string) => Promise<TransformersFeatureExtractor>;
};

export type LocalEmbeddingProviderOptions = {
  readonly model?: string;
  readonly onnxModel?: string;
  readonly dimensions?: number;
  readonly fallback?: EmbeddingProvider;
  readonly loader?: () => Promise<TransformersModuleLike | null>;
};

export const DEFAULT_LOCAL_ONNX_MODEL = "Xenova/all-MiniLM-L6-v2";

function extractNumericVector(raw: unknown): number[] | null {
  const candidate =
    raw && typeof raw === "object" && "data" in raw ? (raw as { data?: unknown }).data : raw;
  if (!candidate) return null;
  if (Array.isArray(candidate)) {
    return candidate.length > 0 && candidate.every(v => typeof v === "number" && Number.isFinite(v))
      ? candidate
      : null;
  }
  if (ArrayBuffer.isView(candidate) && "length" in candidate) {
    const view = candidate as unknown as ArrayLike<number>;
    if (view.length === 0) return null;
    const out = new Array<number>(view.length);
    for (let i = 0; i < view.length; i++) {
      const v = Number(view[i]);
      if (!Number.isFinite(v)) return null;
      out[i] = v;
    }
    return out;
  }
  return null;
}

function l2Normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
  const mag = Math.sqrt(sumSq);
  if (mag === 0 || !Number.isFinite(mag)) return vec;
  return vec.map(x => x / mag);
}

async function defaultLoadTransformers(): Promise<TransformersModuleLike | null> {
  for (const pkgName of ["@huggingface/transformers", "@xenova/transformers"]) {
    try {
      const mod = (await import(/* @vite-ignore */ pkgName)) as unknown as TransformersModuleLike;
      if (mod && typeof mod.pipeline === "function") return mod;
    } catch {
      // Optional peer not installed — try next candidate or fall back cleanly.
    }
  }
  return null;
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly id = "local";
  readonly model: string;
  readonly dimensions: number;
  private readonly onnxModel: string;
  private readonly fallback: EmbeddingProvider;
  private readonly loader: () => Promise<TransformersModuleLike | null>;
  private pipe: TransformersFeatureExtractor | null = null;
  private initPromise: Promise<void> | null = null;
  private initFailed = false;

  constructor(opts: LocalEmbeddingProviderOptions = {}) {
    this.model = opts.model ?? "local-bge-small";
    this.onnxModel = opts.onnxModel ?? DEFAULT_LOCAL_ONNX_MODEL;
    this.dimensions = opts.dimensions ?? 384;
    this.fallback = opts.fallback ?? new MockEmbeddingProvider();
    this.loader = opts.loader ?? defaultLoadTransformers;
  }

  private async ensurePipeline(): Promise<void> {
    if (this.pipe || this.initFailed) return;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        try {
          const mod = await this.loader();
          if (!mod?.pipeline) {
            this.initFailed = true;
            return;
          }
          const extractor = await mod.pipeline("feature-extraction", this.onnxModel);
          if (typeof extractor !== "function") {
            this.initFailed = true;
            return;
          }
          this.pipe = extractor;
        } catch {
          this.initFailed = true;
          this.pipe = null;
        }
      })();
    }
    await this.initPromise;
  }

  isFallback(): boolean {
    return this.initFailed || this.pipe === null;
  }

  getBackend(): "onnx" | "fallback" | "uninitialized" {
    if (this.pipe && !this.initFailed) return "onnx";
    if (this.initFailed) return "fallback";
    return "uninitialized";
  }

  getOnnxModel(): string {
    return this.onnxModel;
  }

  async embed(text: string): Promise<number[]> {
    await this.ensurePipeline();
    if (this.pipe && !this.initFailed) {
      try {
        const out = await this.pipe(text, { pooling: "mean", normalize: true });
        const vec = extractNumericVector(out);
        if (vec && vec.length > 0) {
          return l2Normalize(vec);
        }
      } catch {
        this.initFailed = true;
        this.pipe = null;
      }
    }
    return this.fallback.embed(`[local]${text}`);
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    await this.ensurePipeline();
    return Promise.all(texts.map(t => this.embed(t)));
  }
}
