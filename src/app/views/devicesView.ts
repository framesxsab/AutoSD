import { textToDots } from "../../workflows/tactile.js";
import type { ViewContext } from "../router.js";
import type { RouterView } from "../router.js";
import { withHeading } from "./shared.js";

export function createDevicesView(ctx: ViewContext): RouterView {
  const root = document.createElement("section");
  root.setAttribute("aria-label", "Devices");
  root.appendChild(withHeading("h2", "Devices"));
  const listWrap = document.createElement("div");
  root.appendChild(listWrap);

  let unsubscribe: (() => void) | undefined;

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

    const devices = dm.list();
    const activeId = dm.getActiveId();
    const summary = document.createElement("p");
    summary.setAttribute("role", "status");
    summary.textContent = `${devices.length} device${devices.length === 1 ? "" : "s"} registered · active: ${activeId ?? "none"}`;
    listWrap.appendChild(summary);

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

      const actions = document.createElement("div");
      actions.setAttribute("role", "group");
      actions.setAttribute("aria-label", `Actions for ${info.name}`);

      const toggleBtn = document.createElement("button");
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
    patternBtn.textContent = "Send test pattern to active device";
    patternBtn.addEventListener("click", () => {
      const active = ctx.deviceManager?.getActive();
      if (!active) {
        ctx.announce("No active device");
        return;
      }
      void ctx.deviceManager
        ?.broadcast(textToDots("AutoSD"))
        .then(() => ctx.announce(`Rendered test pattern on ${active.info.name}`))
        .catch(() => ctx.announce("Test pattern failed"));
    });
    listWrap.appendChild(patternBtn);
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
        unsubscribe = () => offs.forEach(off => off());
      }
      renderList();
    },
    unmount() {
      unsubscribe?.();
      unsubscribe = undefined;
      root.remove();
    },
  };
}
