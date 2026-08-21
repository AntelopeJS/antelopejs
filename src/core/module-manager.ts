import * as path from "node:path";
import { Logging } from "@antelopejs/interface-core/logging";
import { satisfies, validRange } from "semver";
import { ModuleState } from "../types";
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
import {
  isPathWithin,
  type ResolvedPackage,
  resolvePackage,
  resolvePackageAtRoot,
  resolvePackageSubpath,
} from "./resolution/package-resolution";
import { PathMapper } from "./resolution/path-mapper";
import { Resolver } from "./resolution/resolver";
import { ResolverDetour } from "./resolution/resolver-detour";
import {
  clearStubInterfaceWarnings,
  logStubInterfaceWarningOnce,
  neutralizeInterfacePackage,
  type StubInterfaceCleanup,
} from "./resolution/stub-interface-runtime";

const Logger = new Logging.Channel("loader");
const INTERFACE_DECLARATIONS_SUBPATH = "interface-declarations";

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

interface InterfacePackageConsumer {
  moduleId: string;
  range: string;
  resolvedPackage?: ResolvedPackage;
}

interface InterfacePackagePlan {
  canonicalPackage: ResolvedPackage;
  consumers: InterfacePackageConsumer[];
}

type ModuleOperation = (module: Module) => Promise<void>;

interface ModuleOperationResults {
  errors: unknown[];
  failed: ManagedModule[];
}

function collectCachedModuleClosure(
  entryPath: string,
  files: Set<string>,
): void {
  const entry = require.cache[require.resolve(entryPath)];
  if (!entry) {
    return;
  }
  const pending = [entry];
  const visited = new Set<NodeModule>();
  while (pending.length > 0) {
    const loaded = pending.pop();
    if (!loaded || visited.has(loaded)) {
      continue;
    }
    visited.add(loaded);
    files.add(loaded.filename);
    pending.push(...loaded.children);
  }
}

export class ModuleManager {
  public readonly registry: ModuleRegistry;
  public readonly resolver: Resolver;
  private readonly interfaceRegistry: InterfaceRegistry;
  private readonly moduleTracker: ModuleTracker;
  private readonly resolverDetour: ResolverDetour;
  private readonly interfaceStubCleanups: StubInterfaceCleanup[] = [];
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
  private readonly interfaceDeclarationEntries = new Map<string, string>();
  private readonly interfaceDeclarationFiles = new Set<string>();
  private pendingCleanup: ManagedModule[] = [];
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
    this.prepareModuleFiles(created);
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
      if (this.interfaceDeclarationFiles.has(filePath)) {
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
    const packageNames = new Set(
      stubbed.map((entry) => entry.interfacePackage),
    );
    for (const packageName of packageNames) {
      const entries = stubbed.filter(
        (entry) => entry.interfacePackage === packageName,
      );
      this.registerStubbedInterfacePackage(packageName, entries);
    }
  }

  private registerStubbedInterfacePackage(
    packageName: string,
    entries: UnresolvedInterface[],
  ): void {
    const consumers = this.collectInterfacePackageConsumers(packageName);
    const canonicalPackage = consumers.find(
      (consumer) => consumer.resolvedPackage,
    )?.resolvedPackage;
    if (!canonicalPackage) {
      return;
    }
    this.stubbedInterfacePackages.set(packageName, canonicalPackage);
    this.interfacePackagePlans.set(packageName, {
      canonicalPackage,
      consumers,
    });
    this.registerInterfacePackage(packageName, canonicalPackage);
    logStubInterfaceWarningOnce(
      packageName,
      entries.some((entry) => entry.standalone),
    );
  }

  private applyInterfaceStubs(shouldNeutralizeRegistrations = false): void {
    const implemented = this.collectImplementedInterfaces();
    for (const [interfaceName, resolvedPackage] of [
      ...this.stubbedInterfacePackages,
    ]) {
      if (implemented.has(interfaceName)) {
        this.stubbedInterfacePackages.delete(interfaceName);
        continue;
      }
      if (!this.resolver.interfacePackages.has(interfaceName)) {
        this.registerInterfacePackage(interfaceName, resolvedPackage);
      }
      try {
        require(interfaceName);
      } catch (err) {
        Logger.Error(`Failed to load interface '${interfaceName}':`, err);
        continue;
      }
      this.neutralizeStubbedInterface(
        interfaceName,
        resolvedPackage,
        shouldNeutralizeRegistrations,
      );
    }
  }

