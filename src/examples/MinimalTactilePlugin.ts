import type { Device } from "../core/Device.js";
import type { Plugin, PluginContext, WorkflowHandler } from "../plugins/types.js";
import { VirtualDevice } from "../devices/VirtualDevice.js";
import { textToDots } from "../workflows/tactile.js";

/**
 * MinimalTactilePlugin — the smallest complete walkthrough of the AutoSD
 * plugin architecture. It demonstrates every stage of the contributor path:
 *
 *   Plugin interface → manifest fields (id/version/description) → registration
 *   (PluginRegistry via PluginHost) → VirtualDevice render → diagnostics-safe
 *   result → tests (tests/examples/minimal-tactile-plugin.test.ts).
 *
 * Guarantees:
 * - Deterministic: same input text + same device state produce identical
 *   results. No timestamps, random ids, network, or API keys.
 * - Software-only: runs on VirtualDevice or MockDevice; never requires HID.
 * - Metadata-only output: safe to paste into GitHub issues (passes the
 *   diagnostics sanitizer without redaction).
 * - Removable: delete this file and its test — nothing else references them,
 *   and no core code changes are required.
 *
 * Usage:
 *
 *   import { PluginHost } from "../plugins/PluginHost.js";
 *   import { VirtualDevice } from "../devices/VirtualDevice.js";
 *   import { MinimalTactilePlugin } from "./MinimalTactilePlugin.js";
 *
 *   const host = new PluginHost();
 *   const device = new VirtualDevice();
 *   await device.connect();
 *   host.registry.register(new MinimalTactilePlugin(device));
 *   await host.registry.activate("minimal-tactile");
 *   const result = await host.runWorkflow("minimal-tactile:render", {
 *     text: "hello",
 *   });
 */
export type MinimalTactilePayload = {
  readonly text?: string;
};

export type MinimalTactileResult = {
  readonly pluginId: string;
  readonly version: string;
  readonly workflowId: string;
  readonly device: { readonly id: string; readonly kind: string };
  readonly dotCount: number;
  /** Active dots in the pattern that was requested to render. */
  readonly activeDots: number;
  /**
   * Pattern that was sent to render(pattern) — always known.
   */
  readonly pattern: readonly number[];
  /**
   * Framebuffer read-back right after render, or null when the device does
   * not support post-render reads. Note: VirtualDevice round-trips
   * render→read; MockDevice.read() only reflects write(), so it returns
   * null here. This difference is part of the documented contract.
   */
  readonly framebuffer: readonly number[] | null;
};

export const MINIMAL_TACTILE_WORKFLOW_ID = "minimal-tactile:render";

export class MinimalTactilePlugin implements Plugin {
  readonly id = "minimal-tactile";
  readonly version = "1.0.0";
  readonly description =
    "Renders text onto a Device and reports a diagnostics-safe snapshot. Teaches the full plugin path.";

  private ctx?: PluginContext;

  constructor(
    private readonly device: Device = new VirtualDevice(
      "minimal-tactile-device",
      "MinimalTactileDevice",
    ),
  ) {}

  activate(ctx: PluginContext): void {
    this.ctx = ctx;
    const handler: WorkflowHandler = async (payload: unknown) => {
      const input = (payload ?? {}) as MinimalTactilePayload;
      if (this.device.info.status !== "connected") await this.device.connect();
      const dotCount = this.device.info.capabilities.dotCount ?? 40;
      const pattern = textToDots(input.text ?? "hello autosd", dotCount);
      await this.device.render(pattern);
      const snapshot = await this.device.read();
      const result: MinimalTactileResult = {
        pluginId: this.id,
        version: this.version,
        workflowId: MINIMAL_TACTILE_WORKFLOW_ID,
        device: { id: this.device.info.id, kind: this.device.info.kind },
        dotCount,
        activeDots: [...pattern].filter(v => v > 0).length,
        pattern: Array.from(pattern),
        framebuffer: snapshot ? Array.from(snapshot) : null,
      };
      return result;
    };
    ctx.api.registerWorkflow(MINIMAL_TACTILE_WORKFLOW_ID, handler);
  }

  deactivate(): void {
    this.ctx?.api.unregisterWorkflow(MINIMAL_TACTILE_WORKFLOW_ID);
    this.ctx = undefined;
  }
}
