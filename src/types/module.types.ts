export enum ModuleState {
  Loaded = "loaded",
  Constructed = "constructed",
  Active = "active",
}

export interface ModuleCallbacks {
  construct?(config: unknown): Promise<void> | void;
  destroy?(): Promise<void> | void;
  start?(): void;
  stop?(): Promise<void> | void;
}
