import type { FSWatcher } from "node:fs";
import type { Document } from "./types.js";
import { hashContent } from "./chunker.js";

export type WatcherEvent = {
  added: Document[];
  modified: Document[];
  deleted: string[];
};

export type WatcherOptions = {
  debounceMs?: number;
  extensions?: string[];
  ignoreDotfiles?: boolean;
};

export class CorpusWatcher {
  private watcher?: FSWatcher;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private fileHashes = new Map<string, string>();
  private running = false;

  constructor(
    private dir: string,
    private onChange: (event: WatcherEvent) => Promise<void> | void,
    private opts: WatcherOptions = {},
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.scanInitial();
    try {
      const { watch } = await import("node:fs");
      this.watcher = watch(this.dir, { persistent: false }, () => this.scheduleScan());
    } catch {
      this.watcher = undefined;
    }
  }

  stop(): void {
    this.running = false;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.watcher?.close();
    this.watcher = undefined;
  }

  isRunning(): boolean {
    return this.running;
  }

  async trigger(): Promise<WatcherEvent> {
    return this.scan();
  }

  private scheduleScan(): void {
    const ms = this.opts.debounceMs ?? 150;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.scan()
        .then(ev => {
          if (ev.added.length > 0 || ev.modified.length > 0 || ev.deleted.length > 0) {
            return this.onChange(ev);
          }
        })
        .catch(() => {});
    }, ms);
  }

  private async scanInitial(): Promise<void> {
    await this.scan();
  }

  private async scan(): Promise<WatcherEvent> {
    const extensions = this.opts.extensions ?? [".md", ".txt", ".json"];
    const ignoreDot = this.opts.ignoreDotfiles ?? true;

    let entries: string[] = [];
    try {
      const { readdir } = await import("node:fs/promises");
      entries = await readdir(this.dir);
    } catch {
      return { added: [], modified: [], deleted: [] };
    }

    const current = new Map<string, string>();
    const added: Document[] = [];
    const modified: Document[] = [];
    const seenIds = new Set<string>();

    for (const entry of entries) {
      if (ignoreDot && entry.startsWith(".")) continue;
      const { extname, join } = await import("node:path");
      if (extensions.length > 0 && !extensions.includes(extname(entry))) continue;
      const full = join(this.dir, entry);
      try {
        const { readFile, stat } = await import("node:fs/promises");
        const st = await stat(full);
        if (!st.isFile()) continue;
        const content = await readFile(full, "utf8");
        const hash = hashContent(content);
        const id = entry.replace(extname(entry), "");
        seenIds.add(id);
        current.set(id, hash);
        const prev = this.fileHashes.get(id);
        if (prev === undefined) {
          added.push({ id, content, path: full, metadata: { hash } });
        } else if (prev !== hash) {
          modified.push({ id, content, path: full, metadata: { hash } });
        }
      } catch {}
    }

    const deleted: string[] = [];
    for (const [id] of this.fileHashes) {
      if (!seenIds.has(id)) deleted.push(id);
    }

    this.fileHashes = current;
    return { added, modified, deleted };
  }
}
