import { ConfigVarStore } from "../config";
import type { BindingGraph, UnresolvedInterface } from "../resolution";
import {
  type InterfaceConnectionRef,
  InterfaceRegistry,
} from "./interface-registry";
import { Module } from "./module";
import { ModuleIsolation } from "./module-isolation";
import {
  type InterfacePackagePlan,
  type ManagedModule,
  type ManagerMethods,
  type ModuleConfig,
  type StubbedInterfacePackage,
  defineManagerContext,
} from "./module-manager-context";
import { MANAGER_OPERATIONS } from "./module-manager-operations";
import { type ModuleManifest } from "./module-manifest";
import { ModuleRegistry } from "./module-registry";
import { ModuleTracker } from "./module-tracker";
import { PathMapper } from "./path-mapper";
import { Resolver } from "./resolver";
import { ResolverDetour } from "./resolver-detour";
export type { ManagedModule, ModuleConfig } from "./module-manager-context";

interface ModuleManagerDeps {
  registry?: ModuleRegistry;
  resolver?: Resolver;
  interfaceRegistry?: InterfaceRegistry;
  moduleTracker?: ModuleTracker;
}
export class ModuleManager {
  public readonly registry: ModuleRegistry;

  public readonly resolver: Resolver;

  private readonly interfaceRegistry: InterfaceRegistry;

  private readonly moduleTracker: ModuleTracker;

  private readonly resolverDetour: ResolverDetour;

  private readonly resolvedAssociations = new Map<string, Set<string>>();

  private readonly resolvedConnections = new Map<
    string,
    Map<string, InterfaceConnectionRef[]>
  >();

  private readonly staticModules: ManagedModule[] = [];

  private readonly loaded = new Map<string, ManagedModule>();

  private readonly stubbedInterfacePackages = new Map<
    string,
    StubbedInterfacePackage
  >();

  private readonly interfacePackagePlans = new Map<
    string,
    InterfacePackagePlan
  >();

  private readonly configVars = new ConfigVarStore();

  private pendingCleanup: ManagedModule[] = [];

  private closing?: Promise<void>;

  private readonly constructing = new Set<Promise<void>>();

  private bindingGraph?: BindingGraph;

  private readonly isolation = new ModuleIsolation();

  private startupOrder: string[] = [];
  constructor(deps: ModuleManagerDeps = {}) {
    this.registry = deps.registry ?? new ModuleRegistry();
    this.resolver = deps.resolver ?? new Resolver(new PathMapper());
    this.resolverDetour = new ResolverDetour(this.resolver);
    this.interfaceRegistry = deps.interfaceRegistry ?? new InterfaceRegistry();
    this.moduleTracker = deps.moduleTracker ?? new ModuleTracker();
  }

  static {
    preserveDelegateLengths(ModuleManager.prototype);
  }

