import { SessionBrowser } from "../ui/SessionBrowser.js";
import { DemoPanel } from "../ui/DemoPanel.js";
import { createLiveRegion, prefersReducedMotion } from "../accessibility/a11y.js";
import type { ResearchWorkflow } from "../workflows/research.js";
import type { LiveSync } from "./LiveSync.js";
import type { DeviceManager } from "../core/DeviceManager.js";
import { ROUTE_DESCRIPTIONS, withHeading } from "./views/shared.js";
export type RouteId =
  | "home"
  | "reader"
  | "workspace"
  | "devices"
  | "research"
  | "sessions"
  | "settings"
  | "help"
  | "demo";

export type RouteDef = {
  readonly id: RouteId;
  readonly path: string;
  readonly label: string;
  readonly title: string;
};

export const ROUTES: readonly RouteDef[] = [
  { id: "home", path: "home", label: "Home", title: "Home" },
  { id: "reader", path: "reader", label: "Reader", title: "Reader" },
  { id: "workspace", path: "workspace", label: "Workspace", title: "Workspace" },
  { id: "devices", path: "devices", label: "Devices", title: "Devices" },
  { id: "research", path: "research", label: "Research", title: "Research" },
  { id: "sessions", path: "sessions", label: "Sessions", title: "Sessions" },
  { id: "settings", path: "settings", label: "Settings", title: "Settings" },
  { id: "help", path: "help", label: "Help", title: "Help" },
  { id: "demo", path: "demo", label: "Demo", title: "Demo" },
];

export const DEFAULT_ROUTE: RouteDef = ROUTES[0];

const ROUTE_BY_PATH = new Map<string, RouteDef>(ROUTES.map(r => [`/${r.path}`, r]));

export type HashMatch =
  { kind: "route"; route: RouteDef } | { kind: "unknown" } | { kind: "external" };

export function matchHash(raw: string): HashMatch {
  if (!raw.startsWith("#/")) return { kind: "external" };
  let path = raw.slice(1);
  try {
    path = decodeURIComponent(path);
  } catch {
    // malformed escape sequence — treat the raw text as the path
  }
  const route = ROUTE_BY_PATH.get(path.replace(/\/+$/, "").toLowerCase());
  return route ? { kind: "route", route } : { kind: "unknown" };
}

export interface RouterView {
  readonly root: HTMLElement;
  mount(host: HTMLElement): void;
  unmount(): void;
}

export type ViewContext = {
  workflow: ResearchWorkflow;
  liveSync?: LiveSync;
  deviceManager?: DeviceManager;
  announce: (message: string) => void;
};

export type AppRouterOptions = {
  container: HTMLElement;
  workflow: ResearchWorkflow;
  liveSync?: LiveSync;
  deviceManager?: DeviceManager;
  baseTitle?: string;
};

/**
 * Heavy routes load via dynamic import() so their modules stay out of the
 * initial bundle. Each loader resolves to a ready-to-mount RouterView.
 */
const LAZY_VIEW_LOADERS: Partial<Record<RouteId, (ctx: ViewContext) => Promise<RouterView>>> = {
  reader: ctx => import("./views/readerView.js").then(m => m.createReaderView(ctx)),
  workspace: ctx => import("./views/workspaceView.js").then(m => m.createWorkspaceView(ctx)),
  devices: ctx => import("./views/devicesView.js").then(m => m.createDevicesView(ctx)),
  research: ctx => import("./views/researchView.js").then(m => m.createResearchView(ctx)),
  demo: ctx => import("./views/demoView.js").then(m => m.createDemoView(ctx)),
};

const CHUNK_WARMERS: readonly (() => Promise<unknown>)[] = [
  () => import("./views/readerView.js"),
  () => import("./views/workspaceView.js"),
  () => import("./views/devicesView.js"),
  () => import("./views/researchView.js"),
  () => import("./views/demoView.js"),
];

