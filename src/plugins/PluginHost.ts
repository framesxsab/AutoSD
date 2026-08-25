import { PluginRegistry } from "./PluginRegistry.js";
import type { PluginContext, WorkflowHandler } from "./types.js";

export class PluginHost {
  readonly registry: PluginRegistry;
  private workflows = new Map<string, WorkflowHandler>();

  constructor(appVersion = "0.3.0") {
    const ctx: PluginContext = {
      appVersion,
      api: {
        registerWorkflow: (id, handler) => this.workflows.set(id, handler),
        unregisterWorkflow: id => this.workflows.delete(id),
      },
    };
    this.registry = new PluginRegistry(ctx);
  }

  async runWorkflow(id: string, payload: unknown): Promise<unknown> {
    const handler = this.workflows.get(id);
    if (!handler) throw new Error(`Workflow "${id}" not found`);
    return handler(payload);
  }

  hasWorkflow(id: string): boolean {
    return this.workflows.has(id);
  }

  listWorkflows(): string[] {
    return [...this.workflows.keys()];
  }
}
