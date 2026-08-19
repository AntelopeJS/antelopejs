import * as path from "node:path";
import { Logging } from "@antelopejs/interface-core/logging";
import { ModuleState } from "../types";
import {
  type InterfaceConnectionRef,
  InterfaceRegistry,
} from "./interface-registry";
import { Module } from "./module";
import type { ModuleManifest } from "./module-manifest";
import { ModuleRegistry } from "./module-registry";
import { ModuleTracker } from "./module-tracker";
import type { UnresolvedInterface } from "./resolution/interface-resolution";
import { PathMapper } from "./resolution/path-mapper";
import { Resolver } from "./resolution/resolver";
import { ResolverDetour } from "./resolution/resolver-detour";
import {
  clearStubInterfaceWarnings,
  logStubInterfaceWarningOnce,
  neutralizeInterfacePackage,
} from "./resolution/stub-interface-runtime";

const Logger = new Logging.Channel("loader");

export interface ModuleConfig {
  config?: unknown;
  importOverrides?: Map<string, InterfaceConnectionRef[]>;
  disabledExports?: Set<string>;
}

export interface ManagedModule {
  module: Module;
  config: ModuleConfig;
}

interface ModuleManagerDeps {
  registry?: ModuleRegistry;
  resolver?: Resolver;
  interfaceRegistry?: InterfaceRegistry;
  moduleTracker?: ModuleTracker;
}

type ModuleOperation = (module: Module) => Promise<void>;

export class ModuleManager {
  public readonly registry: ModuleRegistry;
  public readonly resolver: Resolver;
  private readonly interfaceRegistry: InterfaceRegistry;
  private readonly moduleTracker: ModuleTracker;
  private readonly resolverDetour: ResolverDetour;
  private readonly resolvedAssociations = new Map<string, Set<string>>();
  private readonly staticModules: ManagedModule[] = [];
  private readonly loaded = new Map<string, ManagedModule>();
  private readonly stubbedInterfacePaths = new Map<string, string>();
  private startupOrder: string[] = [];

  constructor(deps: ModuleManagerDeps = {}) {
    this.registry = deps.registry ?? new ModuleRegistry();
    this.resolver = deps.resolver ?? new Resolver(new PathMapper());
    this.resolverDetour = new ResolverDetour(this.resolver);
    this.interfaceRegistry = deps.interfaceRegistry ?? new InterfaceRegistry();
    this.moduleTracker = deps.moduleTracker ?? new ModuleTracker();
  }

  addStaticModule(entry: {
    manifest: ModuleManifest;
    config?: ModuleConfig;
  }): void {
    const module = new Module(entry.manifest);
    const config: ModuleConfig = {
      config: entry.config?.config,
      importOverrides: entry.config?.importOverrides ?? new Map(),
      disabledExports: entry.config?.disabledExports ?? new Set(),
    };
    this.registry.register(module);
    this.staticModules.push({ module, config });
  }

  addModules(
    entries: Array<{ manifest: ModuleManifest; config?: ModuleConfig }>,
  ): ManagedModule[] {
    const created: ManagedModule[] = [];
    for (const entry of entries) {
      const module = new Module(entry.manifest);
      const config: ModuleConfig = {
        config: entry.config?.config,
        importOverrides: entry.config?.importOverrides ?? new Map(),
        disabledExports: entry.config?.disabledExports ?? new Set(),
      };
      this.registry.register(module);
      const managed = { module, config };
      this.loaded.set(module.id, managed);
      created.push(managed);
    }

    this.rebuildAssociations();
    return created;
  }

  listModules(): string[] {
    return this.registry.list();
  }

  getModule(id: string): Module | undefined {
    return this.registry.get(id);
  }

  getModuleEntry(id: string): ManagedModule | undefined {
    return (
      this.loaded.get(id) ??
      this.staticModules.find((entry) => entry.module.id === id)
    );
  }

  getLoadedModuleEntry(id: string): ManagedModule | undefined {
    return this.loaded.get(id);
  }

  getLoadedModules(): IterableIterator<ManagedModule> {
    if (!(this.loaded instanceof Map)) {
      return new Map<string, ManagedModule>().values();
    }
    return this.loaded.values();
  }

