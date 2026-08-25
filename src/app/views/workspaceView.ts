import { Workspace } from "../Workspace.js";
import type { ViewContext } from "../router.js";

export function createWorkspaceView(ctx: ViewContext) {
  const workspace = new Workspace(ctx.workflow);

  return {
    root: workspace.getElement(),
    mount(host: HTMLElement) {
      workspace.mount(host);
      if (ctx.liveSync) workspace.attachLiveSync(ctx.liveSync);
    },
    unmount() {
      workspace.unmount();
    },
  };
}
