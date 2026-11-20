import type { Device } from "../../core/Device.js";
import { HIDDevice, parseHIDInputReport, STANDARD_HID_PROFILES } from "../../devices/HIDDevice.js";
import { VirtualDevice } from "../../devices/VirtualDevice.js";
import { textToBraille, textToDots } from "../../workflows/tactile.js";
import { loadPreferences } from "../BrowserStore.js";
import type { ViewContext, RouterView } from "../router.js";
import { withHeading } from "./shared.js";

export function createDevicesView(ctx: ViewContext): RouterView {
  const root = document.createElement("section");
  root.setAttribute("aria-label", "Devices");
  root.appendChild(withHeading("h2", "Devices"));
  const listWrap = document.createElement("div");
  root.appendChild(listWrap);

  const previewBox = document.createElement("div");
  previewBox.className = "autosd-tactile-preview";
  previewBox.setAttribute("role", "status");
  previewBox.setAttribute("aria-label", "Active device tactile preview");
  previewBox.textContent = "No pattern rendered yet.";

  const logEntries: string[] = [];
  const logList = document.createElement("ul");
  logList.setAttribute("role", "list");
  logList.setAttribute("aria-label", "Device event entries");

  const renderLog = (): void => {
    logList.replaceChildren();
    if (logEntries.length === 0) {
      const empty = document.createElement("li");
      empty.setAttribute("role", "listitem");
      empty.textContent = "No device I/O events recorded yet.";
      logList.appendChild(empty);
      return;
    }
    for (const entry of logEntries.slice(-10).reverse()) {
      const li = document.createElement("li");
      li.setAttribute("role", "listitem");
      li.textContent = entry;
      logList.appendChild(li);
    }
  };

  const pushLog = (message: string): void => {
    logEntries.push(message);
    renderLog();
  };

  let unsubscribeManager: (() => void) | undefined;
  let unsubscribeDevices: (() => void)[] = [];
  let virtualCounter = 0;

  const wireDeviceListeners = (): void => {
    for (const off of unsubscribeDevices) off();
    unsubscribeDevices = [];
    const dm = ctx.deviceManager;
    if (!dm) return;
    for (const info of dm.list()) {
      const dev: Device | undefined = dm.get(info.id);
      if (!dev) continue;
      unsubscribeDevices.push(
        dev.on("display", ev => {
          pushLog(`[display] ${ev.device.name} (${ev.device.id}) rendered frame`);
        }),
        dev.on("input", ev => {
          const parsed = parseHIDInputReport(ev.data, ev.device.capabilities?.dotCount ?? 40);
          const detail =
            parsed.kind === "routing"
              ? ` · routing cell ${parsed.routingCell}`
              : parsed.kind !== "raw"
                ? ` · ${parsed.kind}`
                : "";
          pushLog(`[input] ${ev.device.name} (${ev.data.length} bytes${detail})`);
        }),
        dev.on("connected", ev => {
          pushLog(`[connected] ${ev.device.name}`);
        }),
        dev.on("disconnected", ev => {
          pushLog(`[disconnected] ${ev.device.name}`);
        }),
      );
    }
  };

  const showPreview = (deviceName: string, pattern: Uint8Array, brailleUnicode?: string): void => {
    const glyphs = Array.from(pattern, cell => (cell > 0 ? "●" : "·")).join("");
    const activeDots = Array.from(pattern).filter(cell => cell > 0).length;
    const statusLine = document.createElement("div");
    statusLine.textContent = `${deviceName} — ${activeDots} of ${pattern.length} dots active`;
    const children: HTMLElement[] = [statusLine];
    if (brailleUnicode !== undefined) {
      const brailleEl = document.createElement("div");
      brailleEl.textContent = `Braille: ${brailleUnicode || "⠀"}`;
      children.push(brailleEl);
    }
    const glyphsPre = document.createElement("pre");
    glyphsPre.setAttribute("aria-hidden", "true");
    glyphsPre.textContent = glyphs;
    children.push(glyphsPre);
    previewBox.replaceChildren(...children);
  };

  const renderList = (): void => {
    listWrap.replaceChildren();
    const dm = ctx.deviceManager;
    if (!dm) {
      const p = document.createElement("p");
      p.setAttribute("role", "status");
      p.textContent = "No device manager available.";
      listWrap.appendChild(p);
      return;
    }

    wireDeviceListeners();

    const devices = dm.list();
    const activeId = dm.getActiveId();
    const summary = document.createElement("p");
    summary.setAttribute("role", "status");
    summary.textContent = `${devices.length} device${devices.length === 1 ? "" : "s"} registered · active: ${activeId ?? "none"}`;
    listWrap.appendChild(summary);

    // Provisioning toolbar: add VirtualDevice or request WebHID
    const provisionBar = document.createElement("div");
    provisionBar.className = "autosd-toolbar";
    provisionBar.setAttribute("role", "group");
    provisionBar.setAttribute("aria-label", "Device provisioning");

    const cellSelect = document.createElement("select");
    cellSelect.setAttribute("aria-label", "Virtual device cell count");
    const defaultCells = loadPreferences().displayCellCount ?? 40;
    for (const cells of [20, 40, 80]) {
      const opt = document.createElement("option");
      opt.value = String(cells);
      opt.textContent = `${cells} cells`;
      if (cells === defaultCells) opt.selected = true;
      cellSelect.appendChild(opt);
    }

    const addVirtualBtn = document.createElement("button");
    addVirtualBtn.type = "button";
    addVirtualBtn.textContent = "Add virtual device";
    addVirtualBtn.addEventListener("click", () => {
      const cells = Number(cellSelect.value) || 40;
      virtualCounter += 1;
      const id = `virtual-${Date.now().toString(36)}-${virtualCounter}`;
      const vdev = new VirtualDevice(id, `VirtualDisplay (${cells}c)`, cells);
      void vdev.connect().then(() => {
        dm.register(vdev);
        dm.setActive(vdev.info.id);
        renderList();
        ctx.announce(`Added and activated ${vdev.info.name}`);
      });
    });

    const hidBtn = document.createElement("button");
    hidBtn.type = "button";
    hidBtn.textContent = "Connect HID display";
    hidBtn.addEventListener("click", () => {
      const nav = (
        globalThis as unknown as {
          navigator?: { hid?: { requestDevice?: (opts: unknown) => Promise<unknown[]> } };
        }
      ).navigator;
      if (!nav?.hid?.requestDevice) {
        ctx.announce("WebHID is unavailable in this environment");
        pushLog("[hid] WebHID requestDevice unavailable");
        return;
      }
      void nav.hid
        .requestDevice({ filters: [{ usagePage: 0x0041 }] })
        .then(async selected => {
          if (!Array.isArray(selected) || selected.length === 0) {
            ctx.announce("No HID display selected");
            return;
          }
          const cells = Number(cellSelect.value) || 40;
          const profile =
            STANDARD_HID_PROFILES.find(p => p.dotCount === cells) ?? STANDARD_HID_PROFILES[0];
          const first = selected[0] as { productName?: string } | undefined;
          const devName =
            typeof first?.productName === "string" && first.productName.trim().length > 0
              ? first.productName.trim()
              : "HID Display";
          const hid = new HIDDevice(`hid-${Date.now().toString(36)}`, devName, {
            handle: selected[0],
            profile,
          });
          await hid.connect();
          dm.register(hid);
          dm.setActive(hid.info.id);
          renderList();
          ctx.announce(`Connected ${hid.info.name}`);
        })
        .catch(() => {
          ctx.announce("HID display connection cancelled");
          pushLog("[hid] WebHID request cancelled or failed");
        });
    });

    provisionBar.append(cellSelect, addVirtualBtn, hidBtn);
    listWrap.appendChild(provisionBar);

    const list = document.createElement("ul");
    list.setAttribute("role", "list");
    for (const info of devices) {
      const li = document.createElement("li");
      li.setAttribute("role", "listitem");
      li.dataset.device = info.id;

      const label = document.createElement("strong");
      label.textContent = info.name;
      li.appendChild(label);

      const meta = document.createElement("span");
      meta.textContent = ` · ${info.kind} · ${info.status}${info.id === activeId ? " · active" : ""}`;
      li.appendChild(meta);

      const caps = dm.get(info.id)?.info.capabilities ?? info.capabilities;
      if (caps) {
        const capParts: string[] = [];
        if (typeof caps.dotCount === "number") capParts.push(`${caps.dotCount} dots`);
        if (typeof caps.refreshRateHz === "number") capParts.push(`${caps.refreshRateHz} Hz`);
        if (caps.hasHaptics) capParts.push("haptics");
        if (caps.hasDisplay) capParts.push("display");
        if (caps.hasInput) capParts.push("input");
        const capsEl = document.createElement("span");
        capsEl.className = "autosd-device-caps";
        capsEl.textContent = ` (${capParts.length > 0 ? capParts.join(" · ") : "standard"})`;
        li.appendChild(capsEl);
      }

      const actions = document.createElement("div");
      actions.setAttribute("role", "group");
      actions.setAttribute("aria-label", `Actions for ${info.name}`);

      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.textContent = info.status === "connected" ? "Disconnect" : "Connect";
      toggleBtn.setAttribute(
        "aria-label",
        `${info.status === "connected" ? "Disconnect" : "Connect"} device ${info.name}`,
      );
      toggleBtn.addEventListener("click", () => {
        const device = dm.get(info.id);
        if (!device) return;
        const op = device.info.status === "connected" ? device.disconnect() : device.connect();
        void op
          .then(() => renderList())
          .catch(() => ctx.announce(`Device operation failed for ${info.name}`));
      });
      actions.appendChild(toggleBtn);

      const activateBtn = document.createElement("button");
      activateBtn.type = "button";
      activateBtn.textContent = "Set active";
      activateBtn.disabled = info.id === activeId;
      activateBtn.setAttribute("aria-label", `Set device ${info.name} active`);
      activateBtn.addEventListener("click", () => {
        try {
          dm.setActive(info.id);
          renderList();
        } catch {
          ctx.announce(`Could not activate device ${info.name}`);
        }
      });
      actions.appendChild(activateBtn);
      li.appendChild(actions);
      list.appendChild(li);
    }
    listWrap.appendChild(list);

    const patternBtn = document.createElement("button");
    patternBtn.type = "button";
    patternBtn.textContent = "Send test pattern to active device";
    patternBtn.addEventListener("click", () => {
      const active = ctx.deviceManager?.getActive();
      if (!active) {
        ctx.announce("No active device");
        return;
      }
      const pattern = textToDots("AutoSD", active.info.capabilities?.dotCount ?? 40);
      void ctx.deviceManager
        ?.broadcast(pattern)
        .then(() => {
          showPreview(active.info.name, pattern);
          ctx.announce(`Rendered test pattern on ${active.info.name}`);
        })
        .catch(() => ctx.announce("Test pattern failed"));
    });
    listWrap.appendChild(patternBtn);

    // Custom Braille / 6-dot tactile text sender
    const customBar = document.createElement("div");
    customBar.className = "autosd-toolbar";
    customBar.setAttribute("role", "group");
    customBar.setAttribute("aria-label", "Custom tactile renderer");

    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.placeholder = "Enter text to render…";
    textInput.setAttribute("aria-label", "Custom tactile text");

    const encodingSelect = document.createElement("select");
    encodingSelect.setAttribute("aria-label", "Tactile encoding");
    const prefMode = loadPreferences().tactileMode ?? "braille";
    for (const [val, label] of [
      ["braille", "UEB Grade 1 Braille"],
      ["dots", "Legacy 6-dot"],
    ] as const) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = label;
      if (val === prefMode) opt.selected = true;
      encodingSelect.appendChild(opt);
    }

    const sendCustomBtn = document.createElement("button");
    sendCustomBtn.type = "button";
    sendCustomBtn.textContent = "Render to active device";
    sendCustomBtn.addEventListener("click", () => {
      const active = ctx.deviceManager?.getActive();
      if (!active) {
        ctx.announce("No active device");
        return;
      }
      const text = textInput.value.trim() || "AutoSD";
      const cellCount = active.info.capabilities?.dotCount ?? 40;
      if (encodingSelect.value === "braille") {
        const braille = textToBraille(text, cellCount);
        void ctx.deviceManager
          ?.broadcast(braille.cells)
          .then(() => {
            showPreview(active.info.name, braille.cells, braille.unicode);
            ctx.announce(`Rendered braille for "${text}" on ${active.info.name}`);
          })
          .catch(() => ctx.announce("Braille render failed"));
      } else {
        const pattern = textToDots(text, cellCount);
        void ctx.deviceManager
          ?.broadcast(pattern)
          .then(() => {
            showPreview(active.info.name, pattern);
            ctx.announce(`Rendered dots for "${text}" on ${active.info.name}`);
          })
          .catch(() => ctx.announce("Dot render failed"));
      }
    });

    customBar.append(textInput, encodingSelect, sendCustomBtn);
    listWrap.appendChild(customBar);

    // M5 Hardware First-Contact: HID input-report simulator (pan-left, pan-right, routing cell)
    const inputSimBar = document.createElement("div");
    inputSimBar.className = "autosd-toolbar";
    inputSimBar.setAttribute("role", "group");
    inputSimBar.setAttribute("aria-label", "HID input report simulator");

    const emitInputPacket = (packet: Uint8Array, label: string): void => {
      const active = ctx.deviceManager?.getActive();
      if (!active) {
        ctx.announce("No active device");
        return;
      }
      if (active instanceof HIDDevice) {
        active.receiveInputReport(packet);
        ctx.announce(`Simulated ${label} on ${active.info.name}`);
        return;
      }
      void active
        .write(packet)
        .then(() => ctx.announce(`Simulated ${label} on ${active.info.name}`))
        .catch(() => ctx.announce(`Input simulation failed on ${active.info.name}`));
    };

    const panLeftBtn = document.createElement("button");
    panLeftBtn.type = "button";
    panLeftBtn.textContent = "Simulate pan left";
    panLeftBtn.addEventListener("click", () =>
      emitInputPacket(new Uint8Array([0x01, 0x00, 0x00]), "pan-left"),
    );

    const panRightBtn = document.createElement("button");
    panRightBtn.type = "button";
    panRightBtn.textContent = "Simulate pan right";
    panRightBtn.addEventListener("click", () =>
      emitInputPacket(new Uint8Array([0x02, 0x00, 0x00]), "pan-right"),
    );

    const routeCellBtn = document.createElement("button");
    routeCellBtn.type = "button";
    routeCellBtn.textContent = "Simulate routing cell 1";
    routeCellBtn.addEventListener("click", () =>
      emitInputPacket(new Uint8Array([0x80, 0x01, 0x00]), "routing cell 1"),
    );

    inputSimBar.append(panLeftBtn, panRightBtn, routeCellBtn);
    listWrap.appendChild(inputSimBar);

    listWrap.appendChild(previewBox);

    const logSec = document.createElement("section");
    logSec.setAttribute("aria-label", "Device I/O log");
    const logHeading = document.createElement("h3");
    logHeading.textContent = "Device I/O log";
    logSec.appendChild(logHeading);
    renderLog();
    logSec.appendChild(logList);
    listWrap.appendChild(logSec);
  };

  return {
    root,
    mount(host) {
      host.appendChild(root);
      const dm = ctx.deviceManager;
      if (dm) {
        const rerender = (): void => renderList();
        const offs = [
          dm.on("deviceAdded", rerender),
          dm.on("deviceRemoved", rerender),
          dm.on("activeChanged", rerender),
        ];
        unsubscribeManager = () => offs.forEach(off => off());
      }
      renderList();
    },
    unmount() {
      unsubscribeManager?.();
      unsubscribeManager = undefined;
      for (const off of unsubscribeDevices) off();
      unsubscribeDevices = [];
      root.remove();
    },
  };
}
