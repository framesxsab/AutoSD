import type { Plugin, PluginContext, WorkflowHandler } from "../plugins/types.js";

/**
 * ExamplePlugin — a minimal, complete AutoSD plugin.
 *
 * It registers one workflow ("example:echo") on activate and unregisters it
 * on deactivate so hotSwap stays clean. Copy this file as a starting point
 * for your own plugin. See docs/PLUGIN_GUIDE.md for the full lifecycle.
 *
 * Usage with PluginHost:
 *
 *   const host = new PluginHost();
 *   host.registry.register(new ExamplePlugin());
 *   await host.registry.activate("example-echo");
 *   const reply = await host.runWorkflow("example:echo", { message: "hi" });
 */
export type EchoPayload = {
  readonly message?: string;
};

export type EchoResult = {
  readonly pluginId: string;
  readonly version: string;
  readonly echoed: string;
};

export class ExamplePlugin implements Plugin {
  readonly id = "example-echo";
  readonly version = "0.1.0";
  readonly description = "Echoes a message back; demonstrates activate/deactivate and workflows.";

  private ctx?: PluginContext;

  activate(ctx: PluginContext): void {
    this.ctx = ctx;
    const handler: WorkflowHandler = (payload: unknown) => {
      const input = (payload ?? {}) as EchoPayload;
      const result: EchoResult = {
        pluginId: this.id,
        version: this.version,
        echoed: input.message ?? "hello from AutoSD",
      };
      return result;
    };
    ctx.api.registerWorkflow("example:echo", handler);
  }

  deactivate(): void {
    // Undo exactly what activate did so hot-swap leaves no residue.
    this.ctx?.api.unregisterWorkflow("example:echo");
    this.ctx = undefined;
  }
}