  private neutralizeStubbedInterface(
    interfaceName: string,
    resolvedPackage: ResolvedPackage,
    shouldNeutralizeRegistrations: boolean,
  ) {
    const providers = shouldNeutralizeRegistrations
      ? this.collectTestStubProviders(interfaceName)
      : [];
    if (!providers.length) {
      this.interfaceStubCleanups.push(
        ...neutralizeInterfacePackage(
          resolvedPackage.root,
          interfaceName,
          shouldNeutralizeRegistrations,
        ),
      );
      return;
    }
    providers.forEach((provider) => {
      this.interfaceStubCleanups.push(
        ...neutralizeInterfacePackage(
          resolvedPackage.root,
          interfaceName,
          true,
          provider,
        ),
      );
    });
  }

  private collectTestStubProviders(interfaceName: string): string[] {
    const consumers = new Set(
      this.collectInterfacePackageConsumers(interfaceName).map(
        ({ moduleId }) => moduleId,
      ),
    );
    return this.getAllManagedModules()
      .filter(
        (managed) =>
          consumers.has(managed.module.id) && this.isProvider(managed),
      )
      .map(({ module }) => module.id);
  }

  private isProvider({ module, config }: ManagedModule): boolean {
    return (module.manifest.implements ?? []).some(
      (interfaceName) => !config.disabledExports?.has(interfaceName),
    );
  }

  public applyTestInterfaceStubs(): void {
    this.applyInterfaceStubs(true);
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
    const leaseAcquired = this.resolverDetour.attach();
    const modules = [...this.loaded.values()];
    try {
      this.validateInterfacePackages();
      this.applyInterfaceStubs();
      this.prepareModuleFiles(modules);
    } catch (error) {
      if (leaseAcquired) {
        throw aggregateErrors(
          [error, ...this.releaseRuntimeState()],
          "Failed to construct modules",
        );
      }
      throw error;
    }

    const results = await Promise.allSettled(
      modules.map(({ module, config }) =>
        this.constructModule(module, config.config),
      ),
    );
    const errors = collectRejectedErrors(results);
    if (errors.length === 0) {
      return;
    }

    const cleanupCandidates = modules.filter(
      ({ module }) => module.state !== ModuleState.Loaded,
    );
    const cleanupErrors = await runModuleOperations(
      cleanupCandidates.reverse(),
      (module) => module.destroy(),
    );
    if (leaseAcquired) {
      cleanupErrors.push(...this.releaseRuntimeState());
    }
    throw new AggregateError(
      [...errors, ...cleanupErrors],
      "Failed to construct modules",
    );
  }

  async constructModules(modules: ManagedModule[]): Promise<void> {
    const leaseAcquired = this.resolverDetour.attach();
    try {
      this.validateInterfacePackages();
      this.applyInterfaceStubs();
      this.prepareModuleFiles(modules);
      await Promise.all(
        modules.map(({ module, config }) =>
          this.constructModule(module, config.config),
        ),
      );
    } catch (error) {
      if (leaseAcquired) {
        throw aggregateErrors(
          [error, ...this.releaseRuntimeState()],
          "Failed to construct modules",
        );
      }
      throw error;
    }
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
    const results = await runTrackedModuleOperations(modules, (module) =>
      module.destroy(),
    );
    this.pendingCleanup = results.failed.filter(
      ({ module }) => module.state !== ModuleState.Loaded,
    );
    const errors = [...results.errors, ...this.clearManagedState()];
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
    const loadedModules = orderedIds.flatMap((id) => {
      const entry = this.loaded.get(id);
      return entry ? [entry] : [];
    });
    const loadedInstances = new Set(loadedModules.map(({ module }) => module));
    return [
      ...loadedModules,
      ...this.pendingCleanup.filter(
        ({ module }) => !loadedInstances.has(module),
      ),
    ];
  }

