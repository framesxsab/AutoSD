/**
 * Embedding provider abstraction — DI injectable like DeviceManager.
 */

export interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  readonly model: string;
  embed(text: string): Promise<number[]>;
  embedMany(texts: string[]): Promise<number[][]>;
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export function toFloat32Vector(v: ArrayLike<number>): Float32Array {
  return v instanceof Float32Array ? v : Float32Array.from(v);
}

export function normalizeVector(v: number[]): number[] {
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (mag === 0) return v.slice();
  return v.map(x => x / mag);
}
