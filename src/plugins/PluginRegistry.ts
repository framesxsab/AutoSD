import type { Plugin, PluginEntry, PluginContext } from "./types.js";

export class PluginRegistry {
  private entries = new Map<string, PluginEntry>();
  private context: PluginContext;

  constructor(context: PluginContext) {
    this.context = context;
  }

  register(plugin: Plugin): void {
    if (this.entries.has(plugin.id)) throw new Error(`Plugin "${plugin.id}" already registered`);
    this.entries.set(plugin.id, { plugin, state: "registered" });
  }

  async activate(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Plugin "${id}" not found`);
    try {
      await entry.plugin.activate(this.context);
      entry.state = "active";
      entry.error = undefined;
    } catch (err) {
      entry.state = "error";
      entry.error = err instanceof Error ? err : new Error(String(err));
      throw entry.error;
    }
  }

  async deactivate(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Plugin "${id}" not found`);
    try {
      await entry.plugin.deactivate?.();
      entry.state = "inactive";
    } catch (err) {
      entry.state = "error";
      entry.error = err instanceof Error ? err : new Error(String(err));
      throw entry.error;
    }
  }

  /** Hot-swap: deactivate old, replace, activate new — atomically per id. */
  async hotSwap(next: Plugin): Promise<void> {
    const existing = this.entries.get(next.id);
    if (existing?.state === "active") {
      try {
        await existing.plugin.deactivate?.();
      } catch {}
    }
    this.entries.set(next.id, { plugin: next, state: "registered" });
    await this.activate(next.id);
  }

  get(id: string): PluginEntry | undefined {
    return this.entries.get(id);
  }

  list(): PluginEntry[] {
    return [...this.entries.values()];
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }
}
