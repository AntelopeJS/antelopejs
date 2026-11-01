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
import * as bindings from "./module-manager-bindings";
import * as cache from "./module-manager-cache";
import * as construction from "./module-manager-construction";
import * as lifecycle from "./module-manager-lifecycle";
import * as packages from "./module-manager-packages";
import * as records from "./module-manager-records";
import { type ModuleManifest } from "./module-manifest";
import { ModuleRegistry } from "./module-registry";
import { ModuleTracker } from "./module-tracker";
import { Resolver } from "./resolver";
import { ResolverDetour } from "./resolver-detour";

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
  constructModule(
    module: Module,
    config: Parameters<Module["construct"]>[0],
  ): Promise<void>;
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
  provideModule(
    module: Module,
    config: Parameters<Module["provide"]>[0],
  ): Promise<ConfigVars | void>;
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
export function bindOperations(context: ManagerContext): ManagerMethods {
  return {
    addStaticModule: records.addStaticModule.bind(context),
    addModules: records.addModules.bind(context),
    restoreModules: records.restoreModules.bind(context),
    discardModules: records.discardModules.bind(context),
    listModules: records.listModules.bind(context),
    getModule: records.getModule.bind(context),
    getModuleEntry: records.getModuleEntry.bind(context),
    getLoadedModuleEntry: records.getLoadedModuleEntry.bind(context),
    getLoadedModules: records.getLoadedModules.bind(context),
    getAllManagedModules: records.getAllManagedModules.bind(context),
    unrequireModuleFiles: cache.unrequireModuleFiles.bind(context),
    evictModuleFiles: cache.evictModuleFiles.bind(context),
    collectAvoidedFolders: cache.collectAvoidedFolders.bind(context),
    belongsToInterfacePackageTree:
      cache.belongsToInterfacePackageTree.bind(context),
    setInstanceRoot: records.setInstanceRoot.bind(context),
    placeModule: records.placeModule.bind(context),
    checkReplacement: bindings.checkReplacement.bind(context),
    discardPlacedModule: records.discardPlacedModule.bind(context),
    replaceLoadedModule: records.replaceLoadedModule.bind(context),
    refreshAssociations: bindings.refreshAssociations.bind(context),
    hasResolvedInterface: bindings.hasResolvedInterface.bind(context),
    registerStubbedInterfaces: packages.registerStubbedInterfaces.bind(context),
    registerStubbedInterfacePackage:
      packages.registerStubbedInterfacePackage.bind(context),
    applyInterfaceStubs: packages.applyInterfaceStubs.bind(context),
    neutralizeInstances: packages.neutralizeInstances.bind(context),
    collectImplementedInterfaces:
      packages.collectImplementedInterfaces.bind(context),
    constructAll: construction.constructAll.bind(context),
    constructModules: construction.constructModules.bind(context),
    startAll: lifecycle.startAll.bind(context),
    startModules: lifecycle.startModules.bind(context),
    stopAll: lifecycle.stopAll.bind(context),
    destroyAll: lifecycle.destroyAll.bind(context),
    constructModule: construction.constructModule.bind(context),
    planConfigVars: construction.planConfigVars.bind(context),
    runProvidePhase: construction.runProvidePhase.bind(context),
    constructReadyModules: construction.constructReadyModules.bind(context),
    constructOrDisable: construction.constructOrDisable.bind(context),
    rejectCallsIntoDeadModules:
      construction.rejectCallsIntoDeadModules.bind(context),
    orphanedInterfaces: construction.orphanedInterfaces.bind(context),
    hasLiveImplementer: construction.hasLiveImplementer.bind(context),
    rejectCallsInto: construction.rejectCallsInto.bind(context),
    findFailedProvider: construction.findFailedProvider.bind(context),
    provideEntry: construction.provideEntry.bind(context),
    provideModule: construction.provideModule.bind(context),
    constructEntry: construction.constructEntry.bind(context),
    getReverseLifecycleModules:
      lifecycle.getReverseLifecycleModules.bind(context),
    clearManagedState: lifecycle.clearManagedState.bind(context),
    releaseRuntimeState: lifecycle.releaseRuntimeState.bind(context),
    trackModuleStart: lifecycle.trackModuleStart.bind(context),
    getBindingGraph: bindings.getBindingGraph.bind(context),
    rebuildAssociations: bindings.rebuildAssociations.bind(context),
    buildBindings: bindings.buildBindings.bind(context),
    runningBindings: bindings.runningBindings.bind(context),
    logBindingWarnings: bindings.logBindingWarnings.bind(context),
    bindablePackages: bindings.bindablePackages.bind(context),
    collectBindingInterfaces: bindings.collectBindingInterfaces.bind(context),
    collectBindingModules: bindings.collectBindingModules.bind(context),
    collectInterfaceSources: bindings.collectInterfaceSources.bind(context),
    resolveInterfacePackagePaths:
      packages.resolveInterfacePackagePaths.bind(context),
    resolveImplementedPackage: packages.resolveImplementedPackage.bind(context),
    collectInterfacePackageConsumers:
      packages.collectInterfacePackageConsumers.bind(context),
    registerInterfacePackage: packages.registerInterfacePackage.bind(context),
    validateInterfacePackages: packages.validateInterfacePackages.bind(context),
    findInterfaceRangeConflicts:
      packages.findInterfaceRangeConflicts.bind(context),
    findRangeConflicts: packages.findRangeConflicts.bind(context),
    findPreloadedCopies: packages.findPreloadedCopies.bind(context),
    buildModuleAssociations: bindings.buildModuleAssociations.bind(context),
    addDefaultAssociations: bindings.addDefaultAssociations.bind(context),
    applyImportOverrides: bindings.applyImportOverrides.bind(context),
    addInterfaceSource: bindings.addInterfaceSource.bind(context),
    validateImportOverrides: bindings.validateImportOverrides.bind(context),
    validateOverrideSource: bindings.validateOverrideSource.bind(context),
    validateSelfHostedConnection:
      bindings.validateSelfHostedConnection.bind(context),
  };
}
