import type { Device, DeviceInfo, DeviceEventMap, DeviceListener } from "../core/Device.js";

/**
 * VirtualDevice — in-memory simulated device with virtual framebuffer.
 * No hardware dependency; used for CI and preview workflows.
 */
export class VirtualDevice implements Device {
  readonly info: DeviceInfo;
  private listeners = new Map<string, Set<(p: unknown) => void>>();
  private framebuffer: Uint8Array;
  private connected = false;

  constructor(id = "virtual-1", name = "VirtualDevice", dotCount = 40) {
    this.framebuffer = new Uint8Array(dotCount);
    this.info = {
      id,
      kind: "virtual",
      name,
      status: "disconnected",
      capabilities: {
        hasHaptics: false,
        hasDisplay: true,
        hasInput: true,
        dotCount,
        refreshRateHz: 30,
      },
    };
  }

  async connect(): Promise<void> {
    this.connected = true;
    (this.info as { status: DeviceInfo["status"] }).status = "connected";
    this.emit("connected", { device: this.info });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    (this.info as { status: DeviceInfo["status"] }).status = "disconnected";
    this.emit("disconnected", { device: this.info });
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.connected) throw new Error("VirtualDevice: not connected");
    this.framebuffer.set(data.subarray(0, this.framebuffer.length));
    this.emit("input", { device: this.info, data: data.slice() });
  }

  async read(): Promise<Uint8Array | null> {
    return this.framebuffer.slice();
  }

  async render(pattern: Uint8Array): Promise<void> {
    if (!this.connected) throw new Error("VirtualDevice: not connected");
    this.framebuffer.set(pattern.subarray(0, this.framebuffer.length));
    this.emit("display", { device: this.info, rendered: true });
  }

  snapshot(): Uint8Array {
    return this.framebuffer.slice();
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
