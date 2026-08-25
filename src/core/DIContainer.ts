/**
 * DIContainer — lightweight DI with hot-swap and lifecycle.
 * Additive only; preserves v0.3.0 contract.
 */

export type Lifetime = "singleton" | "transient";

export type Provider<T> = {
  factory: () => T;
  lifetime: Lifetime;
  instance?: T;
};

export class DIContainer {
  private providers = new Map<string, Provider<unknown>>();
  private disposers = new Map<string, () => void>();

  register<T>(token: string, factory: () => T, lifetime: Lifetime = "singleton"): void {
    this.providers.set(token, { factory: factory as () => unknown, lifetime });
  }

  registerInstance<T>(token: string, instance: T, dispose?: () => void): void {
    this.providers.set(token, {
      factory: () => instance as unknown,
      lifetime: "singleton",
      instance: instance as unknown,
    });
    if (dispose) this.disposers.set(token, dispose);
  }

  resolve<T>(token: string): T {
    const provider = this.providers.get(token) as Provider<T> | undefined;
    if (!provider) throw new Error(`DI: no provider for token "${token}"`);
    if (provider.lifetime === "singleton") {
      if (provider.instance === undefined) provider.instance = provider.factory();
      return provider.instance as T;
    }
    return provider.factory();
  }

  has(token: string): boolean {
    return this.providers.has(token);
  }

  /** Hot-swap: replace provider atomically; disposes previous singleton if present. */
  hotSwap<T>(token: string, factory: () => T, lifetime: Lifetime = "singleton"): void {
    const prev = this.providers.get(token);
    if (prev?.instance !== undefined) {
      const dispose = this.disposers.get(token);
      try {
        dispose?.();
      } catch {
        // best-effort dispose
      }
    }
    this.providers.set(token, { factory: factory as () => unknown, lifetime });
    this.disposers.delete(token);
    // clear cached singleton so next resolve recreates
    const nextProvider = this.providers.get(token)!;
    delete (nextProvider as { instance?: unknown }).instance;
  }

  unregister(token: string): void {
    const p = this.providers.get(token);
    if (p?.instance !== undefined) {
      try {
        this.disposers.get(token)?.();
      } catch {}
    }
    this.providers.delete(token);
    this.disposers.delete(token);
  }

  clear(): void {
    for (const token of [...this.providers.keys()]) this.unregister(token);
  }

  tokens(): string[] {
    return [...this.providers.keys()];
  }
}

export const container = new DIContainer();
