import { DemoPanel } from "../../ui/DemoPanel.js";
import type { ViewContext, RouterView } from "../router.js";

/**
 * Demo view — deliberately isolated: DemoPanel builds its own fresh
 * workflow + VirtualDevice so demo runs never mutate user corpus/history.
 */
export function createDemoView(ctx: ViewContext): RouterView {
  const root = document.createElement("section");
  root.setAttribute("aria-label", "Demo showcase");
  const panel = new DemoPanel({ announce: msg => ctx.announce(msg) });

  return {
    root,
    mount(host) {
      panel.mount(root);
      host.appendChild(root);
    },
    unmount() {
      panel.unmount();
      root.remove();
    },
  };
}
