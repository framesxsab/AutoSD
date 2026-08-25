/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { VirtualList } from "../../src/ui/VirtualList.js";

describe("VirtualList", () => {
  it("virtualizes long lists and lazy renders", () => {
    const list = new VirtualList<string>({
      itemHeight: 30,
      containerHeight: 90,
      overscan: 1,
      renderItem: item => {
        const el = document.createElement("div");
        el.textContent = item;
        el.setAttribute("role", "listitem");
        return el;
      },
    });
    const parent = document.createElement("div");
    list.mount(parent);
    expect(parent.querySelector('[role="list"]')).not.toBeNull();
    list.setItems(Array.from({ length: 100 }, (_, i) => `item ${i}`));
    const el = list.getElement();
    expect(el.style.height).toBe("90px");
    expect(el.children.length).toBeGreaterThan(0);
    el.scrollTop = 60;
    el.dispatchEvent(new Event("scroll"));
    expect(el.children.length).toBeGreaterThan(0);
  });

  it("exposes logical rowcount and posinset for full collection", () => {
    const list = new VirtualList<string>({
      itemHeight: 20,
      containerHeight: 60,
      renderItem: item => {
        const el = document.createElement("div");
        el.textContent = item;
        return el;
      },
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    list.mount(parent);
    list.setItems(Array.from({ length: 20 }, (_, i) => `row ${i}`));
    const container = list.getElement();
    expect(container.getAttribute("aria-rowcount")).toBe("20");
    const first = container.querySelector<HTMLElement>('[aria-posinset="1"]');
    expect(first).not.toBeNull();
    expect(first?.getAttribute("aria-setsize")).toBe("20");
    const third = container.querySelector<HTMLElement>('[aria-posinset="3"]');
    expect(third?.getAttribute("aria-setsize")).toBe("20");
    expect(container.querySelectorAll("[aria-posinset]").length).toBeLessThan(20);
    parent.remove();
  });

  it("keyboard navigation and focus remains stable across virtualization", () => {
    const list = new VirtualList<string>({
      itemHeight: 20,
      containerHeight: 60,
      renderItem: item => {
        const el = document.createElement("div");
        el.textContent = item;
        return el;
      },
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    list.mount(parent);
    list.setItems(Array.from({ length: 20 }, (_, i) => `item ${i}`));
    const container = list.getElement();
    const first = container.querySelector<HTMLElement>('[aria-posinset="1"]')!;
    first.focus();
    expect(document.activeElement).toBe(first);
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement?.getAttribute("aria-posinset")).toBe("2");
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement?.getAttribute("aria-posinset")).toBe("20");
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement?.getAttribute("aria-posinset")).toBe("1");
    parent.remove();
  });
});
