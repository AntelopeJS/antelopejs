import { Module } from './module';
import { ModuleManifest } from './module-manifest';
import { ModuleRegistry } from './module-registry';
import { Resolver } from './resolution/resolver';
import { ResolverDetour } from './resolution/resolver-detour';
import { PathMapper } from './resolution/path-mapper';
import { InterfaceRegistry, InterfaceConnectionRef } from './interface-registry';
import { ModuleTracker } from './module-tracker';

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

  addModules(entries: Array<{ manifest: ModuleManifest; config?: ModuleConfig }>): void {
    for (const entry of entries) {
      const module = new Module(entry.manifest);
      const config: ModuleConfig = {
        config: entry.config?.config,
        importOverrides: entry.config?.importOverrides ?? new Map(),
        disabledExports: entry.config?.disabledExports ?? new Set(),
      };
      this.registry.register(module);
      this.loaded.set(module.id, { module, config });
    }

    this.rebuildAssociations();
  }

  listModules(): string[] {
    return this.registry.list();
  }

  getModule(id: string): Module | undefined {
    return this.registry.get(id);
  }

  async constructAll(): Promise<void> {
    this.resolverDetour.attach();
    try {
      for (const { module, config } of this.loaded.values()) {
        await module.construct(config.config);
      }
    } catch (err) {
      this.resolverDetour.detach();
      throw err;
    }
  }

  startAll(): void {
    for (const { module } of this.loaded.values()) {
      module.start();
    }
  }

  stopAll(): void {
    for (const { module } of this.loaded.values()) {
      module.stop();
    }
  }

  async destroyAll(): Promise<void> {
    try {
      for (const { module } of this.loaded.values()) {
        await module.destroy();
      }
    } finally {
      this.resolverDetour.detach();
    }
  }

  private rebuildAssociations(): void {
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

    for (const { module, config } of this.loaded.values()) {
      const associations = new Map<string, Module | null>();
      const connections = new Map<string, InterfaceConnectionRef[]>();

      for (const iface of module.manifest.imports) {
        const provider = interfaceSources.get(iface);
        if (provider) {
          associations.set(iface, provider);
          connections.set(iface, [{ module: provider.id }]);
        }
      }

      if (config.importOverrides) {
        for (const [iface, overrides] of config.importOverrides.entries()) {
          const usable = overrides.filter((override) => this.loaded.has(override.module));
          connections.set(iface, usable);
          if (usable.length > 0) {
            const target = this.loaded.get(usable[0].module)!.module;
            associations.set(iface, target);
          }
        }
      }

      this.resolver.moduleAssociations.set(module.id, associations);
      this.interfaceRegistry.setConnections(module.id, connections);
    }
  }
}