/**
 * Accessible placeholder shown while a route chunk loads. role="status" keeps
 * screen readers informed; on failure it renders a role="alert" region with a
 * native retry button. Focus is never trapped — the shell contains no
 * focusable elements until the retry button appears.
 */
class LazyRouteView implements RouterView {
  readonly root: HTMLElement;
  ready: Promise<RouterView>;

  private readonly label: string;
  private statusEl: HTMLElement;
  private retryBtn: HTMLButtonElement | null = null;

  constructor(
    label: string,
    private readonly load: () => Promise<RouterView>,
    private readonly onSettled: (view: RouterView) => void,
  ) {
    this.label = label;
    this.root = document.createElement("section");
    this.root.setAttribute("aria-label", label);
    this.root.dataset.autosdLazy = "true";

    this.statusEl = document.createElement("p");
    this.statusEl.setAttribute("role", "status");
    this.statusEl.textContent = `Loading ${label}…`;
    this.root.appendChild(this.statusEl);

    this.ready = this.begin();
  }

  mount(host: HTMLElement): void {
    host.appendChild(this.root);
  }

  unmount(): void {
    this.root.remove();
  }

  private begin(): Promise<RouterView> {
    return this.load();
  }

  private attempt(): void {
    if (this.retryBtn) {
      this.retryBtn.remove();
      this.retryBtn = null;
    }
    this.statusEl.textContent = `Loading ${this.label}…`;
    this.ready = this.begin();
    void this.ready.then(
      view => this.onSettled(view),
      error => this.fail(error),
    );
  }

  fail(_error: unknown): void {
    const alert = document.createElement("div");
    alert.setAttribute("role", "alert");
    const title = document.createElement("p");
    title.textContent = `${this.label} could not be loaded.`;
    alert.appendChild(title);

    this.retryBtn = document.createElement("button");
    this.retryBtn.type = "button";
    this.retryBtn.textContent = "Retry";
    this.retryBtn.setAttribute("aria-label", `Retry loading ${this.label}`);
    this.retryBtn.addEventListener("click", () => this.attempt());
    alert.appendChild(this.retryBtn);

    this.statusEl.replaceWith(alert);
    this.statusEl = alert;
  }
}

function focusHeading(root: HTMLElement): void {
  const h = root.querySelector<HTMLElement>("[data-autosd-view-heading]");
  if (!h) return;
  if (!h.hasAttribute("tabindex")) h.tabIndex = -1;
  h.focus();
}

function createHomeView(): RouterView {
  const root = document.createElement("section");
  root.setAttribute("aria-label", "Home");
  root.appendChild(withHeading("h1", "AutoSD — Autonomous Knowledge Workspace"));

  const intro = document.createElement("p");
  intro.textContent =
    "Plugin-first tactile and research workspace with grounded citations. Choose a section to begin.";
  root.appendChild(intro);

  const cards = document.createElement("ul");
  cards.setAttribute("role", "list");
  cards.setAttribute("aria-label", "Application sections");
  for (const route of ROUTES.filter(
    (r): r is RouteDef & { id: Exclude<RouteId, "home"> } => r.id !== "home",
  )) {
    const li = document.createElement("li");
    li.setAttribute("role", "listitem");
    const link = document.createElement("a");
    link.href = `#/${route.path}`;
    link.style.display = "block";
    link.style.padding = "8px 12px";
    link.style.borderRadius = "6px";
    const name = document.createElement("strong");
    name.textContent = route.label;
    const desc = document.createElement("span");
    desc.textContent = ` — ${ROUTE_DESCRIPTIONS[route.id]}`;
    link.appendChild(name);
    link.appendChild(desc);
    li.appendChild(link);
    cards.appendChild(li);
  }
  root.appendChild(cards);

  return {
    root,
    mount(host) {
      host.appendChild(root);
    },
    unmount() {
      root.remove();
    },
  };
}

