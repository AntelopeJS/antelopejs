import type { ConfigVarProvider } from "@antelopejs/interface-core/config";

export enum ModuleState {
  Loaded = "loaded",
  Constructed = "constructed",
  Active = "active",
}

export interface ModuleCallbacks {
  construct?(config: unknown): Promise<void> | void;
  destroy?(): Promise<void> | void;
  provide?: ConfigVarProvider;
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
}
