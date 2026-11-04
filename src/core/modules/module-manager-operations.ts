import * as bindings from "./module-manager-bindings";
import * as cache from "./module-manager-cache";
import * as construction from "./module-manager-construction";
import type { ManagerContext, ManagerMethods } from "./module-manager-context";
import * as lifecycle from "./module-manager-lifecycle";
import * as packages from "./module-manager-packages";
import * as records from "./module-manager-records";

type ManagerOperations = {
  [Name in keyof ManagerMethods]: (
    this: ManagerContext,
    ...args: Parameters<ManagerMethods[Name]>
  ) => ReturnType<ManagerMethods[Name]>;
};

/** The manager operations, unbound, so their names and lengths can be read without a context. */
export const MANAGER_OPERATIONS: ManagerOperations = {
  addStaticModule: records.addStaticModule,
  addModules: records.addModules,
  restoreModules: records.restoreModules,
  discardModules: records.discardModules,
  listModules: records.listModules,
  getModule: records.getModule,
  getModuleEntry: records.getModuleEntry,
  getLoadedModuleEntry: records.getLoadedModuleEntry,
  getLoadedModules: records.getLoadedModules,
  getAllManagedModules: records.getAllManagedModules,
  unrequireModuleFiles: cache.unrequireModuleFiles,
  evictModuleFiles: cache.evictModuleFiles,
  collectAvoidedFolders: cache.collectAvoidedFolders,
  belongsToInterfacePackageTree: cache.belongsToInterfacePackageTree,
  setInstanceRoot: records.setInstanceRoot,
  placeModule: records.placeModule,
  checkReplacement: bindings.checkReplacement,
  discardPlacedModule: records.discardPlacedModule,
  replaceLoadedModule: records.replaceLoadedModule,
  refreshAssociations: bindings.refreshAssociations,
  hasResolvedInterface: bindings.hasResolvedInterface,
  registerStubbedInterfaces: packages.registerStubbedInterfaces,
  registerStubbedInterfacePackage: packages.registerStubbedInterfacePackage,
  applyInterfaceStubs: packages.applyInterfaceStubs,
  neutralizeInstances: packages.neutralizeInstances,
  collectImplementedInterfaces: packages.collectImplementedInterfaces,
  constructAll: construction.constructAll,
  constructModules: construction.constructModules,
  startAll: lifecycle.startAll,
  startModules: lifecycle.startModules,
  stopAll: lifecycle.stopAll,
  destroyAll: lifecycle.destroyAll,
  constructModule: construction.constructModule,
  planConfigVars: construction.planConfigVars,
  runProvidePhase: construction.runProvidePhase,
  constructReadyModules: construction.constructReadyModules,
  constructOrDisable: construction.constructOrDisable,
  rejectCallsIntoDeadModules: construction.rejectCallsIntoDeadModules,
  orphanedInterfaces: construction.orphanedInterfaces,
  hasLiveImplementer: construction.hasLiveImplementer,
  rejectCallsInto: construction.rejectCallsInto,
  findFailedProvider: construction.findFailedProvider,
  provideEntry: construction.provideEntry,
  provideModule: construction.provideModule,
  constructEntry: construction.constructEntry,
  getReverseLifecycleModules: lifecycle.getReverseLifecycleModules,
  clearManagedState: lifecycle.clearManagedState,
  releaseRuntimeState: lifecycle.releaseRuntimeState,
  trackModuleStart: lifecycle.trackModuleStart,
  getBindingGraph: bindings.getBindingGraph,
  rebuildAssociations: bindings.rebuildAssociations,
  buildBindings: bindings.buildBindings,
  runningBindings: bindings.runningBindings,
  logBindingWarnings: bindings.logBindingWarnings,
  bindablePackages: bindings.bindablePackages,
  collectBindingInterfaces: bindings.collectBindingInterfaces,
  collectBindingModules: bindings.collectBindingModules,
  collectInterfaceSources: bindings.collectInterfaceSources,
  resolveInterfacePackagePaths: packages.resolveInterfacePackagePaths,
  resolveImplementedPackage: packages.resolveImplementedPackage,
  collectInterfacePackageConsumers: packages.collectInterfacePackageConsumers,
  registerInterfacePackage: packages.registerInterfacePackage,
  validateInterfacePackages: packages.validateInterfacePackages,
  findInterfaceRangeConflicts: packages.findInterfaceRangeConflicts,
  findRangeConflicts: packages.findRangeConflicts,
  findPreloadedCopies: packages.findPreloadedCopies,
  buildModuleAssociations: bindings.buildModuleAssociations,
  addDefaultAssociations: bindings.addDefaultAssociations,
  applyImportOverrides: bindings.applyImportOverrides,
  addInterfaceSource: bindings.addInterfaceSource,
  validateImportOverrides: bindings.validateImportOverrides,
  validateOverrideSource: bindings.validateOverrideSource,
  validateSelfHostedConnection: bindings.validateSelfHostedConnection,
};

