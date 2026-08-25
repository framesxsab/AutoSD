import { prefersReducedMotion } from "../accessibility/a11y.js";

export type NavLink = {
  readonly id: string;
  readonly path: string;
  readonly label: string;
};

export type AppNavOptions = {
  label?: string;
  onNavigate?: (id: string) => void;
};

let stylesInjected = false;

function injectNavStyles(): void {
  if (stylesInjected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.dataset.autosdAppNav = "";
  style.textContent = [
    ".autosd-nav{--autosd-nav-accent:#005fcc;--autosd-nav-accent-contrast:#ffffff;--autosd-nav-hover:#eef2f7;}",
    ".autosd-nav ul{display:flex;flex-wrap:wrap;gap:4px;list-style:none;margin:0;padding:0;}",
    ".autosd-nav a{display:inline-block;min-height:24px;padding:8px 12px;border-radius:6px;text-decoration:none;color:inherit;font-weight:500;transition:background-color 120ms ease,color 120ms ease;}",
    ".autosd-nav a:hover{background:var(--autosd-nav-hover);}",
    ".autosd-nav a[aria-current='page']{background:var(--autosd-nav-accent);color:var(--autosd-nav-accent-contrast);}",
    ".autosd-nav.autosd-reduced-motion a{transition:none;}",
    "@media (prefers-reduced-motion: reduce){.autosd-nav a{transition:none;}}",
  ].join("\n");
  document.head.appendChild(style);
  stylesInjected = true;
}

export class AppNav {
  private nav: HTMLElement;
  private list: HTMLElement;
  private links = new Map<string, HTMLAnchorElement>();
  private activeId: string | null = null;

  constructor(
    private routes: readonly NavLink[],
    private opts: AppNavOptions = {},
  ) {
    injectNavStyles();
    this.nav = document.createElement("nav");
    this.nav.className = "autosd-nav";
    this.nav.setAttribute("role", "navigation");
    this.nav.setAttribute("aria-label", opts.label ?? "Primary");
    if (prefersReducedMotion()) this.nav.classList.add("autosd-reduced-motion");

    this.list = document.createElement("ul");
    for (const route of routes) this.list.appendChild(this.createItem(route));
    this.nav.appendChild(this.list);

    this.list.addEventListener("keydown", e => this.handleKeyDown(e));
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.nav);
  }

  unmount(): void {
    this.nav.remove();
  }

  getElement(): HTMLElement {
    return this.nav;
  }

  setActive(id: string): void {
    for (const [key, link] of this.links) {
      if (key === id) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    this.activeId = id;
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  focusFirstLink(): void {
    const active = this.activeId !== null ? this.links.get(this.activeId) : undefined;
    const target = active ?? [...this.links.values()][0];
    target?.focus();
  }

  private createItem(route: NavLink): HTMLLIElement {
    const li = document.createElement("li");
    li.setAttribute("role", "listitem");
    const link = document.createElement("a");
    link.href = `#/${route.path}`;
    link.textContent = route.label;
    link.dataset.route = route.id;
    link.addEventListener("click", () => this.opts.onNavigate?.(route.id));
    this.links.set(route.id, link);
    li.appendChild(link);
    return li;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const order = [...this.links.values()];
    if (order.length === 0) return;
    const active = document.activeElement;
    const current = active instanceof HTMLAnchorElement ? order.indexOf(active) : -1;

    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (current + 1) % order.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (current - 1 + order.length) % order.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = order.length - 1;
    if (next === -1) return;

    e.preventDefault();
    order[next]?.focus();
  }
}
