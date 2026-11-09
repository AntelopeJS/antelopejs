import type { ConfigVars } from "@antelopejs/interface-core/config";

import { type PathMatcher, type ResolvedPackage } from "../../utils";
import { type ConfigVarPlan, ConfigVarStore } from "../config";
import {
  type InterfaceRangeConflict,
  type PreloadedInterfaceCopy,
} from "../output";
import type {
  BindingGraph,
  BindingInterface,
  BindingModule,
  UnresolvedInterface,
} from "../resolution";
import {
  type InterfaceConnectionRef,
  InterfaceRegistry,
} from "./interface-registry";
import { Module } from "./module";
import { ModuleIsolation } from "./module-isolation";
import type { ModuleManager } from "./module-manager";
import { type ModuleManifest } from "./module-manifest";
import { ModuleRegistry } from "./module-registry";
import { ModuleTracker } from "./module-tracker";
import { Resolver } from "./resolver";
import { ResolverDetour } from "./resolver-detour";
import { bindOperations } from "./module-manager-operations";

export interface ModuleConfig {
  config?: unknown;
  importOverrides?: Map<string, InterfaceConnectionRef[]>;
  disabledExports?: Set<string>;
  exportPriority?: Map<string, number>;
  /** Started after the others; a failure leaves the project running. */
  optional?: boolean;
}

export interface ManagedModule {
  module: Module;
  config: ModuleConfig;
}

export interface InterfacePackageConsumer {
  moduleId: string;
  range: string;
  resolvedPackage?: ResolvedPackage;
}

export interface StubbedInterfacePackage {
  canonicalPackage: ResolvedPackage;
  provider: string;
}

export interface InterfacePackagePlan {
  canonicalPackage: ResolvedPackage;
  provider?: string;
  consumers: InterfacePackageConsumer[];
}

export type ModuleOperation = (module: Module) => Promise<void>;

export interface ProvidePhaseResult {
  errors: unknown[];
  failed: Set<string>;
}

export interface ModuleOperationResults {
  errors: unknown[];
  failed: ManagedModule[];
}

