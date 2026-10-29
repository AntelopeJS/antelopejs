import { type ResolvedPackage } from "../../utils";
import { ConfigVarStore } from "../config";
import type { InterfaceRangeConflict } from "../output";
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
  bindOperations,
  type ManagerMethods,
  type ModuleConfig,
  operations,
  defineManagerContext,
} from "./module-manager-context";
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

  private readonly selectedProviders = new Map<string, Map<string, string>>();

  private readonly staticModules: ManagedModule[] = [];

  private readonly loaded = new Map<string, ManagedModule>();

  private readonly stubbedInterfacePackages = new Map<
    string,
    ResolvedPackage
  >();

  private readonly interfacePackagePlans = new Map<
    string,
    InterfacePackagePlan
  >();

  private readonly configVars = new ConfigVarStore();

  private pendingCleanup: ManagedModule[] = [];

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
    defineManagerContext((manager) => ({
      fields: {
        registry: () => manager.registry,
        resolver: () => manager.resolver,
        interfaceRegistry: () => manager.interfaceRegistry,
        moduleTracker: () => manager.moduleTracker,
        resolverDetour: () => manager.resolverDetour,
        resolvedAssociations: () => manager.resolvedAssociations,
        resolvedConnections: () => manager.resolvedConnections,
        selectedProviders: () => manager.selectedProviders,
        staticModules: () => manager.staticModules,
        loaded: () => manager.loaded,
        stubbedInterfacePackages: () => manager.stubbedInterfacePackages,
        interfacePackagePlans: () => manager.interfacePackagePlans,
        configVars: () => manager.configVars,
        pendingCleanup: () => manager.pendingCleanup,
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
      },
      methods: {
        restoreModules: (...args) => manager.restoreModules(...args),
        getModuleEntry: (...args) => manager.getModuleEntry(...args),
        getAllManagedModules: (...args) =>
          manager.getAllManagedModules(...args),
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
        applyImportOverrides: (...args) =>
          manager.applyImportOverrides(...args),
        addInterfaceSource: (...args) => manager.addInterfaceSource(...args),
        validateImportOverrides: (...args) =>
          manager.validateImportOverrides(...args),
        validateOverrideSource: (...args) =>
          manager.validateOverrideSource(...args),
        validateSelfHostedConnection: (...args) =>
          manager.validateSelfHostedConnection(...args),
      },
    }));
  }

  addStaticModule(entry: {
    manifest: ModuleManifest;
    config?: ModuleConfig;
  }): void {
    return operations(this).addStaticModule(entry);
  }

  addModules(
    entries: Array<{ manifest: ModuleManifest; config?: ModuleConfig }>,
  ): ManagedModule[] {
    return operations(this).addModules(entries);
  }

  private restoreModules(
    ...args: Parameters<ManagerMethods["restoreModules"]>
  ) {
    return operations(this).restoreModules(...args);
  }

  discardModules(ids: readonly string[]): void {
    return operations(this).discardModules(ids);
  }

  listModules(): string[] {
    return operations(this).listModules();
  }

  getModule(id: string): Module | undefined {
    return operations(this).getModule(id);
  }

  getModuleEntry(id: string): ManagedModule | undefined {
    return operations(this).getModuleEntry(id);
  }

  getLoadedModuleEntry(id: string): ManagedModule | undefined {
    return operations(this).getLoadedModuleEntry(id);
  }

  getLoadedModules(): IterableIterator<ManagedModule> {
    return operations(this).getLoadedModules();
  }

  getAllManagedModules(): ManagedModule[] {
    return operations(this).getAllManagedModules();
  }

  unrequireModuleFiles(
    moduleId: string,
    shouldPreserveInterfaceGraph = true,
  ): void {
    return operations(this).unrequireModuleFiles(
      moduleId,
      shouldPreserveInterfaceGraph,
    );
  }

  private evictModuleFiles(
    ...args: Parameters<ManagerMethods["evictModuleFiles"]>
  ) {
    return operations(this).evictModuleFiles(...args);
  }

  private collectAvoidedFolders(
    ...args: Parameters<ManagerMethods["collectAvoidedFolders"]>
  ) {
    return operations(this).collectAvoidedFolders(...args);
  }

  private belongsToInterfacePackageTree(
    ...args: Parameters<ManagerMethods["belongsToInterfacePackageTree"]>
  ) {
    return operations(this).belongsToInterfacePackageTree(...args);
  }

  setInstanceRoot(root: string): void {
    return operations(this).setInstanceRoot(root);
  }

  placeModule(moduleId: string, manifest: ModuleManifest): ModuleManifest {
    return operations(this).placeModule(moduleId, manifest);
  }

  checkReplacement(moduleId: string, replacement: Module): void {
    return operations(this).checkReplacement(moduleId, replacement);
  }

  discardPlacedModule(manifest: ModuleManifest): void {
    return operations(this).discardPlacedModule(manifest);
  }

  replaceLoadedModule(id: string, module: Module): ManagedModule | undefined {
    return operations(this).replaceLoadedModule(id, module);
  }

  refreshAssociations(): void {
    return operations(this).refreshAssociations();
  }

  hasResolvedInterface(moduleId: string, interfaceName: string): boolean {
    return operations(this).hasResolvedInterface(moduleId, interfaceName);
  }

  registerStubbedInterfaces(stubbed: UnresolvedInterface[]): void {
    return operations(this).registerStubbedInterfaces(stubbed);
  }

  private registerStubbedInterfacePackage(
    ...args: Parameters<ManagerMethods["registerStubbedInterfacePackage"]>
  ) {
    return operations(this).registerStubbedInterfacePackage(...args);
  }

  private applyInterfaceStubs() {
    return operations(this).applyInterfaceStubs();
  }

  private neutralizeInstances(
    ...args: Parameters<ManagerMethods["neutralizeInstances"]>
  ) {
    return operations(this).neutralizeInstances(...args);
  }

  private collectImplementedInterfaces() {
    return operations(this).collectImplementedInterfaces();
  }

  async constructAll(): Promise<void> {
    return operations(this).constructAll();
  }

  async constructModules(modules: ManagedModule[]): Promise<void> {
    return operations(this).constructModules(modules);
  }

  async startAll(): Promise<void> {
    return operations(this).startAll();
  }

  async startModules(modules: ManagedModule[]): Promise<void> {
    return operations(this).startModules(modules);
  }

  async stopAll(): Promise<void> {
    return operations(this).stopAll();
  }

  async destroyAll(): Promise<void> {
    return operations(this).destroyAll();
  }

  private async constructModule(
    ...args: Parameters<ManagerMethods["constructModule"]>
  ) {
    return operations(this).constructModule(...args);
  }

  private planConfigVars(
    ...args: Parameters<ManagerMethods["planConfigVars"]>
  ) {
    return operations(this).planConfigVars(...args);
  }

  private async runProvidePhase(
    ...args: Parameters<ManagerMethods["runProvidePhase"]>
  ) {
    return operations(this).runProvidePhase(...args);
  }

  private async constructReadyModules(
    ...args: Parameters<ManagerMethods["constructReadyModules"]>
  ) {
    return operations(this).constructReadyModules(...args);
  }

  private async constructOrDisable(
    ...args: Parameters<ManagerMethods["constructOrDisable"]>
  ) {
    return operations(this).constructOrDisable(...args);
  }

  private rejectCallsIntoDeadModules(
    ...args: Parameters<ManagerMethods["rejectCallsIntoDeadModules"]>
  ) {
    return operations(this).rejectCallsIntoDeadModules(...args);
  }

  private orphanedInterfaces(
    ...args: Parameters<ManagerMethods["orphanedInterfaces"]>
  ) {
    return operations(this).orphanedInterfaces(...args);
  }

  private hasLiveImplementer(
    ...args: Parameters<ManagerMethods["hasLiveImplementer"]>
  ) {
    return operations(this).hasLiveImplementer(...args);
  }

  private rejectCallsInto(
    ...args: Parameters<ManagerMethods["rejectCallsInto"]>
  ) {
    return operations(this).rejectCallsInto(...args);
  }

  private findFailedProvider(
    ...args: Parameters<ManagerMethods["findFailedProvider"]>
  ) {
    return operations(this).findFailedProvider(...args);
  }

  private async provideEntry(
    ...args: Parameters<ManagerMethods["provideEntry"]>
  ) {
    return operations(this).provideEntry(...args);
  }

  private async provideModule(
    ...args: Parameters<ManagerMethods["provideModule"]>
  ) {
    return operations(this).provideModule(...args);
  }

  private async constructEntry(
    ...args: Parameters<ManagerMethods["constructEntry"]>
  ) {
    return operations(this).constructEntry(...args);
  }

  private getReverseLifecycleModules() {
    return operations(this).getReverseLifecycleModules();
  }

  private clearManagedState() {
    return operations(this).clearManagedState();
  }

  private releaseRuntimeState() {
    return operations(this).releaseRuntimeState();
  }

  private trackModuleStart(
    ...args: Parameters<ManagerMethods["trackModuleStart"]>
  ) {
    return operations(this).trackModuleStart(...args);
  }

  getBindingGraph(): BindingGraph | undefined {
    return operations(this).getBindingGraph();
  }

  private rebuildAssociations() {
    return operations(this).rebuildAssociations();
  }

  private buildBindings() {
    return operations(this).buildBindings();
  }

  private runningBindings() {
    return operations(this).runningBindings();
  }

  private logBindingWarnings() {
    return operations(this).logBindingWarnings();
  }

  private bindablePackages() {
    return operations(this).bindablePackages();
  }

  private collectBindingInterfaces() {
    return operations(this).collectBindingInterfaces();
  }

  private collectBindingModules() {
    return operations(this).collectBindingModules();
  }

  private collectInterfaceSources() {
    return operations(this).collectInterfaceSources();
  }

  private resolveInterfacePackagePaths(
    interfaceSources: Parameters<
      ManagerMethods["resolveInterfacePackagePaths"]
    >[0],
  ) {
    return operations(this).resolveInterfacePackagePaths(interfaceSources);
  }

  private resolveImplementedPackage(
    ...args: Parameters<ManagerMethods["resolveImplementedPackage"]>
  ) {
    return operations(this).resolveImplementedPackage(...args);
  }

  private collectInterfacePackageConsumers(
    packageName: Parameters<
      ManagerMethods["collectInterfacePackageConsumers"]
    >[0],
  ) {
    return operations(this).collectInterfacePackageConsumers(packageName);
  }

  private registerInterfacePackage(
    ...args: Parameters<ManagerMethods["registerInterfacePackage"]>
  ) {
    return operations(this).registerInterfacePackage(...args);
  }

  private validateInterfacePackages() {
    return operations(this).validateInterfacePackages();
  }

  /**
   * Lists the modules whose declared range of an interface package excludes
   * the shared copy the manager planned for it. Reads only package.json
   * files, so it runs before any module code is loaded.
   */
  findInterfaceRangeConflicts(): InterfaceRangeConflict[] {
    return operations(this).findInterfaceRangeConflicts();
  }

  private findRangeConflicts(
    ...args: Parameters<ManagerMethods["findRangeConflicts"]>
  ) {
    return operations(this).findRangeConflicts(...args);
  }

  private findPreloadedCopies(
    ...args: Parameters<ManagerMethods["findPreloadedCopies"]>
  ) {
    return operations(this).findPreloadedCopies(...args);
  }

  private buildModuleAssociations(
    ...args: Parameters<ManagerMethods["buildModuleAssociations"]>
  ) {
    return operations(this).buildModuleAssociations(...args);
  }

  private addDefaultAssociations(
    ...args: Parameters<ManagerMethods["addDefaultAssociations"]>
  ) {
    return operations(this).addDefaultAssociations(...args);
  }

  private applyImportOverrides(
    ...args: Parameters<ManagerMethods["applyImportOverrides"]>
  ) {
    return operations(this).applyImportOverrides(...args);
  }

  private addInterfaceSource(
    ...args: Parameters<ManagerMethods["addInterfaceSource"]>
  ) {
    return operations(this).addInterfaceSource(...args);
  }

  private validateImportOverrides(
    ...args: Parameters<ManagerMethods["validateImportOverrides"]>
  ) {
    return operations(this).validateImportOverrides(...args);
  }

  private validateOverrideSource(
    ...args: Parameters<ManagerMethods["validateOverrideSource"]>
  ) {
    return operations(this).validateOverrideSource(...args);
  }

  private validateSelfHostedConnection(
    ...args: Parameters<ManagerMethods["validateSelfHostedConnection"]>
  ) {
    return operations(this).validateSelfHostedConnection(...args);
  }
}

function preserveDelegateLengths(prototype: ModuleManager): void {
  const template = bindOperations(Object.create(null));
  for (const [name, operation] of Object.entries(template)) {
    Object.defineProperty(
      Object.getOwnPropertyDescriptor(prototype, name)?.value,
      "length",
      {
        value: operation.length,
      },
    );
  }
}
