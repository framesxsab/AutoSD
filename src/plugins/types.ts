/**
 * Plugin contract — additive only. All fields optional except id + activate.
 */

export type PluginContext = {
  readonly appVersion: string;
  readonly api: {
    registerWorkflow: (id: string, handler: WorkflowHandler) => void;
    unregisterWorkflow: (id: string) => void;
  };
};

export type WorkflowHandler = (payload: unknown) => Promise<unknown> | unknown;

export interface Plugin {
  readonly id: string;
  readonly version: string;
  readonly description?: string;
  activate(ctx: PluginContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}

export type PluginState = "registered" | "active" | "inactive" | "error";

export type PluginEntry = {
  plugin: Plugin;
  state: PluginState;
  error?: Error;
};
