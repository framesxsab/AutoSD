import { describe, it, expect } from "vitest";
import { MockDevice } from "../../src/devices/MockDevice.js";
import { VirtualDevice } from "../../src/devices/VirtualDevice.js";
import { HIDDevice } from "../../src/devices/HIDDevice.js";
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
