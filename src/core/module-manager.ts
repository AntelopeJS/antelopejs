import * as path from "node:path";
import { Logging } from "@antelopejs/interface-core/logging";
import {
  type InterfaceConnectionRef,
  InterfaceRegistry,
} from "./interface-registry";
import { Module } from "./module";
import {
  buildProviderRoutes,
  type InterfaceProviderRoute,
} from "./module-context";
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
    this.resolverDetour.attach();
    this.applyInterfaceStubs();
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
    this.applyInterfaceStubs();
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

  async startAll(): Promise<void> {
    await this.startModules([...this.loaded.values()]);
  }

  async startModules(modules: ManagedModule[]): Promise<void> {
    const starting: Promise<void>[] = [];
    for (const { module } of modules) {
      starting.push(module.start());
      this.trackModuleStart(module.id);
    }
    await Promise.all(starting);
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
      this.stubbedInterfacePaths.clear();
      clearStubInterfaceWarnings();
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
    this.configureModuleContexts();
  }

  private collectInterfaceSources(): Map<string, Module[]> {
    this.resolver.moduleByFolder.clear();
    this.resolver.modulesById.clear();
    this.resolver.interfacePackages.clear();
    this.resolvedAssociations.clear();
    this.resolvedConnections.clear();
    this.selectedProviders.clear();
    this.moduleTracker.clear();

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

  private resolveInterfacePackagePaths(
    interfaceSources: Map<string, Module[]>,
  ): void {
    for (const [ifacePkg, modules] of interfaceSources) {
      const module = modules[0];
      if (!module) {
        continue;
      }
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

  private buildModuleAssociations(
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

  private addDefaultAssociations(
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

  private applyImportOverrides(
    moduleId: string,
    importOverrides: Map<string, InterfaceConnectionRef[]> | undefined,
    connections: Map<string, InterfaceConnectionRef[]>,
    selected: Map<string, string>,
  ): void {
    if (!importOverrides) {
      return;
    }
    for (const [iface, overrides] of importOverrides.entries()) {
      this.validateImportOverrides(moduleId, iface, overrides);
      connections.set(iface, overrides);
      selected.set(iface, overrides[0].module);
    }
  }

  private addInterfaceSource(
    sources: Map<string, Module[]>,
    interfaceName: string,
    module: Module,
  ): void {
    const providers = sources.get(interfaceName) ?? [];
    providers.push(module);
    sources.set(interfaceName, providers);
  }

  private validateImportOverrides(
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
      const target = this.getModuleEntry(override.module);
      const implementsInterface =
        target?.module.manifest.implements.includes(interfaceName) &&
        !target.config.disabledExports?.has(interfaceName);
      if (!implementsInterface) {
        throw new Error(
          `Module '${consumerId}' routes '${interfaceName}' to '${override.module}', but that loaded module does not provide the interface.`,
        );
      }
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

  private configureModuleContexts(): void {
    for (const { module, config } of this.getAllManagedModules()) {
      const selected =
        this.selectedProviders.get(module.id) ?? new Map<string, string>();
      const connections =
        this.resolvedConnections.get(module.id) ??
        new Map<string, InterfaceConnectionRef[]>();
      const routes: InterfaceProviderRoute[] = [...selected].map(
        ([interfaceName, provider]) => ({
          interfaceName,
          packageRoot: this.resolver.interfacePackages.get(interfaceName),
          provider,
          providerCount: new Set(
            connections.get(interfaceName)?.map(({ module }) => module),
          ).size,
        }),
      );
      const isProvider = (module.manifest.implements ?? []).some(
        (interfaceName) => !config.disabledExports?.has(interfaceName),
      );
      module.setProviderRoutes(
        buildProviderRoutes(module.id, routes),
        isProvider,
      );
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
