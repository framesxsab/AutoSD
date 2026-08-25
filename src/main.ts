import { bootstrapApp } from "./app/bootstrap.js";
import { Workspace } from "./app/Workspace.js";
import { ReaderView } from "./ui/ReaderView.js";

async function mountApp(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return;

  const { workflow, liveSync, stop } = await bootstrapApp();

  const statusHost = document.createElement("div");
  root.appendChild(statusHost);
  liveSync.mountStatusIndicator(statusHost);

  const workspace = new Workspace(workflow);
  workspace.mount(root);

  const readerHost = document.createElement("section");
  readerHost.setAttribute("aria-label", "Reader");
  root.appendChild(readerHost);
  const readerView = new ReaderView({
    onCitationOpen: cit => {
      console.log("Citation opened", cit);
    },
  });
  readerView.mount(readerHost);
  readerView.render({
    id: "welcome",
    title: "Welcome to AutoSD",
    content: "Select a document from the corpus to begin reading with grounded citations.",
  });

  (window as unknown as { __AUTOSD__?: unknown }).__AUTOSD__ = {
    workflow,
    liveSync,
    workspace,
    readerView,
    stop,
  };

  window.addEventListener("beforeunload", () => {
    stop();
  });
}

mountApp().catch(err => {
  console.error("AutoSD bootstrap failed", err);
  const root = document.getElementById("app");
  if (root) {
    const msg = document.createElement("div");
    msg.setAttribute("role", "alert");
    msg.textContent = `Failed to start AutoSD: ${String(err)}`;
    root.appendChild(msg);
  }
});
