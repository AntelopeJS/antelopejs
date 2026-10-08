/** An interface package, as far as binding is concerned. */
export interface BindingInterface {
  name: string;
  /** Interface packages this package imports, read from its manifest. */
  dependencies: readonly string[];
}

/** One `importOverrides` entry of a module. */
export interface BindingConnection {
  id?: string;
  source?: string;
}

/** A module, as far as binding is concerned. */
export interface BindingModule {
  id: string;
  /** Interfaces the module provides (its `implements`, minus `disabledExports`). */
  implements: readonly string[];
  /** Interface packages the module depends on directly. */
  uses: readonly string[];
  /** `importOverrides` entries, in configured order, keyed by interface. */
  connections: ReadonlyMap<string, readonly BindingConnection[]>;
  /**
   * The connections the module lists for each interface, in order: its
   * `importOverrides` entries, or every provider when it has none. Defaults
   * to `connections`.
   */
  listedConnections?: ReadonlyMap<string, readonly BindingConnection[]>;
  /** Priority as the default provider, keyed by interface. */
  exportPriority: ReadonlyMap<string, number>;
}

export interface BindingGraphInput {
  interfaces: ReadonlyMap<string, BindingInterface>;
  modules: ReadonlyMap<string, BindingModule>;
  /** Bindings of modules already running, which a rerun must not change. */
  running?: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

type BindingReason =
  | "implements"
  | "pin"
  | "running"
  | "carried"
  | "default"
  | "self-hosted";

/** How one module binds one interface. */
export interface InterfaceBinding {
  provider?: string;
  reason: BindingReason;
  /** The module whose pin was carried, for a carried binding. */
  source?: string;
}

/** One interface instance: provided (`X@P`) or self-hosted (`X{…}`). */
export interface InstanceDescriptor {
  key: string;
  interfaceName: string;
  provider?: string;
  /** Instance keys a self-hosted instance imports. */
  dependencies: readonly string[];
}

export interface ModuleBindings {
  scope: ReadonlyMap<string, InterfaceBinding>;
  /** Instance key of every interface the module imports, directly or through self-hosted ones. */
  keys: ReadonlyMap<string, string>;
  /**
   * For each interface with `importOverrides` entries, the instance key each
   * entry names, in entry order. A named entry is keyed in its connection's
   * scope: every interface with an entry of that id is bound to that entry.
   */
  connectionKeys: ReadonlyMap<string, readonly string[]>;
}

export interface BindingGraph {
  modules: ReadonlyMap<string, ModuleBindings>;
  instances: ReadonlyMap<string, InstanceDescriptor>;
  /** Provider modules each module reaches. */
  edges: ReadonlyMap<string, ReadonlySet<string>>;
  errors: readonly string[];
  warnings: readonly string[];
}
