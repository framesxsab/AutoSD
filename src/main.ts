import { bootstrapApp, DEVICE_MANAGER_TOKEN } from "./app/bootstrap.js";
import { AppRouter, ROUTES } from "./app/router.js";
import { saveWorkspaceState } from "./app/BrowserStore.js";
import { AppNav } from "./ui/AppNav.js";
import type { DeviceManager } from "./core/DeviceManager.js";
import { ErrorBoundary } from "./app/ErrorBoundary.js";
import { getHealth } from "./app/health.js";
import { logger } from "./app/logger.js";
import { getConfig } from "./app/config.js";

function warmRouter(router: AppRouter): void {
  const warm = (): void => {
    void router.prefetchHeavyRoutes();
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(warm, { timeout: 3000 });
  } else {
    setTimeout(warm, 1500);
  }
}

async function mountApp(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return;

  const config = getConfig();
  logger.info("starting AutoSD", { version: config.version, environment: config.environment });

  performance.mark("autosd:bootstrap-start");
  // background: true keeps corpus load + live sync off the critical path;
  // views render live values and settle once `ready` resolves.
  const { workflow, liveSync, di, pluginHost, stop, ready } = await bootstrapApp({
    background: true,
    interactiveDefaults: true,
  });
  performance.mark("autosd:bootstrap-end");
  const deviceManager = di.has(DEVICE_MANAGER_TOKEN)
    ? di.resolve<DeviceManager>(DEVICE_MANAGER_TOKEN)
    : undefined;

  const navHost = document.createElement("header");
  navHost.className = "autosd-shell-header";
  root.appendChild(navHost);
  const nav = new AppNav(
    ROUTES.map(r => ({ id: r.id, path: r.path, label: r.label })),
    { label: "Primary" },
  );
  nav.mount(navHost);

  const statusHost = document.createElement("div");
  statusHost.className = "autosd-status-host";
  navHost.appendChild(statusHost);
  liveSync.mountStatusIndicator(statusHost);

  const main = document.createElement("main");
  main.id = "main-content";
  root.appendChild(main);

  const router = new AppRouter({
    container: main,
    workflow,
    liveSync,
    deviceManager,
    pluginHost,
    onWorkspaceMutated: () => {
      void liveSync.runManualSync(() => saveWorkspaceState(workflow.toPersistedState()));
    },
  });
  router.onRouteChange = route => {
    if (route) nav.setActive(route.id);
  };
  router.start();

  performance.mark("autosd:app-ready");
  try {
    performance.measure("autosd:startup", "autosd:bootstrap-start", "autosd:app-ready");
    const measure = performance.getEntriesByName("autosd:startup").at(-1);
    logger.info("startup complete", { ms: measure ? Math.round(measure.duration) : null });
  } catch {
    // performance marks unsupported — startup timing is best-effort
  }

  warmRouter(router);

  void ready?.then(outcome => logger.info("background startup settled", outcome));

  (window as unknown as { __AUTOSD__?: unknown }).__AUTOSD__ = config.isProduction
    ? Object.freeze({
        health: () => getHealth({ workflow, liveSync }),
      })
    : {
        workflow,
        liveSync,
        deviceManager,
        pluginHost,
        router,
        nav,
        stop,
        health: () => getHealth({ workflow, liveSync }),
      };

  window.addEventListener("beforeunload", () => {
    stop();
  });
}

function start(): void {
  const root = document.getElementById("app");
  if (!root) return;
  const boundary = new ErrorBoundary({
    host: root,
    label: "AutoSD failed to start",
    onRetry: () => true,
  });
  boundary.installGlobalHandlers();
  mountApp().catch(err => {
    boundary.show(err);
  });
}

start();
