/**
 * Registry — generic plugin-first registry with DI hot-swap.
 * Preserved architecture: key-based lookup, lifecycle hooks, hot-swap without restart.
 */

export type RegistryEntry<T> = {
  id: string;
  instance: T;
  metadata: Record<string, unknown>;
  registeredAt: number;
};

export type RegistryEvents<T> = {
  registered: RegistryEntry<T>;
  unregistered: RegistryEntry<T>;
  swapped: { from: RegistryEntry<T>; to: RegistryEntry<T> };
};

export class Registry<T> {
  private entries = new Map<string, RegistryEntry<T>>();
  private listeners = new Map<string, Set<(payload: unknown) => void>>();

  register(id: string, instance: T, metadata: Record<string, unknown> = {}): RegistryEntry<T> {
    const entry: RegistryEntry<T> = { id, instance, metadata, registeredAt: Date.now() };
    const existed = this.entries.get(id);
    this.entries.set(id, entry);
    if (existed) {
      this.emit("swapped", { from: existed, to: entry });
    } else {
      this.emit("registered", entry);
    }
    return entry;
  }

  unregister(id: string): RegistryEntry<T> | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    this.entries.delete(id);
    this.emit("unregistered", entry);
    return entry;
  }

  /** Hot-swap: replace instance atomically, preserving id + merging metadata. */
  swap(id: string, next: T, patchMeta: Record<string, unknown> = {}): RegistryEntry<T> {
    const prev = this.entries.get(id);
    if (!prev) return this.register(id, next, patchMeta);
    const nextEntry: RegistryEntry<T> = {
      id,
      instance: next,
      metadata: { ...prev.metadata, ...patchMeta },
      registeredAt: Date.now(),
    };
    this.entries.set(id, nextEntry);
    this.emit("swapped", { from: prev, to: nextEntry });
    return nextEntry;
  }

  get(id: string): T | undefined {
    return this.entries.get(id)?.instance;
  }

  getEntry(id: string): RegistryEntry<T> | undefined {
    return this.entries.get(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  list(): RegistryEntry<T>[] {
    return [...this.entries.values()];
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  clear(): void {
    for (const id of [...this.entries.keys()]) this.unregister(id);
  }

  on<K extends keyof RegistryEvents<T>>(
    event: K,
    fn: (p: RegistryEvents<T>[K]) => void,
  ): () => void {
    const key = String(event);
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(fn as (p: unknown) => void);
    return () => this.off(event, fn);
  }

  off<K extends keyof RegistryEvents<T>>(event: K, fn: (p: RegistryEvents<T>[K]) => void): void {
    this.listeners.get(String(event))?.delete(fn as (p: unknown) => void);
  }

  private emit<K extends keyof RegistryEvents<T>>(event: K, payload: RegistryEvents<T>[K]): void {
    for (const fn of this.listeners.get(String(event)) ?? []) fn(payload);
  }
}
