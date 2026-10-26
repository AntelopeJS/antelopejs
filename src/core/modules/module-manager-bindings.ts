import { ModuleState } from "../../types";
import { clearPathResolutionCache } from "../../utils";
import type {
  BindingConnection,
  BindingGraph,
  BindingInterface,
  BindingModule,
} from "../resolution";
import {
  buildBindingGraph,
  InterfaceBindingError,
  readInterfaceDependencies,
} from "../resolution";
import { type InterfaceConnectionRef } from "./interface-registry";
import { Module } from "./module";
import {
  type ManagerContext,
  type ModuleConfig,
} from "./module-manager-context";
import { Logger } from "./module-manager-logger";

const INTERFACE_CORE_PACKAGE = "@antelopejs/interface-core";

function toBindingConnections(
  connections: Map<string, InterfaceConnectionRef[]> | undefined,
): Map<string, BindingConnection[]> {
  return new Map(
    [...(connections ?? [])].map(([interfaceName, refs]) => [
      interfaceName,
      refs.map(({ module: source, id }) => ({ source, id })),
    ]),
  );
}

function toBindingModule(
  module: Module,
  config: ModuleConfig,
  packages: ReadonlySet<string>,
  listed: ReadonlyMap<string, Map<string, InterfaceConnectionRef[]>>,
): BindingModule {
  const manifest = module.manifest.manifest;
  const declared = {
    ...manifest.optionalDependencies,
    ...manifest.dependencies,
  };
  const connections = toBindingConnections(config.importOverrides);
  return {
    id: module.id,
    implements: (module.manifest.implements ?? []).filter(
      (name) => packages.has(name) && !config.disabledExports?.has(name),
    ),
    uses: Object.keys(declared).filter((name) => packages.has(name)),
    connections,
    listedConnections: toBindingConnections(listed.get(module.id)),
    exportPriority: config.exportPriority ?? new Map(),
  };
}

export function checkReplacement(
  this: ManagerContext,
  moduleId: string,
  replacement: Module,
): void {
  const entry = this.loaded.get(moduleId);
  if (!entry) {
    return;
  }
  const modules = this.collectBindingModules();
  modules.set(
    moduleId,
    toBindingModule(
      replacement,
      entry.config,
      this.bindablePackages(),
      this.resolvedConnections,
    ),
  );
  const running = this.runningBindings();
  running.delete(moduleId);
  const graph = buildBindingGraph({
    interfaces: this.collectBindingInterfaces(),
    modules,
    running,
  });
  if (graph.errors.length > 0) {
    throw new InterfaceBindingError(graph.errors);
  }
}

export function refreshAssociations(this: ManagerContext): void {
  this.rebuildAssociations();
}

export function hasResolvedInterface(
  this: ManagerContext,
  moduleId: string,
  interfaceName: string,
): boolean {
  return this.resolvedAssociations.get(moduleId)?.has(interfaceName) ?? false;
}

export function getBindingGraph(
  this: ManagerContext,
): BindingGraph | undefined {
  return this.bindingGraph;
}

export function rebuildAssociations(this: ManagerContext): void {
  clearPathResolutionCache();
  const interfaceSources = this.collectInterfaceSources();
  this.buildModuleAssociations(interfaceSources);
  this.buildBindings();
}

export function buildBindings(this: ManagerContext): void {
  const graph = buildBindingGraph({
    interfaces: this.collectBindingInterfaces(),
    modules: this.collectBindingModules(),
    running: this.runningBindings(),
  });
  if (graph.errors.length > 0) {
    throw new InterfaceBindingError(graph.errors);
  }
  this.bindingGraph = graph;
  this.resolver.setBindings(graph);
}

export function runningBindings(
  this: ManagerContext,
): Map<string, Map<string, string>> {
  const running = new Map<string, Map<string, string>>();
  for (const { module } of this.getAllManagedModules()) {
    const scope = this.bindingGraph?.modules.get(module.id)?.scope;
    if (module.state === ModuleState.Loaded || !scope) {
      continue;
    }
    const bindings = new Map<string, string>();
    scope.forEach((binding, interfaceName) => {
      if (binding.provider) {
        bindings.set(interfaceName, binding.provider);
      }
    });
    running.set(module.id, bindings);
  }
  return running;
}

export function logBindingWarnings(this: ManagerContext): void {
  this.bindingGraph?.warnings.forEach((warning) => Logger.Warn(warning));
}

export function bindablePackages(this: ManagerContext): Set<string> {
  return new Set(
    [...this.resolver.interfacePackages.keys()].filter(
      (packageName) => packageName !== INTERFACE_CORE_PACKAGE,
    ),
  );
}

export function collectBindingInterfaces(
  this: ManagerContext,
): Map<string, BindingInterface> {
  const packages = this.bindablePackages();
  const interfaces = new Map<string, BindingInterface>();
  for (const name of packages) {
    const root = this.resolver.interfacePackages.get(name)!;
    interfaces.set(name, {
      name,
      dependencies: readInterfaceDependencies(name, root, packages),
    });
  }
  return interfaces;
}

export function collectBindingModules(
  this: ManagerContext,
): Map<string, BindingModule> {
  const packages = this.bindablePackages();
  const modules = new Map<string, BindingModule>();
  for (const { module, config } of this.getAllManagedModules()) {
    modules.set(
      module.id,
      toBindingModule(module, config, packages, this.resolvedConnections),
    );
  }
  return modules;
}

