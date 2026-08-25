import { describe, it, expect } from "vitest";
import { Registry } from "../../src/core/Registry.js";
import { DIContainer } from "../../src/core/DIContainer.js";
import { PluginHost } from "../../src/plugins/PluginHost.js";

describe("Registry hot-swap", () => {
  it("emits swapped on duplicate register", () => {
    const r = new Registry<string>();
    let swapped = false;
    r.on("swapped", () => (swapped = true));
    r.register("a", "first");
    r.register("a", "second");
    expect(swapped).toBe(true);
    expect(r.get("a")).toBe("second");
  });
});

describe("DIContainer hotSwap", () => {
  it("resolves new factory after hotSwap", () => {
    const c = new DIContainer();
    c.register("token", () => ({ v: 1 }));
    expect(c.resolve<{ v: number }>("token").v).toBe(1);
    c.hotSwap("token", () => ({ v: 2 }));
    expect(c.resolve<{ v: number }>("token").v).toBe(2);
  });
});

describe("PluginHost hotSwap", () => {
  it("replaces plugin and re-activates", async () => {
    const host = new PluginHost("0.3.0");
    host.registry.register({
      id: "p1",
      version: "1.0.0",
      activate: ctx => ctx.api.registerWorkflow("w1", () => "v1"),
    });
    await host.registry.activate("p1");
    expect(host.hasWorkflow("w1")).toBe(true);
    await host.registry.hotSwap({
      id: "p1",
      version: "2.0.0",
      activate: ctx => ctx.api.registerWorkflow("w1", () => "v2"),
    });
    expect(await host.runWorkflow("w1", null)).toBe("v2");
  });
});