function createSessionsView(ctx: ViewContext): RouterView {
  const section = document.createElement("section");
  section.setAttribute("aria-label", "Sessions");
  const browser = new SessionBrowser(ctx.workflow, {
    onExport: () => ctx.announce("Session exported"),
    onOpenCitation: (_sessionId, chunkId) => ctx.announce(`Opened citation ${chunkId}`),
  });

  return {
    root: section,
    mount(host) {
      browser.mount(section);
      host.appendChild(section);
    },
    unmount() {
      browser.getElement().remove();
      section.remove();
    },
  };
}

function createSettingsView(ctx: ViewContext): RouterView {
  const root = document.createElement("section");
  root.setAttribute("aria-label", "Settings");
  root.appendChild(withHeading("h2", "Settings"));

  const manifest = ctx.workflow.getManifest();
  const rows: [string, string][] = [
    ["Corpus documents", String(ctx.workflow.listDocuments().length)],
    ["Chunks", String(manifest?.chunkCount ?? 0)],
    ["Manifest version", String(manifest?.version ?? "0.0.0")],
    ["Snapshot hash", ctx.workflow.getSnapshotHash()],
    ["Reduced motion", prefersReducedMotion() ? "Enabled (system)" : "Disabled"],
  ];

  const dl = document.createElement("dl");
  dl.setAttribute("aria-label", "Environment details");
  for (const [term, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value;
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
  const syncTerm = document.createElement("dt");
  syncTerm.textContent = "Corpus sync status";
  const syncValue = document.createElement("dd");
  syncValue.textContent = ctx.liveSync?.getStatus() ?? "Unavailable";
  dl.appendChild(syncTerm);
  dl.appendChild(syncValue);
  root.appendChild(dl);

  const note = document.createElement("p");
  note.textContent =
    "Settings are read-only in v0.9. Embedding provider and device configuration remain in bootstrapApp via DI.";
  root.appendChild(note);

  let unsubscribe: (() => void) | undefined;

  return {
    root,
    mount(host) {
      host.appendChild(root);
      if (ctx.liveSync) {
        unsubscribe = ctx.liveSync.onStatusChange(status => {
          syncValue.textContent = status;
        });
      }
    },
    unmount() {
      unsubscribe?.();
      unsubscribe = undefined;
      root.remove();
    },
  };
}

/**
 * Demo view — deliberately isolated: DemoPanel builds its own fresh
 * workflow + VirtualDevice so demo runs never mutate user corpus/history.
 */
function createDemoView(ctx: ViewContext): RouterView {
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

function createHelpView(): RouterView {
  const root = document.createElement("section");
  root.setAttribute("aria-label", "Help");
  root.appendChild(withHeading("h2", "Help"));

  const table = document.createElement("table");
  const caption = document.createElement("caption");
  caption.textContent = "Keyboard shortcuts";
  table.appendChild(caption);
  const headRow = document.createElement("tr");
  for (const text of ["Key", "Action"]) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = text;
    headRow.appendChild(th);
  }
  const thead = document.createElement("thead");
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  const shortcuts: [string, string][] = [
    ["Tab / Shift+Tab", "Move between controls"],
    ["Arrow keys", "Move focus within primary navigation and lists"],
    ["Home / End", "First / last navigation link"],
    ["Enter / Space", "Activate focused control"],
    ["Delete", "Delete focused session (Sessions view)"],
  ];
  for (const [key, action] of shortcuts) {
    const tr = document.createElement("tr");
    const tdKey = document.createElement("td");
    const code = document.createElement("code");
    code.textContent = key;
    tdKey.appendChild(code);
    const tdAction = document.createElement("td");
    tdAction.textContent = action;
    tr.appendChild(tdKey);
    tr.appendChild(tdAction);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  root.appendChild(table);

  const a11y = document.createElement("p");
  a11y.textContent =
    "AutoSD targets WCAG 2.2 AA: visible focus indicators, live-region announcements for route and corpus changes, a skip link to main content, and reduced-motion support.";
  root.appendChild(a11y);

  const routesTitle = document.createElement("h3");
  routesTitle.textContent = "Routes";
  root.appendChild(routesTitle);
  const routeList = document.createElement("ul");
  routeList.setAttribute("role", "list");
  for (const route of ROUTES) {
    const li = document.createElement("li");
    const code = document.createElement("code");
    code.textContent = `#/${route.path}`;
    li.appendChild(code);
    li.appendChild(document.createTextNode(` — ${route.label}`));
    routeList.appendChild(li);
  }
  root.appendChild(routeList);

  return {
    root,
    mount(host) {
      host.appendChild(root);
    },
    unmount() {
      root.remove();
    },
  };
}

type NotFoundView = RouterView & { setMessage: (path: string) => void };

function createNotFoundView(): NotFoundView {
  const root = document.createElement("section");
  root.setAttribute("aria-label", "Page not found");
  root.appendChild(withHeading("h2", "Page not found"));
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  message.textContent = "The requested page does not exist.";
  root.appendChild(message);
  const homeLink = document.createElement("a");
  homeLink.href = `#/${DEFAULT_ROUTE.path}`;
  homeLink.textContent = "Back to Home";
  root.appendChild(homeLink);

  return {
    root,
    setMessage(path: string) {
      message.textContent = `The page ${path} does not exist.`;
    },
    mount(host) {
      host.appendChild(root);
    },
    unmount() {
      root.remove();
    },
  };
}

export class AppRouter {
  onRouteChange: ((route: RouteDef | null) => void) | null = null;

  private readonly opts: AppRouterOptions;
  private readonly ctx: ViewContext;
  private readonly views = new Map<RouteId, RouterView>();
  private readonly lazyViews = new Map<RouteId, LazyRouteView>();
  private notFoundView?: NotFoundView;
  private currentRoute: RouteDef | null = null;
  private currentView: RouterView | null = null;
  private liveEl?: HTMLElement;
  private started = false;

  private readonly handleHashChange = (): void => {
    this.renderCurrentHash();
  };

  constructor(opts: AppRouterOptions) {
    this.opts = opts;
    this.ctx = {
      workflow: opts.workflow,
      liveSync: opts.liveSync,
      deviceManager: opts.deviceManager,
      announce: message => this.announce(message),
    };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.liveEl = this.createLiveRegionHost(this.opts.container);
    window.addEventListener("hashchange", this.handleHashChange);

    if (matchHash(window.location.hash).kind === "external") {
      try {
        window.history.replaceState(null, "", `#/${DEFAULT_ROUTE.path}`);
      } catch {
        window.location.hash = `#/${DEFAULT_ROUTE.path}`;
      }
    }
    this.renderCurrentHash();
  }

  stop(): void {
    if (!this.started) return;
    window.removeEventListener("hashchange", this.handleHashChange);
    this.currentView?.unmount();
    this.currentView = null;
    this.currentRoute = null;
    for (const lazy of this.lazyViews.values()) lazy.unmount();
    this.lazyViews.clear();
    this.liveEl?.remove();
    this.liveEl = undefined;
    this.started = false;
  }

  /**
   * Fetch (not mount) the lazily-loaded route chunks. Call after first paint
   * from an idle callback so subsequent navigation is instant without
   * competing with startup.
   */
  prefetchHeavyRoutes(): Promise<void> {
    return Promise.all(CHUNK_WARMERS.map(warm => warm().catch(() => undefined))).then(
      () => undefined,
    );
  }

  navigate(id: RouteId): void {
    const route = ROUTES.find(r => r.id === id);
    if (!route) return;
    const target = `#/${route.path}`;
    if (window.location.hash === target) this.showRoute(route);
    else window.location.hash = target;
  }

  getCurrentRoute(): RouteDef | null {
    return this.currentRoute;
  }

  getView(id: RouteId): RouterView | undefined {
    return this.views.get(id);
  }

  private renderCurrentHash(): void {
    const match = matchHash(window.location.hash);
    if (match.kind === "external") return;
    if (match.kind === "unknown") this.showNotFound(window.location.hash);
    else this.showRoute(match.route);
  }

  private showRoute(route: RouteDef): void {
    const cached = this.views.get(route.id);
    if (cached) {
      this.activate(route, cached);
      return;
    }

    const loader = LAZY_VIEW_LOADERS[route.id];
    if (!loader) {
      this.activate(route, this.createView(route.id));
      return;
    }

    let lazy = this.lazyViews.get(route.id);
    if (!lazy) {
      const fresh = new LazyRouteView(
        route.label,
        () => loader(this.ctx),
        view => this.settleLazy(route, view),
      );
      this.lazyViews.set(route.id, fresh);
      void fresh.ready.then(
        view => this.settleLazy(route, view),
        error => {
          if (this.lazyViews.get(route.id) === fresh) fresh.fail(error);
        },
      );
      lazy = fresh;
    }
    this.activate(route, lazy);
  }

  private settleLazy(route: RouteDef, view: RouterView): void {
    const lazy = this.lazyViews.get(route.id);
    this.lazyViews.delete(route.id);
    this.views.set(route.id, view);
    if (!lazy || this.currentRoute?.id !== route.id || this.currentView !== lazy) return;
    this.swap(view);
    this.announce(`${route.label} ready`);
  }

  private activate(route: RouteDef, view: RouterView): void {
    this.swap(view);
    this.currentRoute = route;
    document.title = `${route.title} · ${this.opts.baseTitle ?? "AutoSD"}`;
    this.announce(`${route.label} view loaded`);
    this.onRouteChange?.(route);
  }

  private showNotFound(path: string): void {
    if (!this.notFoundView) this.notFoundView = createNotFoundView();
    this.notFoundView.setMessage(path);
    this.swap(this.notFoundView);
    this.currentRoute = null;
    document.title = `Page not found · ${this.opts.baseTitle ?? "AutoSD"}`;
    this.announce("Page not found");
    this.onRouteChange?.(null);
  }

  private swap(next: RouterView): void {
    if (this.currentView === next) {
      focusHeading(next.root);
      return;
    }
    this.currentView?.unmount();
    this.currentView = next;
    next.mount(this.opts.container);
    focusHeading(next.root);
  }

  private createView(id: RouteId): RouterView {
    const view = this.buildView(id);
    this.views.set(id, view);
    return view;
  }

  private buildView(id: RouteId): RouterView {
    switch (id) {
      case "home":
        return createHomeView();
      case "sessions":
        return createSessionsView(this.ctx);
      case "settings":
        return createSettingsView(this.ctx);
      case "help":
        return createHelpView();
      case "demo":
        return createDemoView(this.ctx);
      case "reader":
      case "workspace":
      case "devices":
      case "research":
        // Unreachable: showRoute resolves these through LAZY_VIEW_LOADERS
        // before falling back to synchronous construction.
        throw new Error(`Route "${id}" is lazy-loaded and cannot be built synchronously`);
    }
    throw new Error(`AppRouter: unknown route "${id}"`);
  }

  private createLiveRegionHost(container: HTMLElement): HTMLElement {
    const el = document.createElement("div");
    const spec = createLiveRegion("");
    el.setAttribute("role", spec.role);
    el.setAttribute("aria-live", spec.ariaLive);
    el.setAttribute("aria-label", "Route announcements");
    el.style.position = "absolute";
    el.style.left = "-9999px";
    container.prepend(el);
    return el;
  }

  private announce(message: string): void {
    if (!this.liveEl) return;
    const spec = createLiveRegion(message);
    this.liveEl.setAttribute("role", spec.role);
    this.liveEl.setAttribute("aria-live", spec.ariaLive);
    this.liveEl.textContent = spec.message;
  }
}
