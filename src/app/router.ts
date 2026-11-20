import { SessionBrowser } from "../ui/SessionBrowser.js";
import { DemoPanel } from "../ui/DemoPanel.js";
import { DiagnosticsPanel, copyText } from "../ui/DiagnosticsPanel.js";
import { createLiveRegion, prefersReducedMotion } from "../accessibility/a11y.js";
import type { ResearchResult, ResearchWorkflow } from "../workflows/research.js";
import type { RetrievalMode } from "../retrieval/pipeline.js";
import {
  createCatalogPlugins,
  DEFAULT_ENABLED_PLUGINS,
  MarketplaceWorkflow,
} from "../workflows/marketplace.js";
import type { PluginHost } from "../plugins/PluginHost.js";
import {
  createDefaultPluginHost,
  createProviderById,
  isOpenAIProviderConfigured,
} from "./bootstrap.js";
import {
  clearWorkspaceState,
  loadPreferences,
  savePreferences,
  type BrailleGrade,
  type EmbeddingProviderPreference,
  type TactileMode,
} from "./BrowserStore.js";
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

export type ReaderSelection = {
  readonly documentId: string;
  readonly chunkId?: string;
  readonly result?: ResearchResult;
};

export type ViewContext = {
  workflow: ResearchWorkflow;
  liveSync?: LiveSync;
  deviceManager?: DeviceManager;
  pluginHost?: PluginHost;
  announce: (message: string) => void;
  openInReader?: (selection: ReaderSelection) => void;
  consumePendingReaderSelection?: () => ReaderSelection | null;
  onReaderSelectionChange?: (listener: () => void) => () => void;
  onWorkspaceMutated?: () => void;
};

export type AppRouterOptions = {
  container: HTMLElement;
  workflow: ResearchWorkflow;
  liveSync?: LiveSync;
  deviceManager?: DeviceManager;
  pluginHost?: PluginHost;
  baseTitle?: string;
  onWorkspaceMutated?: () => void;
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
  const h = root.querySelector<HTMLElement>("[data-autosd-view-heading], h1, h2");
  if (!h) return;
  if (!h.hasAttribute("tabindex")) h.tabIndex = -1;
  h.focus();
}