  private clearManagedState(): unknown[] {
    this.loaded.clear();
    this.staticModules.length = 0;
    this.registry.clear();
    this.resolvedAssociations.clear();
    this.resolver.moduleByFolder.clear();
    this.resolver.modulesById.clear();
    this.resolver.interfacePackages.clear();
    this.resolver.interfacePackageEntries.clear();
    this.resolver.interfacePackageResolveFrom.clear();
    this.interfaceDeclarationEntries.clear();
    this.interfaceDeclarationFiles.clear();
    this.interfacePackagePlans.clear();
    this.startupOrder = [];
    return this.releaseRuntimeState();
  }

  private releaseRuntimeState(): unknown[] {
    const errors: unknown[] = [];
    this.stubbedInterfacePackages.clear();
    clearStubInterfaceWarnings();
    this.moduleTracker.clear();
    this.interfaceRegistry.clear();
    for (const cleanup of this.interfaceStubCleanups.splice(0)) {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      this.resolverDetour.detach();
    } catch (error) {
      errors.push(error);
    }
    return errors;
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
    this.resolver.interfacePackageEntries.clear();
    this.resolver.interfacePackageResolveFrom.clear();
    this.interfaceDeclarationEntries.clear();
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

  private resolveInterfacePackagePaths(
    interfaceSources: Map<string, Module[]>,
  ): void {
    for (const [ifacePkg, modules] of interfaceSources) {
      const module = [...modules].sort((left, right) =>
        left.id.localeCompare(right.id),
      )[0];
      if (!module) {
        continue;
      }
      const canonicalPackage = this.resolveImplementedPackage(ifacePkg, module);
      if (!canonicalPackage) {
        continue;
      }
      this.interfacePackagePlans.set(ifacePkg, {
        canonicalPackage,
        consumers: this.collectInterfacePackageConsumers(ifacePkg),
      });
      this.registerInterfacePackage(
        ifacePkg,
        canonicalPackage,
        this.resolveInterfaceDeclarationEntry(
          ifacePkg,
          canonicalPackage,
          modules.some(
            (provider) => provider.manifest.manifest.name === ifacePkg,
          ),
        ),
      );
    }
    for (const [packageName, canonicalPackage] of this
      .stubbedInterfacePackages) {
      if (interfaceSources.has(packageName)) {
        continue;
      }
      this.interfacePackagePlans.set(packageName, {
        canonicalPackage,
        consumers: this.collectInterfacePackageConsumers(packageName),
      });
      this.registerInterfacePackage(
        packageName,
        canonicalPackage,
        canonicalPackage.entry,
      );
    }
  }

  private resolveInterfaceDeclarationEntry(
    packageName: string,
    resolvedPackage: ResolvedPackage,
    isSelfImplemented: boolean,
  ): string {
    if (!isSelfImplemented) {
      return resolvedPackage.entry;
    }
    const declarationEntry = resolvePackageSubpath(
      packageName,
      INTERFACE_DECLARATIONS_SUBPATH,
      resolvedPackage,
    );
    if (declarationEntry) {
      return declarationEntry;
    }
    throw new Error(
      `Self-implemented interface package '${packageName}' must export a side-effect-free './${INTERFACE_DECLARATIONS_SUBPATH}' entry.`,
    );
  }

  private resolveImplementedPackage(
    packageName: string,
    module: Module,
  ): ResolvedPackage | undefined {
    const resolvedPackage = resolvePackage(packageName, module.manifest.folder);
    if (resolvedPackage) {
      return resolvedPackage;
    }
    if (module.manifest.manifest.name !== packageName) {
      return undefined;
    }
    return resolvePackageAtRoot(
      packageName,
      module.manifest.folder,
      module.manifest.version,
    );
  }

  private collectInterfacePackageConsumers(
    packageName: string,
  ): InterfacePackageConsumer[] {
    const consumers: InterfacePackageConsumer[] = [];
    for (const { module } of this.loaded.values()) {
      const manifest = module.manifest.manifest;
      const range =
        manifest.dependencies?.[packageName] ??
        manifest.optionalDependencies?.[packageName];
      if (!range) {
        continue;
      }
      consumers.push({
        moduleId: module.id,
        range,
        resolvedPackage: resolvePackage(packageName, module.manifest.folder),
      });
    }
    return consumers;
  }

  private registerInterfacePackage(
    packageName: string,
    resolvedPackage: ResolvedPackage,
    declarationEntry = resolvedPackage.entry,
  ): void {
    this.resolver.interfacePackages.set(packageName, resolvedPackage.root);
    this.resolver.interfacePackageEntries.set(
      packageName,
      resolvedPackage.entry,
    );
    this.resolver.interfacePackageResolveFrom.set(
      packageName,
      resolvedPackage.resolveFrom,
    );
    this.interfaceDeclarationEntries.set(packageName, declarationEntry);
  }

  private validateInterfacePackages(): void {
    const errors = [...this.interfacePackagePlans].flatMap(([name, plan]) => [
      ...this.findVersionErrors(name, plan),
      ...this.findPreloadedCopyErrors(name, plan),
    ]);
    if (errors.length === 0) {
      return;
    }
    throw new Error(
      `Incompatible interface package resolution:\n${errors.join("\n")}`,
    );
  }

  private findVersionErrors(
    packageName: string,
    plan: InterfacePackagePlan,
  ): string[] {
    return plan.consumers.flatMap((consumer) => {
      const range = validRange(consumer.range);
      if (!range || satisfies(plan.canonicalPackage.version, range)) {
        return [];
      }
      const installed = consumer.resolvedPackage
        ? `${consumer.resolvedPackage.version} at ${consumer.resolvedPackage.root}`
        : "not installed from the consumer";
      return [
        `  - ${consumer.moduleId} requires ${packageName}@${consumer.range}, but the canonical package is ${plan.canonicalPackage.version} at ${plan.canonicalPackage.root} (consumer copy: ${installed})`,
      ];
    });
  }

  private findPreloadedCopyErrors(
    packageName: string,
    plan: InterfacePackagePlan,
  ): string[] {
    const canonicalRoot = plan.canonicalPackage.realRoot;
    const copies = plan.consumers
      .map((consumer) => consumer.resolvedPackage)
      .filter((resolvedPackage): resolvedPackage is ResolvedPackage =>
        Boolean(resolvedPackage && resolvedPackage.realRoot !== canonicalRoot),
      );
    return copies.flatMap((copy) => {
      const loadedFile = Object.keys(require.cache).find((filePath) =>
        isPathWithin(filePath, copy.root),
      );
      return loadedFile
        ? [
            `  - ${packageName}@${copy.version} was loaded from ${copy.root} before the canonical copy at ${plan.canonicalPackage.root}; preloaded interface copies cannot be redirected (${loadedFile})`,
          ]
        : [];
    });
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
          declarationEntry: this.interfaceDeclarationEntries.get(interfaceName),
          provider,
          providerCount: new Set(
            connections.get(interfaceName)?.map(({ module }) => module),
          ).size,
        }),
      );
      module.setProviderRoutes(
        buildProviderRoutes(module.id, routes),
        this.isProvider({ module, config }),
      );
    }
    this.refreshInterfaceDeclarationFiles();
  }

  private refreshInterfaceDeclarationFiles(): void {
    const files = new Set<string>();
    const entries = new Set(this.interfaceDeclarationEntries.values());
    for (const entry of entries) {
      collectCachedModuleClosure(entry, files);
    }
    this.interfaceDeclarationFiles.clear();
    for (const filePath of files) {
      this.interfaceDeclarationFiles.add(filePath);
    }
  }

  private prepareModuleFiles(modules: ManagedModule[]): void {
    this.refreshInterfaceDeclarationFiles();
    for (const { module } of modules) {
      if (module.state === ModuleState.Loaded && module.manifest?.folder) {
        this.unrequireModuleFiles(module.id);
      }
    }
  }

  private isPathWithin(filePath: string, dirPath: string): boolean {
    return isPathWithin(filePath, dirPath);
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

function aggregateErrors(errors: unknown[], message: string): unknown {
  return errors.length === 1 ? errors[0] : new AggregateError(errors, message);
}

async function runModuleOperations(
  modules: ManagedModule[],
  operation: ModuleOperation,
): Promise<unknown[]> {
  return (await runTrackedModuleOperations(modules, operation)).errors;
}

async function runTrackedModuleOperations(
  modules: ManagedModule[],
  operation: ModuleOperation,
): Promise<ModuleOperationResults> {
  const errors: unknown[] = [];
  const failed: ManagedModule[] = [];
  for (const entry of modules) {
    try {
      await operation(entry.module);
    } catch (error) {
      errors.push(...unpackErrors(error));
      failed.push(entry);
    }
  }
  return { errors, failed };
}
