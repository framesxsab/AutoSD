import type { EmbeddingProvider } from "../embedder.js";
import { MockEmbeddingProvider } from "./MockEmbeddingProvider.js";

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly id = "local";
  readonly model = "local-bge-small";
  readonly dimensions = 384;
  private fallback = new MockEmbeddingProvider();
  private pipe: ((text: string) => Promise<{ data: number[] }>) | null = null;
  private initAttempted = false;
  private initFailed = false;

  private async ensurePipeline(): Promise<void> {
    if (this.initAttempted) return;
    this.initAttempted = true;
    try {
      const mod = (await import("@xenova/transformers" as string).catch(() => null)) as unknown as {
        pipeline?: (
          task: string,
          model: string,
        ) => Promise<(text: string) => Promise<{ data: number[] }>>;
      } | null;
      if (!mod?.pipeline) {
        this.initFailed = true;
        return;
      }
      const extractor = await mod.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
      this.pipe = extractor as unknown as (text: string) => Promise<{ data: number[] }>;
    } catch {
      this.initFailed = true;
      this.pipe = null;
    }
  }

  isFallback(): boolean {
    return this.initFailed || this.pipe === null;
  }

  async embed(text: string): Promise<number[]> {
    await this.ensurePipeline();
    if (this.pipe) {
      try {
        const out = await this.pipe(text);
        const vec = out.data ?? (out as unknown as number[]);
        if (Array.isArray(vec) && vec.length > 0) {
          const mag = Math.sqrt(vec.reduce((s: number, x: number) => s + x * x, 0));
          return mag === 0 ? (vec as number[]) : (vec as number[]).map((x: number) => x / mag);
        }
      } catch {
        this.initFailed = true;
      }
    }
    return this.fallback.embed(`[local]${text}`);
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}