  private static readonly operationsOf = defineManagerContext((manager) => ({
    fields: {
      registry: () => manager.registry,
      resolver: () => manager.resolver,
      interfaceRegistry: () => manager.interfaceRegistry,
      moduleTracker: () => manager.moduleTracker,
      resolverDetour: () => manager.resolverDetour,
      resolvedAssociations: () => manager.resolvedAssociations,
      resolvedConnections: () => manager.resolvedConnections,
      staticModules: () => manager.staticModules,
      loaded: () => manager.loaded,
      stubbedInterfacePackages: () => manager.stubbedInterfacePackages,
      interfacePackagePlans: () => manager.interfacePackagePlans,
      configVars: () => manager.configVars,
      pendingCleanup: () => manager.pendingCleanup,
      closed: () => manager.closing !== undefined,
      closing: () => manager.closing,
      constructing: () => manager.constructing,
      bindingGraph: () => manager.bindingGraph,
      isolation: () => manager.isolation,
      startupOrder: () => manager.startupOrder,
    },
    writers: {
      pendingCleanup: (value) => {
        manager.pendingCleanup = value;
      },
      bindingGraph: (value) => {
        manager.bindingGraph = value;
      },
      startupOrder: (value) => {
        manager.startupOrder = value;
      },
      closing: (value) => {
        manager.closing = value;
      },
    },
    methods: {
      restoreModules: (...args) => manager.restoreModules(...args),
      getModuleEntry: (...args) => manager.getModuleEntry(...args),
      getAllManagedModules: (...args) => manager.getAllManagedModules(...args),
      evictModuleFiles: (...args) => manager.evictModuleFiles(...args),
      collectAvoidedFolders: (...args) =>
        manager.collectAvoidedFolders(...args),
      belongsToInterfacePackageTree: (...args) =>
        manager.belongsToInterfacePackageTree(...args),
      placeModule: (...args) => manager.placeModule(...args),
      registerStubbedInterfacePackage: (...args) =>
        manager.registerStubbedInterfacePackage(...args),
      applyInterfaceStubs: (...args) => manager.applyInterfaceStubs(...args),
      neutralizeInstances: (...args) => manager.neutralizeInstances(...args),
      collectImplementedInterfaces: (...args) =>
        manager.collectImplementedInterfaces(...args),
      startModules: (...args) => manager.startModules(...args),
      destroyAll: (...args) => manager.destroyAll(...args),
      constructModule: (...args) => manager.constructModule(...args),
      planConfigVars: (...args) => manager.planConfigVars(...args),
      runProvidePhase: (...args) => manager.runProvidePhase(...args),
      constructReadyModules: (...args) =>
        manager.constructReadyModules(...args),
      constructOrDisable: (...args) => manager.constructOrDisable(...args),
      rejectCallsIntoDeadModules: (...args) =>
        manager.rejectCallsIntoDeadModules(...args),
      orphanedInterfaces: (...args) => manager.orphanedInterfaces(...args),
      hasLiveImplementer: (...args) => manager.hasLiveImplementer(...args),
      rejectCallsInto: (...args) => manager.rejectCallsInto(...args),
      findFailedProvider: (...args) => manager.findFailedProvider(...args),
      provideEntry: (...args) => manager.provideEntry(...args),
      provideModule: (...args) => manager.provideModule(...args),
      constructEntry: (...args) => manager.constructEntry(...args),
      getReverseLifecycleModules: (...args) =>
        manager.getReverseLifecycleModules(...args),
      clearManagedState: (...args) => manager.clearManagedState(...args),
      releaseRuntimeState: (...args) => manager.releaseRuntimeState(...args),
      trackModuleStart: (...args) => manager.trackModuleStart(...args),
      rebuildAssociations: (...args) => manager.rebuildAssociations(...args),
      buildBindings: (...args) => manager.buildBindings(...args),
      runningBindings: (...args) => manager.runningBindings(...args),
      logBindingWarnings: (...args) => manager.logBindingWarnings(...args),
      bindablePackages: (...args) => manager.bindablePackages(...args),
      collectBindingInterfaces: (...args) =>
        manager.collectBindingInterfaces(...args),
      collectBindingModules: (...args) =>
        manager.collectBindingModules(...args),
      collectInterfaceSources: (...args) =>
        manager.collectInterfaceSources(...args),
      resolveInterfacePackagePaths: (...args) =>
        manager.resolveInterfacePackagePaths(...args),
      resolveImplementedPackage: (...args) =>
        manager.resolveImplementedPackage(...args),
      collectInterfacePackageConsumers: (...args) =>
        manager.collectInterfacePackageConsumers(...args),
      registerInterfacePackage: (...args) =>
        manager.registerInterfacePackage(...args),
      validateInterfacePackages: (...args) =>
        manager.validateInterfacePackages(...args),
      findInterfaceRangeConflicts: (...args) =>
        manager.findInterfaceRangeConflicts(...args),
      findRangeConflicts: (...args) => manager.findRangeConflicts(...args),
      findPreloadedCopies: (...args) => manager.findPreloadedCopies(...args),
      buildModuleAssociations: (...args) =>
        manager.buildModuleAssociations(...args),
      addDefaultAssociations: (...args) =>
        manager.addDefaultAssociations(...args),
      applyImportOverrides: (...args) => manager.applyImportOverrides(...args),
      addInterfaceSource: (...args) => manager.addInterfaceSource(...args),
      validateImportOverrides: (...args) =>
        manager.validateImportOverrides(...args),
      validateOverrideSource: (...args) =>
        manager.validateOverrideSource(...args),
      validateSelfHostedConnection: (...args) =>
        manager.validateSelfHostedConnection(...args),
    },
  }));