  getAllManagedModules(): ManagedModule[] {
    return [...this.staticModules, ...this.loaded.values()];
  }

  unrequireModuleFiles(moduleId: string): void {
    const entry = this.loaded.get(moduleId);
    if (!entry) {
      return;
    }

    const moduleFolder = path.resolve(entry.module.manifest.folder);
    const avoidedFolders = new Set<string>();

    avoidedFolders.add(path.join(moduleFolder, "node_modules"));

    for (const [id, other] of this.loaded) {
      if (id === moduleId) {
        continue;
      }
      if (this.isPathWithin(other.module.manifest.folder, moduleFolder)) {
        avoidedFolders.add(path.resolve(other.module.manifest.folder));
      }
    }

    for (const filePath of Object.keys(require.cache)) {
      if (!this.isPathWithin(filePath, moduleFolder)) {
        continue;
      }
      let shouldDelete = true;
      for (const avoided of avoidedFolders) {
        if (this.isPathWithin(filePath, avoided)) {
          shouldDelete = false;
          break;
        }
      }
      if (shouldDelete) {
        delete require.cache[filePath];
      }
    }
  }

  replaceLoadedModule(id: string, module: Module): ManagedModule | undefined {
    const entry = this.loaded.get(id);
    if (!entry) {
      return;
    }
    entry.module = module;
    this.registry.register(module);
    return entry;
  }

  refreshAssociations(): void {
    this.rebuildAssociations();
  }

  hasResolvedInterface(moduleId: string, interfaceName: string): boolean {
    return this.resolvedAssociations.get(moduleId)?.has(interfaceName) ?? false;
  }

  registerStubbedInterfaces(stubbed: UnresolvedInterface[]): void {
    for (const { moduleId, interfacePackage, standalone } of stubbed) {
      if (this.stubbedInterfacePaths.has(interfacePackage)) {
        continue;
      }
      const consumerFolder = this.loaded.get(moduleId)?.module.manifest.folder;
      if (!consumerFolder) {
        continue;
      }
      const pkgRoot = this.resolveInterfacePackageRoot(
        interfacePackage,
        consumerFolder,
      );
      if (!pkgRoot) {
        continue;
      }
      this.stubbedInterfacePaths.set(interfacePackage, pkgRoot);
      this.resolver.interfacePackages.set(interfacePackage, pkgRoot);
      logStubInterfaceWarningOnce(interfacePackage, standalone);
    }
  }

  private resolveInterfacePackageRoot(
    ifacePkg: string,
    fromFolder: string,
  ): string | undefined {
    try {
      const mainPath = require.resolve(ifacePkg, { paths: [fromFolder] });
      return extractPackageRoot(mainPath, ifacePkg);
    } catch {
      return undefined;
    }
  }

  private applyInterfaceStubs(): void {
    const implemented = this.collectImplementedInterfaces();
    for (const [interfaceName, pkgRoot] of [...this.stubbedInterfacePaths]) {
      if (implemented.has(interfaceName)) {
        this.stubbedInterfacePaths.delete(interfaceName);
        continue;
      }
      if (!this.resolver.interfacePackages.has(interfaceName)) {
        this.resolver.interfacePackages.set(interfaceName, pkgRoot);
      }
      try {
        require(interfaceName);
      } catch (err) {
        Logger.Error(`Failed to load interface '${interfaceName}':`, err);
        continue;
      }
      neutralizeInterfacePackage(pkgRoot, interfaceName);
    }
  }

  private collectImplementedInterfaces(): Set<string> {
    const implemented = new Set<string>();
    for (const { module, config } of this.getAllManagedModules()) {
      for (const iface of module.manifest.implements ?? []) {
        if (!config.disabledExports?.has(iface)) {
          implemented.add(iface);
        }
      }
    }
    return implemented;
  }

