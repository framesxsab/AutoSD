import { describe, it, expect, vi } from "vitest";
import { MockDevice } from "../../src/devices/MockDevice.js";
import { VirtualDevice } from "../../src/devices/VirtualDevice.js";
import {
  HIDDevice,
  parseHIDInputReport,
  STANDARD_HID_PROFILES,
} from "../../src/devices/HIDDevice.js";
import { DeviceManager } from "../../src/core/DeviceManager.js";

const devices = [
  { name: "MockDevice", create: () => new MockDevice("mock-test") },
  { name: "VirtualDevice", create: () => new VirtualDevice("virtual-test") },
  { name: "HIDDevice", create: () => new HIDDevice("hid-test") },
];

describe.each(devices)("$name contract", ({ create }) => {
  it("connects, writes, renders, reads", async () => {
    const dev = create();
    await dev.connect();
    expect(dev.info.status).toBe("connected");
    const data = new Uint8Array([1, 2, 3, 4]);
    await dev.write(data);
    const read = await dev.read();
    // HID may return null when no HID handle, Mock/Virtual echo; assert no throw
    expect(read === null || read instanceof Uint8Array).toBe(true);
    await dev.render(new Uint8Array([5, 6, 7]));
    await dev.disconnect();
    expect(dev.info.status).toBe("disconnected");
  });
});

describe("DeviceManager hot-swap", () => {
  it("preserves active id after swap", async () => {
    const dm = new DeviceManager();
    const m1 = new MockDevice("swap-1");
    await m1.connect();
    dm.register(m1);
    expect(dm.getActiveId()).toBe("swap-1");
    const m2 = new MockDevice("swap-1", "MockDevice v2");
    await m2.connect();
    dm.hotSwap("swap-1", m2);
    expect(dm.get("swap-1")).toBe(m2);
    expect(dm.getActiveId()).toBe("swap-1");
  });
});

describe("M5 HIDDevice profiles, WebHID handle binding, and input-report parsing", () => {
  it("parses pan, select, routing, and 8-dot chord HID input reports", () => {
    expect(parseHIDInputReport(new Uint8Array([0x01])).kind).toBe("pan-left");
    expect(parseHIDInputReport(new Uint8Array([0x02])).kind).toBe("pan-right");
    expect(parseHIDInputReport(new Uint8Array([0x04])).kind).toBe("select");

    const routing = parseHIDInputReport(new Uint8Array([0x80, 12, 0]), 40);
    expect(routing.kind).toBe("routing");
    expect(routing.routingCell).toBe(12);

    const chord = parseHIDInputReport(new Uint8Array([0x00, 0x00, 0x1b]), 40);
    expect(chord.kind).toBe("chord");
    expect(chord.chordMask).toBe(0x1b);
  });

  it("binds a WebHID handle, sends reportId packets, and receives inputreport events", async () => {
    const profile80 = STANDARD_HID_PROFILES.find(p => p.dotCount === 80)!;
    let inputListener:
      | ((ev: { data: { buffer: ArrayBuffer; byteOffset: number; byteLength: number } }) => void)
      | undefined;
    const handle = {
      opened: false,
      open: vi.fn(async function (this: { opened: boolean }) {
        this.opened = true;
      }),
      close: vi.fn(async function (this: { opened: boolean }) {
        this.opened = false;
      }),
      sendReport: vi.fn(async () => {}),
      addEventListener: vi.fn((type: string, fn: typeof inputListener) => {
        if (type === "inputreport") inputListener = fn;
      }),
    };

    const hid = new HIDDevice("hid-80", "Braille 80", { profile: profile80, handle });
    expect(hid.getProfile().dotCount).toBe(80);
    expect(hid.info.capabilities.dotCount).toBe(80);

    await hid.connect();
    expect(handle.open).toHaveBeenCalledTimes(1);

    const pattern = new Uint8Array(80).fill(1);
    await hid.render(pattern);
    expect(handle.sendReport).toHaveBeenCalledWith(profile80.reportId, pattern);

    const received: Uint8Array[] = [];
    hid.on("input", ev => received.push(ev.data));
    const reportBytes = new Uint8Array([0x80, 7, 0x00]);
    inputListener?.({
      data: {
        buffer: reportBytes.buffer,
        byteOffset: reportBytes.byteOffset,
        byteLength: reportBytes.byteLength,
      },
    });
    expect(hid.getLastInputReport()?.kind).toBe("routing");
    expect(hid.getLastInputReport()?.routingCell).toBe(7);
    expect(received.length).toBeGreaterThan(0);

    await hid.disconnect();
    expect(handle.close).toHaveBeenCalledTimes(1);
  });
});
