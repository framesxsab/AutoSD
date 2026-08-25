export type Listener<T> = (payload: T) => void;

export class EventBus<E extends Record<string, unknown>> {
  private map = new Map<string, Set<Listener<unknown>>>();

  on<K extends keyof E>(event: K, fn: Listener<E[K]>): () => void {
    const key = String(event);
    if (!this.map.has(key)) this.map.set(key, new Set());
    this.map.get(key)!.add(fn as Listener<unknown>);
    return () => this.off(event, fn);
  }

  off<K extends keyof E>(event: K, fn: Listener<E[K]>): void {
    this.map.get(String(event))?.delete(fn as Listener<unknown>);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    for (const fn of this.map.get(String(event)) ?? []) (fn as Listener<E[K]>)(payload);
  }
}