  private get ops(): ManagerMethods {
    return ModuleManager.operationsOf(this);
  }

  addStaticModule(entry: {
    manifest: ModuleManifest;
    config?: ModuleConfig;
  }): void {
    return this.ops.addStaticModule(entry);
  }

  addModules(
    entries: Array<{ manifest: ModuleManifest; config?: ModuleConfig }>,
  ): ManagedModule[] {
    return this.ops.addModules(entries);
  }

  private restoreModules(
    ...args: Parameters<ManagerMethods["restoreModules"]>
  ) {
    return this.ops.restoreModules(...args);
  }

  discardModules(ids: readonly string[]): void {
    return this.ops.discardModules(ids);
  }

  listModules(): string[] {
    return this.ops.listModules();
  }

  getModule(id: string): Module | undefined {
    return this.ops.getModule(id);
  }

  getModuleEntry(id: string): ManagedModule | undefined {
    return this.ops.getModuleEntry(id);
  }

  getLoadedModuleEntry(id: string): ManagedModule | undefined {
    return this.ops.getLoadedModuleEntry(id);
  }

  getLoadedModules(): IterableIterator<ManagedModule> {
    return this.ops.getLoadedModules();
  }

  getAllManagedModules(): ManagedModule[] {
    return this.ops.getAllManagedModules();
  }

  unrequireModuleFiles(
    moduleId: string,
    shouldPreserveInterfaceGraph = true,
  ): void {
    return this.ops.unrequireModuleFiles(
      moduleId,
      shouldPreserveInterfaceGraph,
    );
  }

  private evictModuleFiles(
    ...args: Parameters<ManagerMethods["evictModuleFiles"]>
  ) {
    return this.ops.evictModuleFiles(...args);
  }

  private collectAvoidedFolders(
    ...args: Parameters<ManagerMethods["collectAvoidedFolders"]>
  ) {
    return this.ops.collectAvoidedFolders(...args);
  }

  private belongsToInterfacePackageTree(
    ...args: Parameters<ManagerMethods["belongsToInterfacePackageTree"]>
  ) {
    return this.ops.belongsToInterfacePackageTree(...args);
  }

  setInstanceRoot(root: string): void {
    return this.ops.setInstanceRoot(root);
  }

  placeModule(moduleId: string, manifest: ModuleManifest): ModuleManifest {
    return this.ops.placeModule(moduleId, manifest);
  }

  checkReplacement(moduleId: string, replacement: Module): void {
    return this.ops.checkReplacement(moduleId, replacement);
  }

  discardPlacedModule(manifest: ModuleManifest): void {
    return this.ops.discardPlacedModule(manifest);
  }

  replaceLoadedModule(id: string, module: Module): ManagedModule | undefined {
    return this.ops.replaceLoadedModule(id, module);
  }

  refreshAssociations(): void {
    return this.ops.refreshAssociations();
  }

  hasResolvedInterface(moduleId: string, interfaceName: string): boolean {
    return this.ops.hasResolvedInterface(moduleId, interfaceName);
  }

  registerStubbedInterfaces(stubbed: UnresolvedInterface[]): void {
    return this.ops.registerStubbedInterfaces(stubbed);
  }

