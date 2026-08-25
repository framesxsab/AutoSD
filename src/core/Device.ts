/**
 * Device — canonical contract for all AutoSD devices.
 * Preserved since v0.1. Additive changes only; never remove fields.
 * Compatible with MockDevice, VirtualDevice, and HIDDevice.
 */
export type DeviceKind = "mock" | "virtual" | "hid";
export type DeviceStatus = "disconnected" | "connecting" | "connected" | "error";

export interface DeviceCapabilities {
  readonly hasHaptics: boolean;
  readonly hasDisplay: boolean;
  readonly hasInput: boolean;
  readonly dotCount?: number;
  readonly refreshRateHz?: number;
}

export interface DeviceInfo {
  readonly id: string;
  readonly kind: DeviceKind;
  readonly name: string;
  readonly status: DeviceStatus;
  readonly capabilities: DeviceCapabilities;
}

export interface DeviceEventMap {
  connected: { device: DeviceInfo };
  disconnected: { device: DeviceInfo; reason?: string };
  error: { device: DeviceInfo; error: Error };
  input: { device: DeviceInfo; data: Uint8Array };
  display: { device: DeviceInfo; rendered: boolean };
}

export type DeviceEvent<K extends keyof DeviceEventMap = keyof DeviceEventMap> = {
  [P in K]: { type: P } & DeviceEventMap[P];
}[K];

export type DeviceListener<K extends keyof DeviceEventMap> = (payload: DeviceEventMap[K]) => void;

export interface Device {
  readonly info: DeviceInfo;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  read(): Promise<Uint8Array | null>;
  render(pattern: Uint8Array): Promise<void>;
  on<K extends keyof DeviceEventMap>(event: K, listener: DeviceListener<K>): () => void;
  off<K extends keyof DeviceEventMap>(event: K, listener: DeviceListener<K>): void;
}