  async constructAll(): Promise<void> {
    const modules = [...this.loaded.values()];
    this.resolverDetour.attach();
    this.applyInterfaceStubs();
    const results = await Promise.allSettled(
      modules.map(({ module, config }) =>
        this.constructModule(module, config.config),
      ),
    );
    const errors = collectRejectedErrors(results);
    if (errors.length === 0) {
      return;
    }

    const constructed = modules.filter(
      ({ module }, index) =>
        results[index].status === "fulfilled" ||
        module.state !== ModuleState.Loaded,
    );
    const cleanupErrors = await runModuleOperations(
      constructed.reverse(),
      (module) => module.destroy(),
    );
    this.resolverDetour.detach();
    throw new AggregateError(
      [...errors, ...cleanupErrors],
      "Failed to construct modules",
    );
  }

  async constructModules(modules: ManagedModule[]): Promise<void> {
    this.resolverDetour.attach();
    this.applyInterfaceStubs();
    await Promise.all(
      modules.map(({ module, config }) =>
        this.constructModule(module, config.config),
      ),
    );
  }

  async startAll(): Promise<void> {
    try {
      await this.startModules([...this.loaded.values()]);
    } catch (error) {
      let cleanupErrors: unknown[] = [];
      try {
        await this.destroyAll();
      } catch (cleanupError) {
        cleanupErrors = unpackErrors(cleanupError);
      }
      throw new AggregateError(
        [...unpackErrors(error), ...cleanupErrors],
        "Failed to start modules",
      );
    }
  }