  private registerStubbedInterfacePackage(
    ...args: Parameters<ManagerMethods["registerStubbedInterfacePackage"]>
  ) {
    return this.ops.registerStubbedInterfacePackage(...args);
  }

  private applyInterfaceStubs() {
    return this.ops.applyInterfaceStubs();
  }

  private neutralizeInstances(
    ...args: Parameters<ManagerMethods["neutralizeInstances"]>
  ) {
    return this.ops.neutralizeInstances(...args);
  }

  private collectImplementedInterfaces() {
    return this.ops.collectImplementedInterfaces();
  }

  async constructAll(): Promise<void> {
    return this.ops.constructAll();
  }

  async constructModules(modules: ManagedModule[]): Promise<void> {
    return this.ops.constructModules(modules);
  }

  async startAll(): Promise<void> {
    return this.ops.startAll();
  }

  async startModules(modules: ManagedModule[]): Promise<void> {
    return this.ops.startModules(modules);
  }

  async stopAll(): Promise<void> {
    return this.ops.stopAll();
  }

  async destroyAll(): Promise<void> {
    return this.ops.destroyAll();
  }

  private async constructModule(
    ...args: Parameters<ManagerMethods["constructModule"]>
  ) {
    return this.ops.constructModule(...args);
  }

  private planConfigVars(
    ...args: Parameters<ManagerMethods["planConfigVars"]>
  ) {
    return this.ops.planConfigVars(...args);
  }

  private async runProvidePhase(
    ...args: Parameters<ManagerMethods["runProvidePhase"]>
  ) {
    return this.ops.runProvidePhase(...args);
  }

  private async constructReadyModules(
    ...args: Parameters<ManagerMethods["constructReadyModules"]>
  ) {
    return this.ops.constructReadyModules(...args);
  }

  private async constructOrDisable(
    ...args: Parameters<ManagerMethods["constructOrDisable"]>
  ) {
    return this.ops.constructOrDisable(...args);
  }

  private rejectCallsIntoDeadModules(
    ...args: Parameters<ManagerMethods["rejectCallsIntoDeadModules"]>
  ) {
    return this.ops.rejectCallsIntoDeadModules(...args);
  }

  private orphanedInterfaces(
    ...args: Parameters<ManagerMethods["orphanedInterfaces"]>
  ) {
    return this.ops.orphanedInterfaces(...args);
  }

  private hasLiveImplementer(
    ...args: Parameters<ManagerMethods["hasLiveImplementer"]>
  ) {
    return this.ops.hasLiveImplementer(...args);
  }

  private rejectCallsInto(
    ...args: Parameters<ManagerMethods["rejectCallsInto"]>
  ) {
    return this.ops.rejectCallsInto(...args);
  }

  private findFailedProvider(
    ...args: Parameters<ManagerMethods["findFailedProvider"]>
  ) {
    return this.ops.findFailedProvider(...args);
  }

  private async provideEntry(
    ...args: Parameters<ManagerMethods["provideEntry"]>
  ) {
    return this.ops.provideEntry(...args);
  }

  private async provideModule(
    ...args: Parameters<ManagerMethods["provideModule"]>
  ) {
    return this.ops.provideModule(...args);
  }

  private async constructEntry(
    ...args: Parameters<ManagerMethods["constructEntry"]>
  ) {
    return this.ops.constructEntry(...args);
  }

  private getReverseLifecycleModules() {
    return this.ops.getReverseLifecycleModules();
  }

  private clearManagedState() {
    return this.ops.clearManagedState();
  }

  private releaseRuntimeState() {
    return this.ops.releaseRuntimeState();
  }

  private trackModuleStart(
    ...args: Parameters<ManagerMethods["trackModuleStart"]>
  ) {
    return this.ops.trackModuleStart(...args);
  }

  getBindingGraph(): BindingGraph | undefined {
    return this.ops.getBindingGraph();
  }

  private rebuildAssociations() {
    return this.ops.rebuildAssociations();
  }

  private buildBindings() {
    return this.ops.buildBindings();
  }

