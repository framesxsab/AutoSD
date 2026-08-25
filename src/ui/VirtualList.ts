export type VirtualListOptions<T> = {
  itemHeight: number;
  containerHeight: number;
  overscan?: number;
  renderItem: (item: T, index: number) => HTMLElement;
};

export class VirtualList<T> {
  private container: HTMLElement;
  private scrollEl: HTMLElement;
  private items: T[] = [];
  private opts: Required<VirtualListOptions<T>>;

  constructor(opts: VirtualListOptions<T>) {
    this.opts = {
      itemHeight: opts.itemHeight,
      containerHeight: opts.containerHeight,
      overscan: opts.overscan ?? 3,
      renderItem: opts.renderItem,
    };
    this.container = document.createElement("div");
    this.container.setAttribute("role", "list");
    this.container.setAttribute("aria-label", "Virtualized results");
    this.container.style.height = `${this.opts.containerHeight}px`;
    this.container.style.overflowY = "auto";
    this.container.tabIndex = 0;

    this.scrollEl = document.createElement("div");
    this.scrollEl.style.position = "relative";
    this.container.appendChild(this.scrollEl);

    this.container.addEventListener("scroll", () => this.render());
    this.container.addEventListener("keydown", e => this.handleKeyDown(e));
  }

  setItems(items: T[]): void {
    this.items = [...items];
    this.container.setAttribute("aria-rowcount", String(this.items.length));
    this.scrollEl.style.height = `${this.items.length * this.opts.itemHeight}px`;
    this.render();
  }

  getElement(): HTMLElement {
    return this.container;
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.container);
  }

  private focusedIndex: number | null = null;

  private render(): void {
    const active = document.activeElement as HTMLElement | null;
    if (active && this.scrollEl.contains(active)) {
      const pos = active.getAttribute("aria-posinset");
      if (pos) this.focusedIndex = Number(pos) - 1;
    }

    const scrollTop = this.container.scrollTop;
    const start = Math.max(0, Math.floor(scrollTop / this.opts.itemHeight) - this.opts.overscan);
    const visibleCount =
      Math.ceil(this.opts.containerHeight / this.opts.itemHeight) + this.opts.overscan * 2;
    const end = Math.min(this.items.length, start + visibleCount);

    this.scrollEl.innerHTML = "";
    const offset = document.createElement("div");
    offset.style.height = `${start * this.opts.itemHeight}px`;
    offset.setAttribute("aria-hidden", "true");
    this.scrollEl.appendChild(offset);

    for (let i = start; i < end; i++) {
      const el = this.opts.renderItem(this.items[i], i);
      el.style.position = "relative";
      if (!el.hasAttribute("role")) el.setAttribute("role", "listitem");
      el.setAttribute("aria-posinset", String(i + 1));
      el.setAttribute("aria-setsize", String(this.items.length));
      if (!el.hasAttribute("aria-label") && !el.textContent?.trim()) {
        el.setAttribute("aria-label", `Item ${i + 1} of ${this.items.length}`);
      }
      if (this.focusedIndex === i) {
        el.tabIndex = 0;
      } else if (!el.hasAttribute("tabindex")) {
        el.tabIndex = -1;
      }
      this.scrollEl.appendChild(el);
    }

    const tail = document.createElement("div");
    tail.style.height = `${(this.items.length - end) * this.opts.itemHeight}px`;
    tail.setAttribute("aria-hidden", "true");
    this.scrollEl.appendChild(tail);

    if (this.focusedIndex !== null && this.focusedIndex >= start && this.focusedIndex < end) {
      const toFocus = this.scrollEl.querySelector<HTMLElement>(
        `[aria-posinset="${this.focusedIndex + 1}"]`,
      );
      toFocus?.focus();
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const current = document.activeElement as HTMLElement | null;
    let currentPos = this.focusedIndex ?? -1;
    if (current && current.hasAttribute("aria-posinset")) {
      currentPos = Number(current.getAttribute("aria-posinset")) - 1;
    } else if (current && this.scrollEl.contains(current)) {
      const pos = current.getAttribute("aria-posinset");
      if (pos) currentPos = Number(pos) - 1;
    }

    let next = currentPos;
    if (e.key === "ArrowDown") next = Math.min(this.items.length - 1, currentPos + 1);
    if (e.key === "ArrowUp") next = Math.max(0, currentPos - 1);
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = this.items.length - 1;

    if (next < 0) next = 0;
    this.focusedIndex = next;

    const targetScroll = next * this.opts.itemHeight;
    const currentScroll = this.container.scrollTop;
    const visibleTop = currentScroll;
    const visibleBottom = currentScroll + this.opts.containerHeight;
    if (targetScroll < visibleTop || targetScroll + this.opts.itemHeight > visibleBottom) {
      this.container.scrollTop = Math.max(0, targetScroll - this.opts.itemHeight * 2);
      this.render();
    }

    const toFocus = this.scrollEl.querySelector<HTMLElement>(`[aria-posinset="${next + 1}"]`);
    toFocus?.focus();
  }
}
