import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { IndexManifest } from "./types.js";
import { safeJsonParse } from "../utils/sanitize.js";

export const DEFAULT_INDEX_PATH = "corpus/index.json";

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, filePath);
}

function looksLikeManifest(value: unknown): value is IndexManifest {
  const m = value as IndexManifest | null;
  return (
    m !== null &&
    typeof m === "object" &&
    typeof m.version === "string" &&
    m.documents !== undefined
  );
}

export async function saveManifest(filePath: string, manifest: IndexManifest): Promise<void> {
  await atomicWrite(filePath, JSON.stringify(manifest, null, 2));
}

export async function loadManifest(filePath: string): Promise<IndexManifest | null> {
  try {
    const raw = await readFile(filePath, "utf8");
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
    const raw = await readFile(filePath, "utf8");
    return safeJsonParse<T>(raw);
  } catch {
    return null;
  }
}
