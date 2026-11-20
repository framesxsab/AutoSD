import type { IndexManifest } from "./types.js";
import { assertSafePath, safeJsonParse } from "../utils/sanitize.js";

export { assertSafePath };
export const DEFAULT_INDEX_PATH = "corpus/index.json";

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const safePath = assertSafePath(filePath);
  const { mkdir, rename, writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(safePath), { recursive: true });
  const tmp = `${safePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, safePath);
}

function looksLikeManifest(value: unknown): value is IndexManifest {
  const m = value as IndexManifest | null;
  return (
    m !== null &&
    typeof m === "object" &&
    typeof m.version === "string" &&
    Array.isArray(m.documents)
  );
}

export async function saveManifest(filePath: string, manifest: IndexManifest): Promise<void> {
  await atomicWrite(filePath, JSON.stringify(manifest, null, 2));
}

export async function loadManifest(filePath: string): Promise<IndexManifest | null> {
  try {
    const safePath = assertSafePath(filePath);
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(safePath, "utf8");
    return safeJsonParse(raw, looksLikeManifest);
  } catch {
    return null;
  }
}

export async function saveJson(filePath: string, data: unknown): Promise<void> {
  await atomicWrite(filePath, JSON.stringify(data, null, 2));
}

export async function loadJson<T>(filePath: string): Promise<T | null> {
  try {
    const safePath = assertSafePath(filePath);
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(safePath, "utf8");
    return safeJsonParse<T>(raw);
  } catch {
    return null;
  }
}
