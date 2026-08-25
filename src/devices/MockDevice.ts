import type { Device, DeviceInfo, DeviceEventMap, DeviceListener } from "../core/Device.js";

export class MockDevice implements Device {
  readonly info: DeviceInfo;
  private listeners = new Map<string, Set<(p: unknown) => void>>();
  private buffer: Uint8Array | null = null;
  private lastPattern: Uint8Array | null = null;

  constructor(id = "mock-1", name = "MockDevice") {
    this.info = {
      id,
      kind: "mock",
      name,
      status: "disconnected",
      capabilities: {
        hasHaptics: true,
        hasDisplay: true,
        hasInput: true,
        dotCount: 40,
        refreshRateHz: 60,
      },
    };
  }

  async connect(): Promise<void> {
    (this.info as { status: DeviceInfo["status"] }).status = "connected";
    this.emit("connected", { device: this.info });
  }

  async disconnect(): Promise<void> {
    (this.info as { status: DeviceInfo["status"] }).status = "disconnected";
    this.emit("disconnected", { device: this.info });
  }

  async write(data: Uint8Array): Promise<void> {
    this.buffer = data.slice();
    this.emit("input", { device: this.info, data });
  }

  async read(): Promise<Uint8Array | null> {
    return this.buffer?.slice() ?? null;
  }

  async render(pattern: Uint8Array): Promise<void> {
    this.lastPattern = pattern.slice();
    this.emit("display", { device: this.info, rendered: true });
  }

  /** Test helper: last rendered pattern. */
  getLastPattern(): Uint8Array | null {
    return this.lastPattern?.slice() ?? null;
  }

  on<K extends keyof DeviceEventMap>(event: K, fn: DeviceListener<K>): () => void {
    const key = String(event);
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(fn as (p: unknown) => void);
    return () => this.off(event, fn);
  }

  off<K extends keyof DeviceEventMap>(event: K, fn: DeviceListener<K>): void {
    this.listeners.get(String(event))?.delete(fn as (p: unknown) => void);
  }

  private emit<K extends keyof DeviceEventMap>(event: K, payload: DeviceEventMap[K]): void {
    for (const fn of this.listeners.get(String(event)) ?? [])
      (fn as DeviceListener<K>)(payload as never);
  }
}