  async startModules(modules: ManagedModule[]): Promise<void> {
    modules.forEach(({ module }) => {
      this.trackModuleStart(module.id);
    });
    const results = await Promise.allSettled(
      modules.map(({ module }) => module.start()),
    );
    const errors = collectRejectedErrors(results);
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to start modules");
    }
  }

  async stopAll(): Promise<void> {
    const modules = this.getReverseLifecycleModules();
    const errors = await runModuleOperations(modules, (module) =>
      module.stop(),
    );
    this.startupOrder = [];
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to stop modules");
    }
  }

  async destroyAll(): Promise<void> {
    const modules = this.getReverseLifecycleModules();
    const errors = await runModuleOperations(modules, (module) =>
      module.destroy(),
    );
    this.clearManagedState();
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to destroy modules");
    }
  }

  private async constructModule(
    module: Module,
    config: unknown,
  ): Promise<void> {
    try {
      await module.construct(config);
    } catch (error) {
      Logger.Error(`Failed to construct module:`);
      Logger.Error(`  - ID: ${module.id}`);
      Logger.Error(`  - Version: ${module.version}`);
      Logger.Error("  - Error:", error);
      throw error;
    }
  }

  private getReverseLifecycleModules(): ManagedModule[] {
    const orderedIds = [...this.startupOrder].reverse();
    const seen = new Set(orderedIds);
    for (const id of [...this.loaded.keys()].reverse()) {
      if (!seen.has(id)) {
        orderedIds.push(id);
      }
    }
    return orderedIds.flatMap((id) => {
      const entry = this.loaded.get(id);
      return entry ? [entry] : [];
    });
  }

  private clearManagedState(): void {
    const moduleIds = this.getAllManagedModules().map(
      ({ module }) => module.id,
    );
    this.interfaceRegistry.clear(moduleIds);
    this.loaded.clear();
    this.staticModules.length = 0;
    this.registry.clear();
    this.resolvedAssociations.clear();
    this.resolver.moduleByFolder.clear();
    this.resolver.modulesById.clear();
    this.resolver.interfacePackages.clear();
    this.moduleTracker.clear();
    this.startupOrder = [];
    this.stubbedInterfacePaths.clear();
    clearStubInterfaceWarnings();
    this.resolverDetour.detach();
  }

  private trackModuleStart(moduleId: string): void {
    this.startupOrder = this.startupOrder.filter((id) => id !== moduleId);
    this.startupOrder.push(moduleId);
  }

  private rebuildAssociations(): void {
    const interfaceSources = this.collectInterfaceSources();
    this.buildModuleAssociations(interfaceSources);
  }

  private collectInterfaceSources(): Map<string, Module> {
    this.resolver.moduleByFolder.clear();
    this.resolver.modulesById.clear();
    this.resolver.interfacePackages.clear();
    this.resolvedAssociations.clear();
    this.moduleTracker.clear();

    const interfaceSources = new Map<string, Module>();
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
          interfaceSources.set(interfacePackage, module);
        }
      }
    }

    for (const { module, config } of this.staticModules) {
      this.resolver.modulesById.set(module.id, module);

      for (const interfacePackage of module.manifest.implements ?? []) {
        if (!config.disabledExports?.has(interfacePackage)) {
          interfaceSources.set(interfacePackage, module);
        }
      }
    }
    this.resolveInterfacePackagePaths(interfaceSources);

    return interfaceSources;
  }

  private resolveInterfacePackagePaths(
    interfaceSources: Map<string, Module>,
  ): void {
    for (const [ifacePkg, module] of interfaceSources) {
      // If the module implements its own package, use its folder directly
      if (module.manifest.manifest.name === ifacePkg) {
        this.resolver.interfacePackages.set(ifacePkg, module.manifest.folder);
        continue;
      }
      try {
        const mainPath = require.resolve(ifacePkg, {
          paths: [module.manifest.folder],
        });
        const pkgRoot = extractPackageRoot(mainPath, ifacePkg);
        if (pkgRoot) {
          this.resolver.interfacePackages.set(ifacePkg, pkgRoot);
        }
      } catch {
        // Not an installable npm package (old-style name like "greeter@v1") — skip
      }
    }
  }

  private buildModuleAssociations(interfaceSources: Map<string, Module>): void {
    for (const { module, config } of this.loaded.values()) {
      const associations = new Map<string, Module | null>();
      const connections = new Map<string, InterfaceConnectionRef[]>();
      this.addDefaultAssociations(
        module,
        associations,
        connections,
        interfaceSources,
      );
      this.applyImportOverrides(
        config.importOverrides,
        associations,
        connections,
      );
      this.resolvedAssociations.set(module.id, new Set(associations.keys()));
      this.interfaceRegistry.setConnections(module.id, connections);
    }
  }

  private addDefaultAssociations(
    module: Module,
    associations: Map<string, Module | null>,
    connections: Map<string, InterfaceConnectionRef[]>,
    interfaceSources: Map<string, Module>,
  ): void {
    const dependencies = module.manifest.manifest.dependencies ?? {};
    const optionalDependencies =
      module.manifest.manifest.optionalDependencies ?? {};
    for (const [iface, provider] of interfaceSources) {
      if (iface in dependencies || iface in optionalDependencies) {
        associations.set(iface, provider);
        connections.set(iface, [{ module: provider.id }]);
      }
    }
  }

  private applyImportOverrides(
    importOverrides: Map<string, InterfaceConnectionRef[]> | undefined,
    associations: Map<string, Module | null>,
    connections: Map<string, InterfaceConnectionRef[]>,
  ): void {
    if (!importOverrides) {
      return;
    }
    for (const [iface, overrides] of importOverrides.entries()) {
      const usable = overrides.filter((override) =>
        this.loaded.has(override.module),
      );
      connections.set(iface, usable);
      if (usable.length > 0) {
        const target = this.loaded.get(usable[0].module)?.module;
        if (target) {
          associations.set(iface, target);
        }
      }
    }
  }

  private isPathWithin(filePath: string, dirPath: string): boolean {
    const normalizedDir = path.resolve(dirPath);
    const normalizedFile = path.resolve(filePath);
    if (normalizedFile === normalizedDir) {
      return true;
    }
    return normalizedFile.startsWith(normalizedDir + path.sep);
  }
}

function collectRejectedErrors(
  results: PromiseSettledResult<unknown>[],
): unknown[] {
  return results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
}

function unpackErrors(error: unknown): unknown[] {
  return error instanceof AggregateError ? error.errors : [error];
}

async function runModuleOperations(
  modules: ManagedModule[],
  operation: ModuleOperation,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const { module } of modules) {
    try {
      await operation(module);
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

function extractPackageRoot(
  mainPath: string,
  ifacePkg: string,
): string | undefined {
  const marker = `${path.sep}${ifacePkg.replace("/", path.sep)}${path.sep}`;
  const scopeIndex = mainPath.indexOf(marker);
  if (scopeIndex === -1) {
    return undefined;
  }
  return mainPath.substring(0, scopeIndex + marker.length - 1);
}
