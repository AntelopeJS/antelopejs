import type { ConfigVarProvider } from "@antelopejs/interface-core/config";

export enum ModuleState {
  Loaded = "loaded",
  Constructed = "constructed",
  Active = "active",
}

export interface ModuleCallbacks {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Published lifecycle callbacks accept application-defined configuration; narrowing this parameter changes the callback contract.
  construct?(config: unknown): Promise<void> | void;
  destroy?(): Promise<void> | void;
  provide?: ConfigVarProvider;
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
}
