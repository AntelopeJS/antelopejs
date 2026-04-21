import * as path from "node:path";
import { Logging } from "@antelopejs/interface-core/logging";
import {
  type InterfaceConnectionRef,
  InterfaceRegistry,
} from "./interface-registry";
import { Module } from "./module";
import type { ModuleManifest } from "./module-manifest";
import { ModuleRegistry } from "./module-registry";
import { ModuleTracker } from "./module-tracker";
import { PathMapper } from "./resolution/path-mapper";
import { Resolver } from "./resolution/resolver";
import { ResolverDetour } from "./resolution/resolver-detour";

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

export class ModuleManager {
  public readonly registry: ModuleRegistry;
  public readonly resolver: Resolver;
  private readonly interfaceRegistry: InterfaceRegistry;
  private readonly moduleTracker: ModuleTracker;
  private readonly resolverDetour: ResolverDetour;
  private readonly resolvedAssociations = new Map<string, Set<string>>();
  private readonly staticModules: ManagedModule[] = [];
  private readonly loaded = new Map<string, ManagedModule>();
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

  async constructAll(): Promise<void> {
    this.resolverDetour.attach();
    try {
      await Promise.all(
        [...this.loaded.values()].map(({ module, config }) =>
          module.construct(config.config).catch((err) => {
            Logger.Error(`Failed to construct module:`);
            Logger.Error(`  - ID: ${module.id}`);
            Logger.Error(`  - Version: ${module.version}`);
            Logger.Error("  - Error:", err);
            throw err;
          }),
        ),
      );
    } catch (err) {
      this.resolverDetour.detach();
      throw err;
    }
  }

  async constructModules(modules: ManagedModule[]): Promise<void> {
    this.resolverDetour.attach();
    await Promise.all(
      modules.map(({ module, config }) =>
        module.construct(config.config).catch((err) => {
          Logger.Error(`Failed to construct module:`);
          Logger.Error(`  - ID: ${module.id}`);
          Logger.Error(`  - Version: ${module.version}`);
          Logger.Error("  - Error:", err);
          throw err;
        }),
      ),
    );
  }

  startAll(): void {
    for (const { module } of this.loaded.values()) {
      module.start();
      this.trackModuleStart(module.id);
    }
  }

  startModules(modules: ManagedModule[]): void {
    for (const { module } of modules) {
      module.start();
      this.trackModuleStart(module.id);
    }
  }

  async stopAll(): Promise<void> {
    const reverseOrder = [...this.startupOrder].reverse();
    const idsToStop =
      reverseOrder.length > 0
        ? reverseOrder
        : [...this.loaded.keys()].reverse();

    for (const id of idsToStop) {
      const entry = this.loaded.get(id);
      if (!entry) {
        continue;
      }

      try {
        await entry.module.stop();
      } catch (error) {
        Logger.Error(`Failed to stop module ${id}:`, error);
      }
    }

    this.startupOrder = [];
  }

  async destroyAll(): Promise<void> {
    const reverseOrder = [...this.startupOrder].reverse();
    const idsToDestroy =
      reverseOrder.length > 0
        ? reverseOrder
        : [...this.loaded.keys()].reverse();

    try {
      for (const id of idsToDestroy) {
        const entry = this.loaded.get(id);
        if (!entry) {
          continue;
        }
        await entry.module.destroy();
      }
    } finally {
      this.startupOrder = [];
      this.resolverDetour.detach();
    }
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
        // Walk up from the resolved main entry to find the package root
        // by looking for the package name in the path
        const pkgNameSegments = ifacePkg.split("/");
        const scopePrefix = ifacePkg.startsWith("@")
          ? `${pkgNameSegments[0]}/${pkgNameSegments[1]}`
          : pkgNameSegments[0];
        const scopeIndex = mainPath.lastIndexOf(scopePrefix);
        if (scopeIndex !== -1) {
          const pkgRoot = mainPath.substring(
            0,
            scopeIndex + scopePrefix.length,
          );
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
    for (const [iface, provider] of interfaceSources) {
      if (iface in dependencies) {
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
