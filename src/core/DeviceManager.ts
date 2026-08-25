/**
 * DeviceManager — plugin-first orchestration over Device registry + DI.
 * Guarantees: all operations remain compatible with MockDevice, VirtualDevice, HIDDevice.
 */
import type { Device, DeviceInfo } from "./Device.js";
import { Registry } from "./Registry.js";
import { DIContainer } from "./DIContainer.js";

export type DeviceManagerEvents = {
  deviceAdded: DeviceInfo;
  deviceRemoved: { id: string };
  activeChanged: { previous: string | null; current: string | null };
};

/**
 * v0.9 additive: structured error event (render isolation, setActive guard).
 * `error` is raw — UI layers must sanitize (sanitizeError()) before display.
 */
export type DeviceErrorEvent = {
  scope: "device-manager";
  operation: "render" | "setActive";
  deviceId?: string;
  error: unknown;
};

export class DeviceManager {
  readonly registry = new Registry<Device>();
  readonly di: DIContainer;
  private activeId: string | null = null;
  private listeners = new Map<string, Set<(p: unknown) => void>>();
  private errorListeners = new Set<(e: DeviceErrorEvent) => void>();
  private lastErrorEvent: DeviceErrorEvent | null = null;

  constructor(di?: DIContainer) {
    this.di = di ?? new DIContainer();
  }

  /** Subscribe to render/setActive failures; returns an unsubscribe function. */
  onError(fn: (e: DeviceErrorEvent) => void): () => void {
    this.errorListeners.add(fn);
    return () => {
      this.errorListeners.delete(fn);
    };
  }

  getLastError(): DeviceErrorEvent | null {
    return this.lastErrorEvent;
  }

  private recordError(event: DeviceErrorEvent): void {
    this.lastErrorEvent = event;
    for (const fn of this.errorListeners) {
      try {
        fn(event);
      } catch {}
    }
  }

  /** Non-throwing setActive variant: returns false for unknown ids. */
  trySetActive(id: string): boolean {
    if (!this.registry.has(id)) {
      this.recordError({
        scope: "device-manager",
        operation: "setActive",
        deviceId: id,
        error: new Error(`DeviceManager: unknown device "${id}"`),
      });
      return false;
    }
    this.setActive(id);
    return true;
  }

  register(device: Device): void {
    this.registry.register(device.info.id, device, { kind: device.info.kind });
    this.emit("deviceAdded", device.info);
    if (!this.activeId) this.setActive(device.info.id);
  }

  unregister(id: string): void {
    this.registry.unregister(id);
    this.emit("deviceRemoved", { id });
    if (this.activeId === id) {
      const next = this.registry.ids()[0] ?? null;
      const prev = this.activeId;
      this.activeId = next;
      this.emit("activeChanged", { previous: prev, current: next });
    }
  }

  /** Hot-swap device impl without changing id — preserves listeners via Registry swapped event. */
  hotSwap(id: string, next: Device): void {
    this.registry.swap(id, next, { kind: next.info.kind });
    if (this.activeId === id) this.emit("activeChanged", { previous: id, current: id });
  }

  list(): DeviceInfo[] {
    return this.registry.list().map(e => e.instance.info);
  }

  get(id: string): Device | undefined {
    return this.registry.get(id);
  }

  getActive(): Device | null {
    return this.activeId ? (this.registry.get(this.activeId) ?? null) : null;
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  setActive(id: string): void {
    if (!this.registry.has(id)) throw new Error(`DeviceManager: unknown device "${id}"`);
    const prev = this.activeId;
    this.activeId = id;
    this.emit("activeChanged", { previous: prev, current: id });
  }

  async broadcast(pattern: Uint8Array): Promise<void> {
    for (const entry of this.registry.list()) {
      try {
        await entry.instance.render(pattern);
      } catch (err) {
        // per-device error isolation; continue broadcast
        console.warn(`[DeviceManager] render failed for ${entry.id}:`, err);
        this.recordError({
          scope: "device-manager",
          operation: "render",
          deviceId: entry.id,
          error: err,
        });
      }
    }
  }

  on<K extends keyof DeviceManagerEvents>(
    event: K,
    fn: (p: DeviceManagerEvents[K]) => void,
  ): () => void {
    const key = String(event);
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(fn as (p: unknown) => void);
    return () => this.off(event, fn);
  }

  off<K extends keyof DeviceManagerEvents>(
    event: K,
    fn: (p: DeviceManagerEvents[K]) => void,
  ): void {
    this.listeners.get(String(event))?.delete(fn as (p: unknown) => void);
  }

  private emit<K extends keyof DeviceManagerEvents>(
    event: K,
    payload: DeviceManagerEvents[K],
  ): void {
    for (const fn of this.listeners.get(String(event)) ?? []) fn(payload);
  }
}
