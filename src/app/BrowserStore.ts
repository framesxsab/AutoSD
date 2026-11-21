/**
 * BrowserStore — zero-dependency browser persistence for corpus state,
 * retrieval sessions, and user preferences (IndexedDB with localStorage fallback).
 *
 * Guarantees:
 * - Never throws in Node, SSR, private-browsing, or storage-quota failures.
 * - Stores local user corpus + preferences only in browser-local storage.
 */
import type { RetrievalMode } from "../retrieval/pipeline.js";
import { isValidRestoredSession, type PersistedWorkflowState } from "../workflows/research.js";
import { safeJsonParse } from "../utils/sanitize.js";

export type TactileMode = "braille" | "dots";

export type BrailleGrade = 1 | 2;

export type EmbeddingProviderPreference = "lexical" | "mock" | "local" | "openai";

export type UserPreferences = {
  embeddingProvider?: EmbeddingProviderPreference;
  retrievalMode?: RetrievalMode;
  rerankerEnabled?: boolean;
  abstainOnLowEvidence?: boolean;
  tactileMode?: TactileMode;
  brailleGrade?: BrailleGrade;
  cellPaginationEnabled?: boolean;
  displayCellCount?: number;
  installedPlugins?: string[];
};

export type PersistedBrowserWorkspace = {
  readonly version: 1;
  readonly updatedAt: string;
  readonly workflowState: PersistedWorkflowState;
};

export const WORKSPACE_STORAGE_KEY = "autosd:workspaceState";
export const PREFS_STORAGE_KEY = "autosd:preferences";
const IDB_NAME = "autosd-local";
const IDB_STORE = "workspace";
const IDB_RECORD_KEY = "state";

function hasLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function hasIndexedDB(): boolean {
  try {
    return typeof indexedDB !== "undefined" && typeof indexedDB.open === "function";
  } catch {
    return false;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    } catch (err) {
      reject(err);
    }
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  if (!hasIndexedDB()) return null;
  let db: IDBDatabase | null = null;
  try {
    db = await openDatabase();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db!.transaction(IDB_STORE, "readonly");
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
    });
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

async function idbPut<T>(key: string, value: T): Promise<boolean> {
  if (!hasIndexedDB()) return false;
  let db: IDBDatabase | null = null;
  try {
    db = await openDatabase();
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db!.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      store.put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
    });
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

async function idbDelete(key: string): Promise<void> {
  if (!hasIndexedDB()) return;
  let db: IDBDatabase | null = null;
  try {
    db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
    });
  } catch {
    // ignore
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

function isValidWorkspace(raw: unknown): raw is PersistedBrowserWorkspace {
  if (!raw || typeof raw !== "object") return false;
  const rec = raw as Record<string, unknown>;
  if (rec.version !== 1 || !rec.workflowState || typeof rec.workflowState !== "object") {
    return false;
  }
  const ws = rec.workflowState as Record<string, unknown>;
  if (!Array.isArray(ws.documents) || !Array.isArray(ws.sessions)) return false;
  const docsOk = ws.documents.every(
    (d: unknown) =>
      Boolean(d) &&
      typeof d === "object" &&
      typeof (d as { id?: unknown }).id === "string" &&
      typeof (d as { content?: unknown }).content === "string",
  );
  const sessionsOk = ws.sessions.every(isValidRestoredSession);
  return docsOk && sessionsOk;
}

export async function loadWorkspaceState(): Promise<PersistedBrowserWorkspace | null> {
  const fromIdb = await idbGet<unknown>(IDB_RECORD_KEY);
  if (isValidWorkspace(fromIdb)) return fromIdb;

  if (!hasLocalStorage()) return null;
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return null;
    return safeJsonParse(raw, isValidWorkspace);
  } catch {
    return null;
  }
}

export async function saveWorkspaceState(workflowState: PersistedWorkflowState): Promise<void> {
  const payload: PersistedBrowserWorkspace = {
    version: 1,
    updatedAt: new Date().toISOString(),
    workflowState,
  };
  await idbPut(IDB_RECORD_KEY, payload);
  if (hasLocalStorage()) {
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Storage quota or blocked storage — IndexedDB (if present) still holds state.
    }
  }
}

export async function clearWorkspaceState(): Promise<void> {
  await idbDelete(IDB_RECORD_KEY);
  if (hasLocalStorage()) {
    try {
      localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    } catch {}
  }
}

export function loadPreferences(): UserPreferences {
  if (!hasLocalStorage()) return {};
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const rec = parsed as Record<string, unknown>;
    const prefs: UserPreferences = {};
    if (
      rec.embeddingProvider === "lexical" ||
      rec.embeddingProvider === "mock" ||
      rec.embeddingProvider === "local" ||
      rec.embeddingProvider === "openai"
    ) {
      prefs.embeddingProvider = rec.embeddingProvider;
    }
    if (
      rec.retrievalMode === "hybrid" ||
      rec.retrievalMode === "bm25" ||
      rec.retrievalMode === "vector"
    ) {
      prefs.retrievalMode = rec.retrievalMode;
    }
    if (typeof rec.rerankerEnabled === "boolean") {
      prefs.rerankerEnabled = rec.rerankerEnabled;
    }
    if (typeof rec.abstainOnLowEvidence === "boolean") {
      prefs.abstainOnLowEvidence = rec.abstainOnLowEvidence;
    }
    if (rec.tactileMode === "braille" || rec.tactileMode === "dots") {
      prefs.tactileMode = rec.tactileMode;
    }
    if (rec.brailleGrade === 1 || rec.brailleGrade === 2) {
      prefs.brailleGrade = rec.brailleGrade;
    }
    if (typeof rec.cellPaginationEnabled === "boolean") {
      prefs.cellPaginationEnabled = rec.cellPaginationEnabled;
    }
    if (
      typeof rec.displayCellCount === "number" &&
      Number.isFinite(rec.displayCellCount) &&
      rec.displayCellCount >= 8 &&
      rec.displayCellCount <= 160
    ) {
      prefs.displayCellCount = Math.floor(rec.displayCellCount);
    }
    if (Array.isArray(rec.installedPlugins)) {
      const seen = new Set<string>();
      const validPlugins: string[] = [];
      for (const item of rec.installedPlugins) {
        if (typeof item !== "string") continue;
        const id = item.trim();
        if (id.length === 0 || id.length > 64 || seen.has(id)) continue;
        seen.add(id);
        validPlugins.push(id);
        if (validPlugins.length >= 50) break;
      }
      prefs.installedPlugins = validPlugins;
    }
    return prefs;
  } catch {
    return {};
  }
}

export function savePreferences(prefs: UserPreferences): void {
  if (!hasLocalStorage()) return;
  try {
    const merged = { ...loadPreferences(), ...prefs };
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(merged));
  } catch {}
}

export function clearPreferences(): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.removeItem(PREFS_STORAGE_KEY);
  } catch {}
}