function createTourButton(
  label: string,
  opts: { clearBeforeOpen?: boolean; isMounted: () => boolean },
): { button: HTMLButtonElement; dispose: () => void } {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "autosd-tour-btn";
  button.setAttribute("aria-label", label);
  button.textContent = label;
  let activeOnboarding: { unmount: () => void } | undefined;

  button.addEventListener("click", () => {
    void Promise.all([import("../ui/Onboarding.js"), import("./OnboardingStore.js")]).then(
      ([{ Onboarding }, { clearOnboardingComplete, setOnboardingComplete }]) => {
        if (!opts.isMounted()) return;
        if (opts.clearBeforeOpen) clearOnboardingComplete();
        activeOnboarding?.unmount();
        const onboarding = new Onboarding({
          returnFocusTo: button,
          onFinish: () => {
            activeOnboarding = undefined;
            setOnboardingComplete(true);
          },
        });
        activeOnboarding = onboarding;
        onboarding.mount(document.body);
      },
    );
  });

  return {
    button,
    dispose() {
      activeOnboarding?.unmount();
      activeOnboarding = undefined;
    },
  };
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
  cards.className = "autosd-home-grid";
  cards.setAttribute("role", "list");
  cards.setAttribute("aria-label", "Application sections");
  for (const route of ROUTES.filter(
    (r): r is RouteDef & { id: Exclude<RouteId, "home"> } => r.id !== "home",
  )) {
    const li = document.createElement("li");
    li.setAttribute("role", "listitem");
    const link = document.createElement("a");
    link.href = `#/${route.path}`;
    link.className = "autosd-home-card";
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

  let mounted = false;
  const tour = createTourButton("Launch onboarding tour", { isMounted: () => mounted });
  root.appendChild(tour.button);

  return {
    root,
    mount(host) {
      mounted = true;
      host.appendChild(root);
    },
    unmount() {
      mounted = false;
      tour.dispose();
      root.remove();
    },
  };
}

function createSessionsView(ctx: ViewContext): RouterView {
  const section = document.createElement("section");
  section.setAttribute("aria-label", "Sessions");
  const browser = new SessionBrowser(ctx.workflow, {
    onExport: () => ctx.announce("Session exported"),
    onDelete: () => ctx.onWorkspaceMutated?.(),
    onOpenCitation: (sessionId, chunkId) => {
      const sess = ctx.workflow.getSession(sessionId);
      const docId = chunkId.split("#")[0];
      if (docId && ctx.openInReader) {
        ctx.openInReader({ documentId: docId, chunkId, result: sess?.results });
      }
      ctx.announce(`Opened citation ${chunkId}`);
    },
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

function createFieldRow(labelText: string, control: HTMLElement): HTMLElement {
  const row = document.createElement("div");
  row.className = "autosd-setting-row";
  const label = document.createElement("label");
  label.textContent = labelText;
  const id = `setting-${Math.random().toString(36).slice(2, 8)}`;
  control.id = id;
  label.htmlFor = id;
  row.append(label, control);
  return row;
}

function createSettingsView(ctx: ViewContext): RouterView {
  const root = document.createElement("section");
  root.setAttribute("aria-label", "Settings");
  root.appendChild(withHeading("h2", "Settings"));

  const dl = document.createElement("dl");
  dl.setAttribute("aria-label", "Environment details");
  const docsValue = document.createElement("dd");
  const chunksValue = document.createElement("dd");
  const versionValue = document.createElement("dd");
  const hashValue = document.createElement("dd");
  const motionValue = document.createElement("dd");
  const syncValue = document.createElement("dd");

  const statDefs: [string, HTMLElement][] = [
    ["Corpus documents", docsValue],
    ["Chunks", chunksValue],
    ["Manifest version", versionValue],
    ["Snapshot hash", hashValue],
    ["Reduced motion", motionValue],
    ["Corpus sync status", syncValue],
  ];
  for (const [term, dd] of statDefs) {
    const dt = document.createElement("dt");
    dt.textContent = term;
    dl.append(dt, dd);
  }
  root.appendChild(dl);

  // Interactive Retrieval & Tactile Preferences
  const prefsSec = document.createElement("section");
  prefsSec.setAttribute("aria-label", "Retrieval and tactile settings");
  const prefsHeading = document.createElement("h3");
  prefsHeading.textContent = "Retrieval & Tactile Preferences";
  prefsSec.appendChild(prefsHeading);

  const prefsStatus = document.createElement("p");
  prefsStatus.setAttribute("role", "status");
  prefsStatus.textContent = "Changes apply immediately and persist locally in your browser.";
  prefsSec.appendChild(prefsStatus);

  const providerSelect = document.createElement("select");
  providerSelect.setAttribute("aria-label", "Embedding provider");
  for (const [val, label] of [
    ["lexical", "Lexical Hash (offline, recommended)"],
    ["mock", "Mock (deterministic fixture)"],
    ["local", "Local ONNX (with fallback)"],
  ] as const) {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = label;
    providerSelect.appendChild(opt);
  }
  const openaiOpt = document.createElement("option");
  openaiOpt.value = "openai";
  openaiOpt.textContent = "OpenAI Embeddings (configured endpoint)";
  providerSelect.appendChild(openaiOpt);

  const modeSelect = document.createElement("select");
  modeSelect.setAttribute("aria-label", "Default retrieval mode");
  for (const [val, label] of [
    ["hybrid", "Hybrid (BM25 + Vector RRF)"],
    ["bm25", "BM25 (Lexical only)"],
    ["vector", "Vector only"],
  ] as const) {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = label;
    modeSelect.appendChild(opt);
  }

  const rerankCheck = document.createElement("input");
  rerankCheck.type = "checkbox";
  rerankCheck.setAttribute("aria-label", "Enable lexical reranking");

  const tactileSelect = document.createElement("select");
  tactileSelect.setAttribute("aria-label", "Tactile encoding mode");
  for (const [val, label] of [
    ["braille", "UEB Grade 1 Braille"],
    ["dots", "Legacy 6-dot byte mapping"],
  ] as const) {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = label;
    tactileSelect.appendChild(opt);
  }

  const cellSelect = document.createElement("select");
  cellSelect.setAttribute("aria-label", "Display cell count");
  for (const cells of [20, 40, 80]) {
    const opt = document.createElement("option");
    opt.value = String(cells);
    opt.textContent = `${cells} cells`;
    cellSelect.appendChild(opt);
  }

  const gradeSelect = document.createElement("select");
  gradeSelect.setAttribute("aria-label", "Braille grade");
  for (const [val, label] of [
    ["1", "UEB Grade 1 (Uncontracted)"],
    ["2", "UEB Grade 2 (Contracted)"],
  ] as const) {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = label;
    gradeSelect.appendChild(opt);
  }

  const cellPaginateCheck = document.createElement("input");
  cellPaginateCheck.type = "checkbox";
  cellPaginateCheck.setAttribute("aria-label", "Enable cell-aware pagination");

  const controlsGrid = document.createElement("div");
  controlsGrid.className = "autosd-settings-grid";
  controlsGrid.append(
    createFieldRow("Embedding provider", providerSelect),
    createFieldRow("Retrieval mode", modeSelect),
    createFieldRow("Lexical reranking", rerankCheck),
    createFieldRow("Tactile encoding", tactileSelect),
    createFieldRow("Braille grade", gradeSelect),
    createFieldRow("Display width", cellSelect),
    createFieldRow("Cell-aware pagination", cellPaginateCheck),
  );
  prefsSec.appendChild(controlsGrid);

  const dataActions = document.createElement("div");
  dataActions.className = "autosd-toolbar";
  dataActions.setAttribute("role", "group");
  dataActions.setAttribute("aria-label", "Workspace data actions");

  const exportSessionsBtn = document.createElement("button");
  exportSessionsBtn.type = "button";
  exportSessionsBtn.textContent = "Copy all sessions (JSON)";
  exportSessionsBtn.addEventListener("click", () => {
    const json = JSON.stringify(ctx.workflow.listSessions(), null, 2);
    void copyText(json).then(ok => {
      const msg = ok
        ? `Copied ${ctx.workflow.listSessions().length} session(s) JSON`
        : "Copy unavailable in this environment";
      prefsStatus.textContent = msg;
      ctx.announce(msg);
    });
  });

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.textContent = "Reset local workspace";
  dataActions.append(exportSessionsBtn, resetBtn);
  prefsSec.appendChild(dataActions);
  root.appendChild(prefsSec);

  // Plugins & Marketplace Catalog (backed by real PluginHost + BrowserStore)
  const marketplace = new MarketplaceWorkflow();
  const pluginHost = ctx.pluginHost ?? createDefaultPluginHost();
  if (!ctx.pluginHost) {
    const initialEnabled = loadPreferences().installedPlugins ?? [...DEFAULT_ENABLED_PLUGINS];
    for (const id of initialEnabled) {
      const entry = pluginHost.registry.get(id);
      if (entry && entry.state !== "active") {
        void pluginHost.registry.activate(id).then(
          () => renderPlugins(),
          () => {},
        );
      }
    }
  }
  const pluginsSec = document.createElement("section");
  pluginsSec.setAttribute("aria-label", "Plugins and marketplace");
  const pluginsHeading = document.createElement("h3");
  pluginsHeading.textContent = "Plugins & Marketplace";
  pluginsSec.appendChild(pluginsHeading);

  const pluginStatus = document.createElement("p");
  pluginStatus.setAttribute("role", "status");
  pluginsSec.appendChild(pluginStatus);

  const pluginFilter = document.createElement("input");
  pluginFilter.type = "search";
  pluginFilter.setAttribute("aria-label", "Search plugin catalog");
  pluginFilter.placeholder = "Filter plugins…";
  pluginsSec.appendChild(pluginFilter);

  const pluginList = document.createElement("ul");
  pluginList.setAttribute("role", "list");
  pluginList.setAttribute("aria-label", "Available plugins");
  pluginsSec.appendChild(pluginList);

  const persistActivePlugins = (): string[] => {
    const activeIds = pluginHost.registry
      .list()
      .filter(entry => entry.state === "active")
      .map(entry => entry.plugin.id);
    savePreferences({ installedPlugins: activeIds });
    return activeIds;
  };

  const renderPlugins = (): void => {
    pluginList.replaceChildren();
    const activeCount = pluginHost.registry.list().filter(e => e.state === "active").length;
    const workflowCount = pluginHost.listWorkflows().length;
    pluginStatus.textContent = `${activeCount} active plugin(s) · ${workflowCount} registered workflow(s)`;

    const query = pluginFilter.value.trim().toLowerCase();
    const items = marketplace
      .catalog()
      .filter(
        p =>
          !query ||
          p.name.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query) ||
          p.id.includes(query),
      );
    for (const p of items) {
      const li = document.createElement("li");
      li.setAttribute("role", "listitem");
      li.dataset.pluginId = p.id;
      const title = document.createElement("strong");
      title.textContent = `${p.name} (${p.version})`;
      const desc = document.createElement("span");
      desc.textContent = ` — ${p.description}`;
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      const entry = pluginHost.registry.get(p.id);
      const active = entry?.state === "active";
      toggleBtn.textContent = active ? "Enabled" : "Enable plugin";
      toggleBtn.setAttribute("aria-pressed", String(active));
      toggleBtn.addEventListener("click", () => {
        toggleBtn.disabled = true;
        const runToggle = async (): Promise<void> => {
          const current = pluginHost.registry.get(p.id);
          if (current?.state === "active") {
            await pluginHost.registry.deactivate(p.id);
            persistActivePlugins();
            ctx.announce(`Disabled ${p.name}`);
          } else {
            await marketplace.install(p.id);
            if (!pluginHost.registry.get(p.id)) {
              const builtin = createCatalogPlugins().find(bp => bp.id === p.id);
              if (builtin) pluginHost.registry.register(builtin);
            }
            await pluginHost.registry.activate(p.id);
            persistActivePlugins();
            ctx.announce(`Enabled ${p.name}`);
          }
          renderPlugins();
        };
        void runToggle().catch(err => {
          const msg = `Plugin ${p.name} update failed: ${err instanceof Error ? err.message : String(err)}`;
          pluginStatus.textContent = msg;
          ctx.announce(msg);
          renderPlugins();
        });
      });
      li.append(title, desc, " ", toggleBtn);
      pluginList.appendChild(li);
    }
  };
  pluginFilter.addEventListener("input", renderPlugins);
  renderPlugins();
  root.appendChild(pluginsSec);

  let mounted = false;
  const replay = createTourButton("Replay onboarding tour", {
    clearBeforeOpen: true,
    isMounted: () => mounted,
  });
  root.appendChild(replay.button);

  const diagPanel = new DiagnosticsPanel({
    input: {
      workflow: ctx.workflow,
      liveSync: ctx.liveSync,
      deviceManager: ctx.deviceManager,
    },
  });

  const refreshStatsAndControls = (): void => {
    const manifest = ctx.workflow.getManifest();
    docsValue.textContent = String(ctx.workflow.listDocuments().length);
    chunksValue.textContent = String(manifest?.chunkCount ?? 0);
    versionValue.textContent = String(manifest?.version ?? "0.0.0");
    hashValue.textContent = ctx.workflow.getSnapshotHash();
    motionValue.textContent = prefersReducedMotion() ? "Enabled (system)" : "Disabled";
    syncValue.textContent = ctx.liveSync?.getStatus() ?? "Unavailable";

    const currentProvId = ctx.workflow.getProvider().id;
    const openaiConfigured = isOpenAIProviderConfigured();
    const isCurrentOpenAI = currentProvId === "openai";
    openaiOpt.disabled = !openaiConfigured && !isCurrentOpenAI;
    openaiOpt.textContent =
      openaiConfigured || isCurrentOpenAI
        ? "OpenAI Embeddings (configured endpoint)"
        : "OpenAI Embeddings (requires VITE_OPENAI_BASE_URL)";
    providerSelect.value =
      currentProvId === "lexical-hash"
        ? "lexical"
        : currentProvId === "local"
          ? "local"
          : isCurrentOpenAI
            ? "openai"
            : "mock";
    modeSelect.value = ctx.workflow.getRetrievalMode();
    rerankCheck.checked = ctx.workflow.isRerankingEnabled();

    const prefs = loadPreferences();
    tactileSelect.value = prefs.tactileMode ?? "braille";
    gradeSelect.value = String(prefs.brailleGrade ?? 1);
    cellSelect.value = String(prefs.displayCellCount ?? 40);
    cellPaginateCheck.checked = Boolean(prefs.cellPaginationEnabled);
    renderPlugins();
  };

  providerSelect.addEventListener("change", () => {
    const val = providerSelect.value as EmbeddingProviderPreference;
    const currentProvId = ctx.workflow.getProvider().id;
    if (val === "openai" && !isOpenAIProviderConfigured() && currentProvId !== "openai") {
      const msg = "OpenAI provider requires VITE_OPENAI_BASE_URL or server-side OPENAI_API_KEY";
      prefsStatus.textContent = msg;
      ctx.announce(msg);
      refreshStatsAndControls();
      return;
    }
    if (!(val === "openai" && currentProvId === "openai")) {
      ctx.workflow.setEmbeddingProvider(createProviderById(val));
    }
    savePreferences({ embeddingProvider: val });
    diagPanel.refresh();
    ctx.onWorkspaceMutated?.();
    const msg = `Switched embedding provider to ${ctx.workflow.getProvider().id}`;
    prefsStatus.textContent = msg;
    ctx.announce(msg);
  });

  modeSelect.addEventListener("change", () => {
    const mode = modeSelect.value as RetrievalMode;
    ctx.workflow.setRetrievalMode(mode);
    savePreferences({ retrievalMode: mode });
    const msg = `Default retrieval mode set to ${mode}`;
    prefsStatus.textContent = msg;
    ctx.announce(msg);
  });

  rerankCheck.addEventListener("change", () => {
    const enabled = rerankCheck.checked;
    ctx.workflow.setReranker(enabled);
    savePreferences({ rerankerEnabled: enabled });
    const msg = `Lexical reranking ${enabled ? "enabled" : "disabled"}`;
    prefsStatus.textContent = msg;
    ctx.announce(msg);
  });

  tactileSelect.addEventListener("change", () => {
    const mode = tactileSelect.value as TactileMode;
    savePreferences({ tactileMode: mode });
    const msg = `Tactile encoding set to ${mode === "braille" ? "UEB Grade 1 Braille" : "6-dot"}`;
    prefsStatus.textContent = msg;
    ctx.announce(msg);
  });

  cellSelect.addEventListener("change", () => {
    const cells = Number(cellSelect.value) || 40;
    savePreferences({ displayCellCount: cells });
    const msg = `Default display width set to ${cells} cells`;
    prefsStatus.textContent = msg;
    ctx.announce(msg);
  });

  gradeSelect.addEventListener("change", () => {
    const grade: BrailleGrade = gradeSelect.value === "2" ? 2 : 1;
    savePreferences({ brailleGrade: grade });
    const msg = `Braille grade set to UEB Grade ${grade}`;
    prefsStatus.textContent = msg;
    ctx.announce(msg);
  });

  cellPaginateCheck.addEventListener("change", () => {
    const enabled = cellPaginateCheck.checked;
    savePreferences({ cellPaginationEnabled: enabled });
    const msg = enabled
      ? "Cell-aware Reader pagination enabled"
      : "Cell-aware Reader pagination disabled";
    prefsStatus.textContent = msg;
    ctx.announce(msg);
  });

  resetBtn.addEventListener("click", () => {
    ctx.workflow.clear();
    void clearWorkspaceState();
    refreshStatsAndControls();
    diagPanel.refresh();
    const msg = "Cleared local corpus and retrieval sessions";
    prefsStatus.textContent = msg;
    ctx.announce(msg);
  });

  let unsubscribe: (() => void) | undefined;

  return {
    root,
    mount(host) {
      mounted = true;
      diagPanel.unmount();
      diagPanel.mount(root);
      refreshStatsAndControls();
      host.appendChild(root);
      if (ctx.liveSync) {
        unsubscribe = ctx.liveSync.onStatusChange(status => {
          syncValue.textContent = status;
          if (status === "Updated") {
            refreshStatsAndControls();
            diagPanel.refresh();
          }
        });
      }
    },
    unmount() {
      mounted = false;
      replay.dispose();
      diagPanel.unmount();
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
  private pendingReaderSelection: ReaderSelection | null = null;
  private readerSelectionListeners = new Set<() => void>();

  private readonly handleHashChange = (): void => {
    this.renderCurrentHash();
  };

  constructor(opts: AppRouterOptions) {
    this.opts = opts;
    this.ctx = {
      workflow: opts.workflow,
      liveSync: opts.liveSync,
      deviceManager: opts.deviceManager,
      pluginHost: opts.pluginHost,
      announce: message => this.announce(message),
      openInReader: selection => this.openInReader(selection),
      consumePendingReaderSelection: () => {
        const next = this.pendingReaderSelection;
        this.pendingReaderSelection = null;
        return next;
      },
      onReaderSelectionChange: listener => {
        this.readerSelectionListeners.add(listener);
        return () => {
          this.readerSelectionListeners.delete(listener);
        };
      },
      onWorkspaceMutated: opts.onWorkspaceMutated,
    };
  }

  openInReader(selection: ReaderSelection): void {
    this.pendingReaderSelection = selection;
    if (this.currentRoute?.id === "reader") {
      for (const listener of this.readerSelectionListeners) listener();
    } else {
      this.navigate("reader");
    }
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