export function collectInterfaceSources(
  this: ManagerContext,
): Map<string, Module[]> {
  this.resolver.moduleByFolder.clear();
  this.resolver.modulesById.clear();
  this.resolver.interfacePackages.clear();
  this.resolver.interfacePackageEntries.clear();
  this.resolver.interfacePackageResolveFrom.clear();
  this.resolver.lifecycleInterfacePackages.clear();
  this.resolver.stubbedInterfacePackages.clear();
  this.interfacePackagePlans.clear();
  this.resolvedAssociations.clear();
  this.resolvedConnections.clear();
  this.selectedProviders.clear();
  this.moduleTracker.clear();
  this.interfaceRegistry.clear();

  const interfaceSources = new Map<string, Module[]>();
  for (const { module, config } of this.loaded.values()) {
    this.resolver.moduleByFolder.set(module.manifest.folder, module);
    this.resolver.modulesById.set(module.id, module);
    this.moduleTracker.add({
      dir: module.manifest.folder,
      id: module.id,
      isImplementor: (module.manifest.implements ?? []).length > 0,
    });

    for (const interfacePackage of module.manifest.implements ?? []) {
      if (!config.disabledExports?.has(interfacePackage)) {
        this.addInterfaceSource(interfaceSources, interfacePackage, module);
      }
    }
  }

  for (const { module, config } of this.staticModules) {
    this.resolver.modulesById.set(module.id, module);

    for (const interfacePackage of module.manifest.implements ?? []) {
      if (!config.disabledExports?.has(interfacePackage)) {
        this.addInterfaceSource(interfaceSources, interfacePackage, module);
      }
    }
  }
  this.resolveInterfacePackagePaths(interfaceSources);

  return interfaceSources;
}

export function buildModuleAssociations(
  this: ManagerContext,
  interfaceSources: Map<string, Module[]>,
): void {
  for (const { module, config } of this.loaded.values()) {
    const connections = new Map<string, InterfaceConnectionRef[]>();
    const selected = new Map<string, string>();
    this.addDefaultAssociations(
      module,
      connections,
      selected,
      interfaceSources,
    );
    this.applyImportOverrides(
      module.id,
      config.importOverrides,
      connections,
      selected,
    );
    this.resolvedAssociations.set(module.id, new Set(connections.keys()));
    this.resolvedConnections.set(module.id, connections);
    this.selectedProviders.set(module.id, selected);
    this.interfaceRegistry.setConnections(module.id, connections, selected);
  }
}

export function addDefaultAssociations(
  this: ManagerContext,
  module: Module,
  connections: Map<string, InterfaceConnectionRef[]>,
  selected: Map<string, string>,
  interfaceSources: Map<string, Module[]>,
): void {
  const dependencies = module.manifest.manifest.dependencies ?? {};
  const optionalDependencies =
    module.manifest.manifest.optionalDependencies ?? {};
  for (const [iface, providers] of interfaceSources) {
    if (iface in dependencies || iface in optionalDependencies) {
      const providerIds = providers.map(({ id }) => id).sort();
      const defaultProvider = providerIds[0];
      if (!defaultProvider) {
        continue;
      }
      connections.set(
        iface,
        providerIds.map((provider) => ({ module: provider })),
      );
      selected.set(iface, defaultProvider);
    }
  }
}

export function applyImportOverrides(
  this: ManagerContext,
  moduleId: string,
  importOverrides: Map<string, InterfaceConnectionRef[]> | undefined,
  connections: Map<string, InterfaceConnectionRef[]>,
  selected: Map<string, string | undefined>,
): void {
  if (!importOverrides) {
    return;
  }
  for (const [iface, overrides] of importOverrides.entries()) {
    this.validateImportOverrides(moduleId, iface, overrides);
    connections.set(iface, overrides);
    if (overrides[0].module === undefined) {
      selected.delete(iface);
    } else {
      selected.set(iface, overrides[0].module);
    }
  }
}

export function addInterfaceSource(
  this: ManagerContext,
  sources: Map<string, Module[]>,
  interfaceName: string,
  module: Module,
): void {
  const providers = sources.get(interfaceName) ?? [];
  providers.push(module);
  sources.set(interfaceName, providers);
}

export function validateImportOverrides(
  this: ManagerContext,
  consumerId: string,
  interfaceName: string,
  overrides: InterfaceConnectionRef[],
): void {
  if (overrides.length === 0) {
    throw new Error(
      `Module '${consumerId}' has no providers in its '${interfaceName}' import override.`,
    );
  }
  const connectionIds = new Set<string>();
  for (const override of overrides) {
    this.validateOverrideSource(consumerId, interfaceName, override.module);
    if (override.id && connectionIds.has(override.id)) {
      throw new Error(
        `Module '${consumerId}' has duplicate connection ID '${override.id}' for '${interfaceName}'.`,
      );
    }
    if (override.id) {
      connectionIds.add(override.id);
    }
  }
}

export function validateOverrideSource(
  this: ManagerContext,
  consumerId: string,
  interfaceName: string,
  source: string | undefined,
): void {
  if (source === undefined) {
    this.validateSelfHostedConnection(consumerId, interfaceName);
    return;
  }
  const target = this.getModuleEntry(source);
  const implementsInterface =
    target?.module.manifest.implements.includes(interfaceName) &&
    !target.config.disabledExports?.has(interfaceName);
  if (!implementsInterface) {
    throw new Error(
      `Module '${consumerId}' routes '${interfaceName}' to '${source}', but that loaded module does not provide the interface.`,
    );
  }
}

export function validateSelfHostedConnection(
  this: ManagerContext,
  consumerId: string,
  interfaceName: string,
): void {
  if (this.hasLiveImplementer(interfaceName, new Set())) {
    throw new Error(
      `Module '${consumerId}' declares a '${interfaceName}' connection without a source, but loaded modules provide that interface; name the provider.`,
    );
  }
}
