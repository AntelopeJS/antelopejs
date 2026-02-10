import * as path from 'path';
import { Module } from './module';
import { ModuleManifest } from './module-manifest';
import { ModuleRegistry } from './module-registry';
import { Resolver } from './resolution/resolver';
import { ResolverDetour } from './resolution/resolver-detour';
import { PathMapper } from './resolution/path-mapper';
import { InterfaceRegistry, InterfaceConnectionRef } from './interface-registry';
import { ModuleTracker } from './module-tracker';
import { Logging } from '../interfaces/logging/beta';

const Logger = new Logging.Channel('loader');

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

  addStaticModule(entry: { manifest: ModuleManifest; config?: ModuleConfig }): void {
    const module = new Module(entry.manifest);
    const config: ModuleConfig = {
      config: entry.config?.config,
      importOverrides: entry.config?.importOverrides ?? new Map(),
      disabledExports: entry.config?.disabledExports ?? new Set(),
    };
    this.registry.register(module);
    this.staticModules.push({ module, config });
  }

  addModules(entries: Array<{ manifest: ModuleManifest; config?: ModuleConfig }>): ManagedModule[] {
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
    return this.loaded.get(id) ?? this.staticModules.find((entry) => entry.module.id === id);
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

  unrequireModuleFiles(moduleId: string): void {
    const entry = this.loaded.get(moduleId);
    if (!entry) {
      return;
    }

    const moduleFolder = path.resolve(entry.module.manifest.folder);
    const avoidedFolders = new Set<string>();

    if (entry.module.manifest.exportsPath) {
      avoidedFolders.add(path.resolve(entry.module.manifest.exportsPath));
    }
    avoidedFolders.add(path.join(moduleFolder, 'node_modules'));

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

  async constructAll(): Promise<void> {
    this.resolverDetour.attach();
    try {
      await Promise.all(
        [...this.loaded.values()].map(({ module, config }) =>
          module.construct(config.config).catch((err) => {
            Logger.Error(`Failed to construct module:`);
            Logger.Error(`  - ID: ${module.id}`);
            Logger.Error(`  - Version: ${module.version}`);
            Logger.Error('  - Error:', err);
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
          Logger.Error('  - Error:', err);
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

    for (const id of reverseOrder) {
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
    const idsToDestroy = reverseOrder.length > 0 ? reverseOrder : [...this.loaded.keys()].reverse();

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
    this.resolver.moduleAssociations.clear();
    this.resolver.modulesById.clear();
    this.moduleTracker.clear();

    const interfaceSources = new Map<string, Module>();
    for (const { module, config } of this.loaded.values()) {
      this.resolver.moduleByFolder.set(module.manifest.folder, module);
      this.resolver.modulesById.set(module.id, module);
      this.moduleTracker.add({
        dir: module.manifest.folder,
        id: module.id,
        interfaceDir: module.manifest.exportsPath,
      });

      for (const [nameVersion] of Object.entries(module.manifest.exports)) {
        if (!config.disabledExports?.has(nameVersion)) {
          interfaceSources.set(nameVersion, module);
        }
      }
    }

    for (const { module, config } of this.staticModules) {
      this.resolver.modulesById.set(module.id, module);
      for (const [nameVersion] of Object.entries(module.manifest.exports)) {
        if (!config.disabledExports?.has(nameVersion)) {
          interfaceSources.set(nameVersion, module);
        }
      }
    }
    return interfaceSources;
  }

  private buildModuleAssociations(interfaceSources: Map<string, Module>): void {
    for (const { module, config } of this.loaded.values()) {
      const associations = new Map<string, Module | null>();
      const connections = new Map<string, InterfaceConnectionRef[]>();
      this.addDefaultAssociations(module, associations, connections, interfaceSources);
      this.applyImportOverrides(config.importOverrides, associations, connections);
      this.resolver.moduleAssociations.set(module.id, associations);
      this.interfaceRegistry.setConnections(module.id, connections);
    }
  }

  private addDefaultAssociations(
    module: Module,
    associations: Map<string, Module | null>,
    connections: Map<string, InterfaceConnectionRef[]>,
    interfaceSources: Map<string, Module>,
  ): void {
    for (const iface of module.manifest.imports) {
      const provider = interfaceSources.get(iface);
      if (provider) {
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
      const usable = overrides.filter((override) => this.loaded.has(override.module));
      connections.set(iface, usable);
      if (usable.length > 0) {
        const target = this.loaded.get(usable[0].module)!.module;
        associations.set(iface, target);
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
