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
  provide?: ConfigVarProvider;
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
}
