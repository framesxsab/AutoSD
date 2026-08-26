import { describe, expect, it } from "vitest";
import { PluginHost } from "../../src/plugins/PluginHost.js";
import { MockDevice } from "../../src/devices/MockDevice.js";
import { VirtualDevice } from "../../src/devices/VirtualDevice.js";
import { textToDots } from "../../src/workflows/tactile.js";
import { collectDiagnostics, sanitize } from "../../src/app/diagnostics.js";
import {
  MINIMAL_TACTILE_WORKFLOW_ID,
  MinimalTactilePlugin,
} from "../../src/examples/MinimalTactilePlugin.js";
import type { MinimalTactileResult } from "../../src/examples/MinimalTactilePlugin.js";

/** Full plugin path: interface → manifest → registration → device → diagnostics → removal. */
describe("MinimalTactilePlugin (complete walkthrough)", () => {
  it("walks the full lifecycle: register → activate → run → deactivate", async () => {
    const host = new PluginHost();
    const plugin = new MinimalTactilePlugin(new VirtualDevice());

    host.registry.register(plugin);
    expect(host.registry.get(plugin.id)?.state).toBe("registered");

    await host.registry.activate(plugin.id);
    expect(host.registry.get(plugin.id)?.state).toBe("active");
    expect(host.hasWorkflow(MINIMAL_TACTILE_WORKFLOW_ID)).toBe(true);

    const result = (await host.runWorkflow(MINIMAL_TACTILE_WORKFLOW_ID, {
      text: "braille",
    })) as MinimalTactileResult;

    expect(result.pluginId).toBe("minimal-tactile");
    expect(result.version).toBe("1.0.0");
    expect(result.workflowId).toBe(MINIMAL_TACTILE_WORKFLOW_ID);
    expect(result.device.kind).toBe("virtual");
    expect(result.pattern.length).toBe(result.dotCount);
    expect(result.framebuffer).toEqual(result.pattern);

    await host.registry.deactivate(plugin.id);
    expect(host.registry.get(plugin.id)?.state).toBe("inactive");
    expect(host.hasWorkflow(MINIMAL_TACTILE_WORKFLOW_ID)).toBe(false);
  });

  it("renders onto the caller's VirtualDevice deterministically", async () => {
    const device = new VirtualDevice();
    const host = new PluginHost();
    host.registry.register(new MinimalTactilePlugin(device));
    await host.registry.activate("minimal-tactile");

    const run = () =>
      host.runWorkflow(MINIMAL_TACTILE_WORKFLOW_ID, {
        text: "determinism",
      }) as Promise<MinimalTactileResult>;

    const a = await run();
    const b = await run();

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.pattern).toEqual([...textToDots("determinism", 40)]);
    expect(a.framebuffer).toEqual(a.pattern);
    expect(await device.read()).toEqual(new Uint8Array(textToDots("determinism", 40)));
  });

  it("is contract-compatible with MockDevice (render→read does not round-trip there)", async () => {
    const device = new MockDevice();
    const host = new PluginHost();
    host.registry.register(new MinimalTactilePlugin(device));
    await host.registry.activate("minimal-tactile");

    const result = (await host.runWorkflow(MINIMAL_TACTILE_WORKFLOW_ID, {
      text: "mock",
    })) as MinimalTactileResult;

    expect(result.device.kind).toBe("mock");
    expect(result.pattern).toEqual([...(device.getLastPattern() ?? [])]);
    expect(result.framebuffer).toBeNull();
  });

  it("produces issue-safe metadata: sanitize redacts nothing, no volatile fields", async () => {
    const host = new PluginHost();
    host.registry.register(new MinimalTactilePlugin());
    await host.registry.activate("minimal-tactile");

    const result = (await host.runWorkflow(MINIMAL_TACTILE_WORKFLOW_ID, {
      text: "safe",
    })) as MinimalTactileResult;

    const sanitized = sanitize(result) as MinimalTactileResult;
    expect(sanitized).toEqual(result);
    expect(JSON.stringify(result)).not.toMatch(/created|generatedAt|sess-|token|secret/i);

    const report = collectDiagnostics();
    expect(report.services.hidAvailable).toBe(false);
  });

  it("hot-swaps cleanly without leaving workflow residue", async () => {
    const host = new PluginHost();
    const first = new MinimalTactilePlugin();
    host.registry.register(first);
    await host.registry.activate("minimal-tactile");

    await host.registry.hotSwap(new MinimalTactilePlugin(new VirtualDevice("swapped")));

    expect(host.registry.get("minimal-tactile")?.state).toBe("active");
    expect(host.hasWorkflow(MINIMAL_TACTILE_WORKFLOW_ID)).toBe(true);

    const result = (await host.runWorkflow(MINIMAL_TACTILE_WORKFLOW_ID, {
      text: "swap",
    })) as MinimalTactileResult;
    expect(result.device.id).toBe("swapped");
  });
});
