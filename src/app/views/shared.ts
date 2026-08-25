import type { RouteId } from "../router.js";

export function withHeading(tag: "h1" | "h2", text: string): HTMLHeadingElement {
  const h = document.createElement(tag);
  h.textContent = text;
  h.dataset.autosdViewHeading = "true";
  return h;
}

export type LazyRouteId = Exclude<RouteId, "home" | "sessions" | "settings" | "help">;

export const ROUTE_DESCRIPTIONS: Readonly<Record<Exclude<RouteId, "home">, string>> = {
  reader: "Read corpus documents with grounded citations.",
  workspace: "Search the corpus, inspect chunks, manage retrieval sessions.",
  devices: "Connect and control Mock, Virtual, and HID devices.",
  research: "Run grounded research queries against the retrieval pipeline.",
  sessions: "Browse, export, and delete past retrieval sessions.",
  settings: "Corpus manifest, sync status, and environment details.",
  help: "Keyboard shortcuts and accessibility notes.",
  demo: "Interactive showcase of retrieval, devices, and diagnostics.",
};