  private runningBindings() {
    return this.ops.runningBindings();
  }

  private logBindingWarnings() {
    return this.ops.logBindingWarnings();
  }

  private bindablePackages() {
    return this.ops.bindablePackages();
  }

  private collectBindingInterfaces() {
    return this.ops.collectBindingInterfaces();
  }

  private collectBindingModules() {
    return this.ops.collectBindingModules();
  }

  private collectInterfaceSources() {
    return this.ops.collectInterfaceSources();
  }

  private resolveInterfacePackagePaths(
    interfaceSources: Parameters<
      ManagerMethods["resolveInterfacePackagePaths"]
    >[0],
  ) {
    return this.ops.resolveInterfacePackagePaths(interfaceSources);
  }

  private resolveImplementedPackage(
    ...args: Parameters<ManagerMethods["resolveImplementedPackage"]>
  ) {
    return this.ops.resolveImplementedPackage(...args);
  }

  private collectInterfacePackageConsumers(
    packageName: Parameters<
      ManagerMethods["collectInterfacePackageConsumers"]
    >[0],
  ) {
    return this.ops.collectInterfacePackageConsumers(packageName);
  }

  private registerInterfacePackage(
    ...args: Parameters<ManagerMethods["registerInterfacePackage"]>
  ) {
    return this.ops.registerInterfacePackage(...args);
  }

  private validateInterfacePackages() {
    return this.ops.validateInterfacePackages();
  }

  /**
   * Lists the modules whose declared range of an interface package excludes
   * the shared copy the manager planned for it. Reads only package.json
   * files, so it runs before any module code is loaded.
   */
  findInterfaceRangeConflicts() {
    return this.ops.findInterfaceRangeConflicts();
  }

  /**
   * Lists the changes that give each module the copy of every planned
   * interface package that all their ranges accept. Reads only package.json
   * files, like {@link findInterfaceRangeConflicts}.
   */
  findInterfaceBumps() {
    return this.ops.findInterfaceBumps();
  }

  private findRangeConflicts(
    ...args: Parameters<ManagerMethods["findRangeConflicts"]>
  ) {
    return this.ops.findRangeConflicts(...args);
  }

  private findPreloadedCopies(
    ...args: Parameters<ManagerMethods["findPreloadedCopies"]>
  ) {
    return this.ops.findPreloadedCopies(...args);
  }

  private buildModuleAssociations(
    ...args: Parameters<ManagerMethods["buildModuleAssociations"]>
  ) {
    return this.ops.buildModuleAssociations(...args);
  }

  private addDefaultAssociations(
    ...args: Parameters<ManagerMethods["addDefaultAssociations"]>
  ) {
    return this.ops.addDefaultAssociations(...args);
  }

  private applyImportOverrides(
    ...args: Parameters<ManagerMethods["applyImportOverrides"]>
  ) {
    return this.ops.applyImportOverrides(...args);
  }

  private addInterfaceSource(
    ...args: Parameters<ManagerMethods["addInterfaceSource"]>
  ) {
    return this.ops.addInterfaceSource(...args);
  }

  private validateImportOverrides(
    ...args: Parameters<ManagerMethods["validateImportOverrides"]>
  ) {
    return this.ops.validateImportOverrides(...args);
  }

  private validateOverrideSource(
    ...args: Parameters<ManagerMethods["validateOverrideSource"]>
  ) {
    return this.ops.validateOverrideSource(...args);
  }

  private validateSelfHostedConnection(
    ...args: Parameters<ManagerMethods["validateSelfHostedConnection"]>
  ) {
    return this.ops.validateSelfHostedConnection(...args);
  }
}

function preserveDelegateLengths(prototype: ModuleManager): void {
  for (const [name, operation] of Object.entries(MANAGER_OPERATIONS)) {
    Object.defineProperty(
      Object.getOwnPropertyDescriptor(prototype, name)?.value,
      "length",
      {
        value: operation.length,
      },
    );
  }
}