interface ManagerFields {
  registry: ModuleRegistry;
  resolver: Resolver;
  interfaceRegistry: InterfaceRegistry;
  moduleTracker: ModuleTracker;
  resolverDetour: ResolverDetour;
  resolvedAssociations: Map<string, Set<string>>;
  resolvedConnections: Map<string, Map<string, InterfaceConnectionRef[]>>;
  selectedProviders: Map<string, Map<string, string>>;
  staticModules: ManagedModule[];
  loaded: Map<string, ManagedModule>;
  stubbedInterfacePackages: Map<string, StubbedInterfacePackage>;
  interfacePackagePlans: Map<string, InterfacePackagePlan>;
  configVars: ConfigVarStore;
  pendingCleanup: ManagedModule[];
  /**
   * Set once `stopAll` or `destroyAll` begins. A closed manager provides and
   * constructs nothing more: a module it constructed then would outlive
   * every destroy.
   */
  closed: boolean;
  /** Constructs that passed the `closed` check and have not settled. */
  constructing: Set<Promise<void>>;
  bindingGraph: BindingGraph | undefined;
  isolation: ModuleIsolation;
  startupOrder: string[];
}
export interface ManagerMethods {
  addStaticModule(entry: {
    manifest: ModuleManifest;
    config?: ModuleConfig;
  }): void;
  addModules(
    entries: Array<{
      manifest: ModuleManifest;
      config?: ModuleConfig;
    }>,
  ): ManagedModule[];
  restoreModules(
    replaced: ReadonlyMap<string, ManagedModule | undefined>,
  ): void;
  /**
   * Drops modules that failed to construct or start, already destroyed, so
   * that what they would have consumed or provided no longer counts in the
   * next interface checks and bindings.
   */
  discardModules(ids: readonly string[]): void;
  listModules(): string[];
  getModule(id: string): Module | undefined;
  getModuleEntry(id: string): ManagedModule | undefined;
  getLoadedModuleEntry(id: string): ManagedModule | undefined;
  getLoadedModules(): IterableIterator<ManagedModule>;
  getAllManagedModules(): ManagedModule[];
  unrequireModuleFiles(
    moduleId: string,
    shouldPreserveInterfaceGraph?: boolean,
  ): void;
  evictModuleFiles(
    moduleId: string,
    shouldPreserveInterfaceGraph: boolean,
  ): void;
  collectAvoidedFolders(
    moduleId: string,
    moduleFolder: string,
    isInModule: PathMatcher,
  ): string[];
  belongsToInterfacePackageTree(
    filePath: string,
    isInModule: PathMatcher,
  ): boolean;
  /** Sets the folder that instance copies of module packages are created under. */
  setInstanceRoot(root: string): void;
  /**
   * The manifest a module should be loaded from: its own, or an instance copy
   * of its folder when another loaded module already runs from that folder.
   */
  placeModule(moduleId: string, manifest: ModuleManifest): ModuleManifest;
  /**
   * Refuses the reload of `moduleId` into `replacement` when the replacement
   * would change the binding of another running module, before anything of
   * the running generation is torn down.
   */
  checkReplacement(moduleId: string, replacement: Module): void;
  /** Deletes the instance copy behind a placed manifest that will not run. */
  discardPlacedModule(manifest: ModuleManifest): void;
  replaceLoadedModule(id: string, module: Module): ManagedModule | undefined;
  refreshAssociations(): void;
  hasResolvedInterface(moduleId: string, interfaceName: string): boolean;
  registerStubbedInterfaces(stubbed: UnresolvedInterface[]): void;
  registerStubbedInterfacePackage(
    packageName: string,
    entries: UnresolvedInterface[],
  ): void;
  applyInterfaceStubs(): void;
  neutralizeInstances(interfaceName: string): void;
  collectImplementedInterfaces(): Set<string>;
  constructAll(): Promise<void>;
  constructModules(modules: ManagedModule[]): Promise<void>;
  startAll(): Promise<void>;
  startModules(modules: ManagedModule[]): Promise<void>;
  stopAll(): Promise<void>;
  destroyAll(): Promise<void>;
  constructModule(entry: ManagedModule): Promise<void>;
  planConfigVars(modules: ManagedModule[]): ConfigVarPlan;
  runProvidePhase(
    modules: ManagedModule[],
    plan: ConfigVarPlan,
  ): Promise<ProvidePhaseResult>;
  constructReadyModules(
    modules: ManagedModule[],
    plan: ConfigVarPlan,
    failed: Set<string>,
  ): Promise<unknown[]>;
  constructOrDisable(entry: ManagedModule, dead: Set<string>): Promise<void>;
  rejectCallsIntoDeadModules(
    dead: ReadonlySet<string>,
    targets: Iterable<string>,
  ): void;
  orphanedInterfaces(entry: ManagedModule, dead: ReadonlySet<string>): string[];
  hasLiveImplementer(interfaceName: string, dead: ReadonlySet<string>): boolean;
  rejectCallsInto(moduleId: string, interfaceName: string): void;
  findFailedProvider(
    plan: ConfigVarPlan,
    moduleId: string,
    failed: Set<string>,
  ): string | undefined;
  provideEntry(entry: ManagedModule): Promise<void>;
  provideModule(entry: ManagedModule): Promise<ConfigVars | void>;
  constructEntry(entry: ManagedModule): Promise<void>;
  getReverseLifecycleModules(): ManagedModule[];
  clearManagedState(): unknown[];
  releaseRuntimeState(): unknown[];
  trackModuleStart(moduleId: string): void;
  /** How every module binds its interfaces, as of the last association rebuild. */
  getBindingGraph(): BindingGraph | undefined;
  rebuildAssociations(): void;
  buildBindings(): void;
  runningBindings(): Map<string, Map<string, string>>;
  logBindingWarnings(): void;
  bindablePackages(): Set<string>;
  collectBindingInterfaces(): Map<string, BindingInterface>;
  collectBindingModules(): Map<string, BindingModule>;
  collectInterfaceSources(): Map<string, Module[]>;
  resolveInterfacePackagePaths(interfaceSources: Map<string, Module[]>): void;
  resolveImplementedPackage(
    packageName: string,
    module: Module,
  ): ResolvedPackage | undefined;
  collectInterfacePackageConsumers(
    packageName: string,
  ): InterfacePackageConsumer[];
  registerInterfacePackage(
    packageName: string,
    resolvedPackage: ResolvedPackage,
    isStubbed?: boolean,
  ): void;
  validateInterfacePackages(): void;
  findInterfaceRangeConflicts(): InterfaceRangeConflict[];
  findRangeConflicts(
    packageName: string,
    plan: InterfacePackagePlan,
  ): InterfaceRangeConflict[];
  findPreloadedCopies(
    packageName: string,
    plan: InterfacePackagePlan,
  ): PreloadedInterfaceCopy[];
  buildModuleAssociations(interfaceSources: Map<string, Module[]>): void;
  addDefaultAssociations(
    module: Module,
    connections: Map<string, InterfaceConnectionRef[]>,
    selected: Map<string, string>,
    interfaceSources: Map<string, Module[]>,
  ): void;
  applyImportOverrides(
    moduleId: string,
    importOverrides: Map<string, InterfaceConnectionRef[]> | undefined,
    connections: Map<string, InterfaceConnectionRef[]>,
    selected: Map<string, string | undefined>,
  ): void;
  addInterfaceSource(
    sources: Map<string, Module[]>,
    interfaceName: string,
    module: Module,
  ): void;
  validateImportOverrides(
    consumerId: string,
    interfaceName: string,
    overrides: InterfaceConnectionRef[],
  ): void;
  validateOverrideSource(
    consumerId: string,
    interfaceName: string,
    source: string | undefined,
  ): void;
  validateSelfHostedConnection(consumerId: string, interfaceName: string): void;
}
type ContextMethods = Pick<
  ManagerMethods,
  | "restoreModules"
  | "getModuleEntry"
  | "getAllManagedModules"
  | "evictModuleFiles"
  | "collectAvoidedFolders"
  | "belongsToInterfacePackageTree"
  | "placeModule"
  | "registerStubbedInterfacePackage"
  | "applyInterfaceStubs"
  | "neutralizeInstances"
  | "collectImplementedInterfaces"
  | "startModules"
  | "destroyAll"
  | "constructModule"
  | "planConfigVars"
  | "runProvidePhase"
  | "constructReadyModules"
  | "constructOrDisable"
  | "rejectCallsIntoDeadModules"
  | "orphanedInterfaces"
  | "hasLiveImplementer"
  | "rejectCallsInto"
  | "findFailedProvider"
  | "provideEntry"
  | "provideModule"
  | "constructEntry"
  | "getReverseLifecycleModules"
  | "clearManagedState"
  | "releaseRuntimeState"
  | "trackModuleStart"
  | "rebuildAssociations"
  | "buildBindings"
  | "runningBindings"
  | "logBindingWarnings"
  | "bindablePackages"
  | "collectBindingInterfaces"
  | "collectBindingModules"
  | "collectInterfaceSources"
  | "resolveInterfacePackagePaths"
  | "resolveImplementedPackage"
  | "collectInterfacePackageConsumers"
  | "registerInterfacePackage"
  | "validateInterfacePackages"
  | "findInterfaceRangeConflicts"
  | "findRangeConflicts"
  | "findPreloadedCopies"
  | "buildModuleAssociations"
  | "addDefaultAssociations"
  | "applyImportOverrides"
  | "addInterfaceSource"
  | "validateImportOverrides"
  | "validateOverrideSource"
  | "validateSelfHostedConnection"
