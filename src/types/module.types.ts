import type { ConfigVars } from "@antelopejs/interface-core/config";

export enum ModuleState {
  Loaded = "loaded",
  Constructed = "constructed",
  Active = "active",
}

export interface ModuleCallbacks {
  construct?(config: unknown): Promise<ConfigVars | void> | ConfigVars | void;
  destroy?(): Promise<void> | void;
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
}
