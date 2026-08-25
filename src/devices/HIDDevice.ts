import type { Device, DeviceInfo, DeviceEventMap, DeviceListener } from "../core/Device.js";

/**
 * HIDDevice — thin adapter over WebHID / node-hid.
 * Falls back to no-op when HID is unavailable (CI / unsupported platform).
 * Keeps the same Device contract so every feature works with Mock/Virtual/HID.
 */
export class HIDDevice implements Device {
  readonly info: DeviceInfo;
  private listeners = new Map<string, Set<(p: unknown) => void>>();
  private hidHandle: unknown = null;

  constructor(id = "hid-1", name = "HIDDevice") {
    this.info = {
      id,
      kind: "hid",
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
    try {
      // Attempt to resolve HID handle lazily; graceful fallback if unavailable.
      const maybeHid = await this.resolveHID();
      this.hidHandle = maybeHid ?? null;
    } catch {
      this.hidHandle = null;
    }
    (this.info as { status: DeviceInfo["status"] }).status = "connected";
    this.emit("connected", { device: this.info });
  }

  async disconnect(): Promise<void> {
    this.hidHandle = null;
    (this.info as { status: DeviceInfo["status"] }).status = "disconnected";
    this.emit("disconnected", { device: this.info });
  }

  async write(data: Uint8Array): Promise<void> {
    if (
      this.hidHandle &&
      typeof (this.hidHandle as { write?: (d: Uint8Array) => Promise<void> }).write === "function"
    ) {
      await (this.hidHandle as { write: (d: Uint8Array) => Promise<void> }).write(data);
    }
    this.emit("input", { device: this.info, data: data.slice() });
  }

  async read(): Promise<Uint8Array | null> {
    if (
      this.hidHandle &&
      typeof (this.hidHandle as { read?: () => Promise<Uint8Array> }).read === "function"
    ) {
      return (this.hidHandle as { read: () => Promise<Uint8Array> }).read();
    }
    return null;
  }

  async render(pattern: Uint8Array): Promise<void> {
    await this.write(pattern);
    this.emit("display", { device: this.info, rendered: true });
  }

  private async resolveHID(): Promise<unknown> {
    // WebHID (browser) or node-hid (Node) — both optional.
    // We probe without hard dependency so CI never fails.
    try {
      // @ts-ignore — optional global
      if (typeof navigator !== "undefined" && (navigator as unknown as { hid?: unknown }).hid)
        return (navigator as unknown as { hid: unknown }).hid;
    } catch {}
    try {
      // Dynamic import; may not be installed
      // @ts-ignore — optional peer dependency
      const mod: unknown = await import("node-hid" as string).catch(() => null);
      return mod;
    } catch {
      return null;
    }
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
