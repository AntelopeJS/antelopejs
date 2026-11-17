import type { ConfigVarProvider } from "@antelopejs/interface-core/config";

export enum ModuleState {
  Loaded = "loaded",
  Constructed = "constructed",
  Active = "active",
}

export interface ModuleCallbacks {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- by the documented contract (docs/2.concepts/4.configuration.md, "Referencing") a RegExp, a Date or a class instance in a module's config comes out of substitution untouched, so no data type narrower than unknown describes the config a module receives
  construct?(config: unknown): Promise<void> | void;
  destroy?(): Promise<void> | void;
  /**
   * Lets the work in flight finish before any module stops, such as the
   * requests an HTTP server is still answering.
   *
   * The core calls it once when the project stops as a whole, at shutdown or
   * a full teardown, right after `Events.ModulesStopping`. It calls it only on
   * started modules, on all of them at once, and before any module's `stop()`,
   * so every module, providers included, is still running while it does. The
   * core waits at most 5 s for every drain together, then stops the modules
   * anyway. A drain that throws is logged and does not block the shutdown. It
   * never runs when one module is stopped, reloaded or removed at run time.
   */
  drain?(): Promise<void> | void;
  provide?: ConfigVarProvider;
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
}