export function bindOperations(context: ManagerContext): ManagerMethods {
  return {
    addStaticModule: MANAGER_OPERATIONS.addStaticModule.bind(context),
    addModules: MANAGER_OPERATIONS.addModules.bind(context),
    restoreModules: MANAGER_OPERATIONS.restoreModules.bind(context),
    discardModules: MANAGER_OPERATIONS.discardModules.bind(context),
    listModules: MANAGER_OPERATIONS.listModules.bind(context),
    getModule: MANAGER_OPERATIONS.getModule.bind(context),
    getModuleEntry: MANAGER_OPERATIONS.getModuleEntry.bind(context),
    getLoadedModuleEntry: MANAGER_OPERATIONS.getLoadedModuleEntry.bind(context),
    getLoadedModules: MANAGER_OPERATIONS.getLoadedModules.bind(context),
    getAllManagedModules: MANAGER_OPERATIONS.getAllManagedModules.bind(context),
    unrequireModuleFiles: MANAGER_OPERATIONS.unrequireModuleFiles.bind(context),
    evictModuleFiles: MANAGER_OPERATIONS.evictModuleFiles.bind(context),
    collectAvoidedFolders:
      MANAGER_OPERATIONS.collectAvoidedFolders.bind(context),
    belongsToInterfacePackageTree:
      MANAGER_OPERATIONS.belongsToInterfacePackageTree.bind(context),
    setInstanceRoot: MANAGER_OPERATIONS.setInstanceRoot.bind(context),
    placeModule: MANAGER_OPERATIONS.placeModule.bind(context),
    checkReplacement: MANAGER_OPERATIONS.checkReplacement.bind(context),
    discardPlacedModule: MANAGER_OPERATIONS.discardPlacedModule.bind(context),
    replaceLoadedModule: MANAGER_OPERATIONS.replaceLoadedModule.bind(context),
    refreshAssociations: MANAGER_OPERATIONS.refreshAssociations.bind(context),
    hasResolvedInterface: MANAGER_OPERATIONS.hasResolvedInterface.bind(context),
    registerStubbedInterfaces:
      MANAGER_OPERATIONS.registerStubbedInterfaces.bind(context),
    registerStubbedInterfacePackage:
      MANAGER_OPERATIONS.registerStubbedInterfacePackage.bind(context),
    applyInterfaceStubs: MANAGER_OPERATIONS.applyInterfaceStubs.bind(context),
    neutralizeInstances: MANAGER_OPERATIONS.neutralizeInstances.bind(context),
    collectImplementedInterfaces:
      MANAGER_OPERATIONS.collectImplementedInterfaces.bind(context),
    constructAll: MANAGER_OPERATIONS.constructAll.bind(context),
    constructModules: MANAGER_OPERATIONS.constructModules.bind(context),
    startAll: MANAGER_OPERATIONS.startAll.bind(context),
    startModules: MANAGER_OPERATIONS.startModules.bind(context),
    stopAll: MANAGER_OPERATIONS.stopAll.bind(context),
    destroyAll: MANAGER_OPERATIONS.destroyAll.bind(context),
    constructModule: MANAGER_OPERATIONS.constructModule.bind(context),
    planConfigVars: MANAGER_OPERATIONS.planConfigVars.bind(context),
    runProvidePhase: MANAGER_OPERATIONS.runProvidePhase.bind(context),
    constructReadyModules:
      MANAGER_OPERATIONS.constructReadyModules.bind(context),
    constructOrDisable: MANAGER_OPERATIONS.constructOrDisable.bind(context),
    rejectCallsIntoDeadModules:
      MANAGER_OPERATIONS.rejectCallsIntoDeadModules.bind(context),
    orphanedInterfaces: MANAGER_OPERATIONS.orphanedInterfaces.bind(context),
    hasLiveImplementer: MANAGER_OPERATIONS.hasLiveImplementer.bind(context),
    rejectCallsInto: MANAGER_OPERATIONS.rejectCallsInto.bind(context),
    findFailedProvider: MANAGER_OPERATIONS.findFailedProvider.bind(context),
    provideEntry: MANAGER_OPERATIONS.provideEntry.bind(context),
    provideModule: MANAGER_OPERATIONS.provideModule.bind(context),
    constructEntry: MANAGER_OPERATIONS.constructEntry.bind(context),
    getReverseLifecycleModules:
      MANAGER_OPERATIONS.getReverseLifecycleModules.bind(context),
    clearManagedState: MANAGER_OPERATIONS.clearManagedState.bind(context),
    releaseRuntimeState: MANAGER_OPERATIONS.releaseRuntimeState.bind(context),
    trackModuleStart: MANAGER_OPERATIONS.trackModuleStart.bind(context),
    getBindingGraph: MANAGER_OPERATIONS.getBindingGraph.bind(context),
    rebuildAssociations: MANAGER_OPERATIONS.rebuildAssociations.bind(context),
    buildBindings: MANAGER_OPERATIONS.buildBindings.bind(context),
    runningBindings: MANAGER_OPERATIONS.runningBindings.bind(context),
    logBindingWarnings: MANAGER_OPERATIONS.logBindingWarnings.bind(context),
    bindablePackages: MANAGER_OPERATIONS.bindablePackages.bind(context),
    collectBindingInterfaces:
      MANAGER_OPERATIONS.collectBindingInterfaces.bind(context),
    collectBindingModules:
      MANAGER_OPERATIONS.collectBindingModules.bind(context),
    collectInterfaceSources:
      MANAGER_OPERATIONS.collectInterfaceSources.bind(context),
    resolveInterfacePackagePaths:
      MANAGER_OPERATIONS.resolveInterfacePackagePaths.bind(context),
    resolveImplementedPackage:
      MANAGER_OPERATIONS.resolveImplementedPackage.bind(context),
    collectInterfacePackageConsumers:
      MANAGER_OPERATIONS.collectInterfacePackageConsumers.bind(context),
    registerInterfacePackage:
      MANAGER_OPERATIONS.registerInterfacePackage.bind(context),
    validateInterfacePackages:
      MANAGER_OPERATIONS.validateInterfacePackages.bind(context),
    findInterfaceRangeConflicts:
      MANAGER_OPERATIONS.findInterfaceRangeConflicts.bind(context),
    findRangeConflicts: MANAGER_OPERATIONS.findRangeConflicts.bind(context),
    findPreloadedCopies: MANAGER_OPERATIONS.findPreloadedCopies.bind(context),
    buildModuleAssociations:
      MANAGER_OPERATIONS.buildModuleAssociations.bind(context),
    addDefaultAssociations:
      MANAGER_OPERATIONS.addDefaultAssociations.bind(context),
    applyImportOverrides: MANAGER_OPERATIONS.applyImportOverrides.bind(context),
    addInterfaceSource: MANAGER_OPERATIONS.addInterfaceSource.bind(context),
    validateImportOverrides:
      MANAGER_OPERATIONS.validateImportOverrides.bind(context),
    validateOverrideSource:
      MANAGER_OPERATIONS.validateOverrideSource.bind(context),
    validateSelfHostedConnection:
      MANAGER_OPERATIONS.validateSelfHostedConnection.bind(context),
  };
}