>;
export type ManagerContext = ManagerFields & ContextMethods;
type FieldReaders = { [K in keyof ManagerFields]: () => ManagerFields[K] };
interface FieldWriters {
  pendingCleanup: (value: ManagerFields["pendingCleanup"]) => void;
  bindingGraph: (value: ManagerFields["bindingGraph"]) => void;
  startupOrder: (value: ManagerFields["startupOrder"]) => void;
  closed: (value: ManagerFields["closed"]) => void;
}
interface ManagerContextParts {
  fields: FieldReaders;
  writers: FieldWriters;
  methods: ContextMethods;
}
type ContextPartsReader = (manager: ModuleManager) => ManagerContextParts;
const implementations = new WeakMap<ModuleManager, ManagerMethods>();
let readContextParts: ContextPartsReader | undefined;
export function defineManagerContext(reader: ContextPartsReader): void {
  readContextParts = reader;
}
export function operations(manager: ModuleManager): ManagerMethods {
  const existing = implementations.get(manager);
  if (existing) {
    return existing;
  }
  const created = bindOperations(createContext(readContextParts!(manager)));
  implementations.set(manager, created);
  return created;
}
function createContext({
  fields,
  writers,
  methods,
}: ManagerContextParts): ManagerContext {
  return {
    ...methods,
    get registry() {
      return fields.registry();
    },
    get resolver() {
      return fields.resolver();
    },
    get interfaceRegistry() {
      return fields.interfaceRegistry();
    },
    get moduleTracker() {
      return fields.moduleTracker();
    },
    get resolverDetour() {
      return fields.resolverDetour();
    },
    get resolvedAssociations() {
      return fields.resolvedAssociations();
    },
    get resolvedConnections() {
      return fields.resolvedConnections();
    },
    get selectedProviders() {
      return fields.selectedProviders();
    },
    get staticModules() {
      return fields.staticModules();
    },
    get loaded() {
      return fields.loaded();
    },
    get stubbedInterfacePackages() {
      return fields.stubbedInterfacePackages();
    },
    get interfacePackagePlans() {
      return fields.interfacePackagePlans();
    },
    get configVars() {
      return fields.configVars();
    },
    get pendingCleanup() {
      return fields.pendingCleanup();
    },
    set pendingCleanup(value) {
      writers.pendingCleanup(value);
    },
    get closed() {
      return fields.closed();
    },
    set closed(value) {
      writers.closed(value);
    },
    get constructing() {
      return fields.constructing();
    },
    get bindingGraph() {
      return fields.bindingGraph();
    },
    set bindingGraph(value) {
      writers.bindingGraph(value);
    },
    get isolation() {
      return fields.isolation();
    },
    get startupOrder() {
      return fields.startupOrder();
    },
    set startupOrder(value) {
      writers.startupOrder(value);
    },
  };
}
