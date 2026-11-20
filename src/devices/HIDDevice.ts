import type { Device, DeviceInfo, DeviceEventMap, DeviceListener } from "../core/Device.js";

/**
 * M5 Hardware First-Contact: declarative profile for USB/Bluetooth HID
 * refreshable braille displays (USB HID Usage Page 0x0041).
 */
export type DeviceProfile = {
  readonly id: string;
  readonly label: string;
  readonly usagePage: number;
  readonly vendorId?: number;
  readonly productId?: number;
  readonly dotCount: number;
  readonly reportId: number;
  readonly refreshRateHz: number;
};

export const STANDARD_HID_PROFILES: readonly DeviceProfile[] = [
  {
    id: "generic-braille-40",
    label: "USB HID Braille Display (40 cells)",
    usagePage: 0x0041,
    dotCount: 40,
    reportId: 0x01,
    refreshRateHz: 60,
  },
  {
    id: "generic-braille-20",
    label: "Compact HID Braille Display (20 cells)",
    usagePage: 0x0041,
    dotCount: 20,
    reportId: 0x01,
    refreshRateHz: 60,
  },
  {
    id: "generic-braille-80",
    label: "Desk HID Braille Display (80 cells)",
    usagePage: 0x0041,
    dotCount: 80,
    reportId: 0x01,
    refreshRateHz: 60,
  },
];

export type HIDInputKind = "pan-left" | "pan-right" | "select" | "routing" | "chord" | "raw";

export type ParsedHIDInputReport = {
  readonly kind: HIDInputKind;
  readonly panLeft: boolean;
  readonly panRight: boolean;
  readonly select: boolean;
  readonly routingCell: number | null;
  readonly chordMask: number;
  readonly raw: Uint8Array;
};

/**
 * Decode a raw HID input report packet into structured tactile navigation,
 * cursor-routing, or 8-dot Perkins chord actions:
 *  - byte 0: nav flags (0x01 pan-left, 0x02 pan-right, 0x04 select, 0x80 routing flag)
 *  - byte 1: cursor routing cell index (when 0x80 set and < dotCount)
 *  - byte 2: 8-dot braille key chord mask (0x00..0xff)
 */
export function parseHIDInputReport(data: Uint8Array, dotCount = 40): ParsedHIDInputReport {
  const b0 = data[0] ?? 0;
  const b1 = data[1] ?? 0;
  const b2 = data[2] ?? 0;
  const panLeft = (b0 & 0x01) !== 0;
  const panRight = (b0 & 0x02) !== 0;
  const select = (b0 & 0x04) !== 0;
  const hasRouting = (b0 & 0x80) !== 0 && data.length >= 2 && b1 < dotCount;
  const routingCell = hasRouting ? b1 : null;
  const chordMask = data.length >= 3 ? b2 : 0;

  let kind: HIDInputKind = "raw";
  if (routingCell !== null) kind = "routing";
  else if (panLeft) kind = "pan-left";
  else if (panRight) kind = "pan-right";
  else if (select) kind = "select";
  else if (chordMask > 0) kind = "chord";

  return {
    kind,
    panLeft,
    panRight,
    select,
    routingCell,
    chordMask,
    raw: data.slice(),
  };
}

export type HIDDeviceOptions = {
  readonly profile?: DeviceProfile;
  readonly handle?: unknown;
};

type WebHIDHandleLike = {
  opened?: boolean;
  productName?: string;
  open?: () => Promise<void>;
  close?: () => Promise<void>;
  sendReport?: (reportId: number, data: Uint8Array) => Promise<void>;
  write?: (data: Uint8Array) => Promise<void>;
  read?: () => Promise<Uint8Array>;
  addEventListener?: (
    type: string,
    listener: (ev: {
      data?: { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
    }) => void,
  ) => void;
};

/**
 * HIDDevice — thin adapter over WebHID / node-hid.
 * Falls back to no-op when HID is unavailable (CI / unsupported platform).
 * Keeps the same Device contract so every feature works with Mock/Virtual/HID.
 */
export class HIDDevice implements Device {
  readonly info: DeviceInfo;
  private listeners = new Map<string, Set<(p: unknown) => void>>();
  private hidHandle: unknown = null;
  private readonly profile: DeviceProfile;
  private lastInputReport: ParsedHIDInputReport | null = null;

  constructor(id = "hid-1", name = "HIDDevice", opts: HIDDeviceOptions = {}) {
    this.profile = opts.profile ?? STANDARD_HID_PROFILES[0];
    this.hidHandle = opts.handle ?? null;
    this.info = {
      id,
      kind: "hid",
      name,
      status: "disconnected",
      capabilities: {
        hasHaptics: true,
        hasDisplay: true,
        hasInput: true,
        dotCount: this.profile.dotCount,
        refreshRateHz: this.profile.refreshRateHz,
      },
    };
  }

  getProfile(): DeviceProfile {
    return this.profile;
  }

  getLastInputReport(): ParsedHIDInputReport | null {
    return this.lastInputReport;
  }

  /**
   * Process an incoming HID input report (from WebHID `inputreport` event or
   * software test harness), decode navigation/routing/chord fields, and emit
   * the `Device` `"input"` event.
   */
  receiveInputReport(data: Uint8Array): ParsedHIDInputReport {
    const parsed = parseHIDInputReport(data, this.profile.dotCount);
    this.lastInputReport = parsed;
    this.emit("input", { device: this.info, data: data.slice() });
    return parsed;
  }

  async connect(): Promise<void> {
    try {
      if (!this.hidHandle) {
        const maybeHid = await this.resolveHID();
        this.hidHandle = maybeHid ?? null;
      }
      const handle = this.hidHandle as WebHIDHandleLike | null;
      if (handle && typeof handle.open === "function" && !handle.opened) {
        await handle.open();
      }
      if (handle && typeof handle.addEventListener === "function") {
        handle.addEventListener("inputreport", ev => {
          if (ev.data) {
            const bytes = new Uint8Array(ev.data.buffer, ev.data.byteOffset, ev.data.byteLength);
            this.receiveInputReport(bytes);
          }
        });
      }
    } catch {
      this.hidHandle = null;
    }
    (this.info as { status: DeviceInfo["status"] }).status = "connected";
    this.emit("connected", { device: this.info });
  }

  async disconnect(): Promise<void> {
    try {
      const handle = this.hidHandle as WebHIDHandleLike | null;
      if (handle && typeof handle.close === "function" && handle.opened) {
        await handle.close();
      }
    } catch {}
    this.hidHandle = null;
    (this.info as { status: DeviceInfo["status"] }).status = "disconnected";
    this.emit("disconnected", { device: this.info });
  }

  async write(data: Uint8Array): Promise<void> {
    const handle = this.hidHandle as WebHIDHandleLike | null;
    if (handle && typeof handle.sendReport === "function") {
      await handle.sendReport(this.profile.reportId, data);
    } else if (handle && typeof handle.write === "function") {
      await handle.write(data);
    }
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
      // Dynamic import; optional peer dependency — keep unresolvable at bundle time
      const nodeHidPkg = "node-hid";
      const mod: unknown = await import(/* @vite-ignore */ nodeHidPkg).catch(() => null);
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
