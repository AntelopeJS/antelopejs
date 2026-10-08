import path from "node:path";
import { realpathSync } from "node:fs";
import {
  getModuleContext,
  runWithModuleContext,
} from "@antelopejs/interface-core/internal";

import type { PathMapper } from "./path-mapper";
import { ObservableMap } from "./observable-map";
import { resolvePackage } from "./package-resolution";
import type { ModuleManifest } from "../module-manifest";
import type { BindingGraph } from "./binding-graph-types";
import { PathOwnerIndex, type PathOwnerRoot } from "./path-owner-index";
import {
  type CanonicalPackage,
  InterfaceInstances,
} from "./interface-instances";

export interface ModuleRef {
  id: string;
  manifest: ModuleManifest;
}

interface ResolverParent {
  filename?: string;
}

export interface ResolveResult {
  /** What Node's own resolver is asked for. */
  resolvedPath: string;
  /** Folder Node's resolver resolves `resolvedPath` from, instead of the importer's. */
  resolveFrom?: string;
  /** Interface instance the resolved file is moved into. */
  instance?: string;
}

interface FileOwner {
  module?: ModuleRef;
  instance?: string;
}

interface ConnectionRequest {
  index: number;
  request: string;
}

const CORE_PKG = "@antelopejs/interface-core";
const CORE_PACKAGE = resolvePackage(CORE_PKG, __dirname);
const CORE_RESOLVE_FROM = CORE_PACKAGE?.root ?? __dirname;
const CORE_ENTRY = CORE_PACKAGE?.entry ?? CORE_PKG;
const CONNECTION_PREFIX = "@ajs.connection/";
const INSTANCE_OWNER_SUFFIX = "#instance";
const RELATIVE_OR_ABSOLUTE = /^(\.{1,2}(\/|\\|$)|\/|[A-Za-z]:[\\/])/;

function realFolder(folder: string): string {
  try {
    return realpathSync.native(folder);
  } catch {
    return path.resolve(folder);
  }
}

function parseConnection(request: string): ConnectionRequest | undefined {
  if (!request.startsWith(CONNECTION_PREFIX)) {
    return undefined;
  }
  const rest = request.slice(CONNECTION_PREFIX.length);
  const separator = rest.indexOf("/");
  const index = Number(rest.slice(0, separator));
  if (separator < 0 || !Number.isInteger(index)) {
    throw new Error(`Malformed connection path '${request}'.`);
  }
  return { index, request: rest.slice(separator + 1) };
}

/** The path a connection's interface instance is required from. */
export function connectionPath(index: number, packageName: string): string {
  return `${CONNECTION_PREFIX}${index}/${packageName}`;
}

/**
 * Resolves the requests modules and interface packages make.
 *
 * A request for an interface package resolves into the interface instance
 * the importer's bindings name: every importer bound the same way reaches the
 * same files, and each instance's proxies belong to a single provider.
 */
export class Resolver {
  public readonly moduleByFolder: Map<string, ModuleRef> = new ObservableMap(
    () => this.owners.invalidate(),
  );
  public readonly modulesById = new Map<string, ModuleRef>();
  public readonly interfacePackages: Map<string, string> = new ObservableMap(
    () => this.owners.invalidate(),
  );
  public readonly interfacePackageEntries = new Map<string, string>();
  public readonly interfacePackageResolveFrom = new Map<string, string>();
  public readonly lifecycleInterfacePackages = new Set<string>();
  public readonly stubbedInterfacePackages = new Set<string>();
  public stubModulePath?: string;
  public readonly instances = new InterfaceInstances(() =>
    this.owners.invalidate(),
  );
  private bindings?: BindingGraph;
  private readonly instanceFiles = new Map<string, string>();
  private readonly owners = new PathOwnerIndex<FileOwner>(() =>
    this.listOwnerRoots(),
  );

  constructor(private pathMapper: PathMapper) {}

  /** Adopts the bindings computed for the loaded modules. */
  setBindings(graph: BindingGraph): void {
    this.bindings = graph;
    this.instances.update(graph, this.canonicalPackages(), this.fixedRoots());
  }

  resolve(request: string, parent?: ResolverParent): ResolveResult | undefined {
    const fileOwner = parent?.filename
      ? this.owners.findOwner(parent.filename)
      : undefined;
    if (fileOwner?.module) {
      const mapped = this.pathMapper.resolve(
        request,
        fileOwner.module.manifest,
      );
      if (mapped) {
        return { resolvedPath: mapped };
      }
    }
    return (
      this.resolveInterfaceCore(request) ??
      this.resolveInterfaceRequest(request, fileOwner ?? this.contextOwner())
    );
  }

  /** Moves a file Node resolved in a package's canonical copy into the instance `result` names. */
  locate(result: ResolveResult, resolvedPath: string): string {
    if (!result.instance) {
      return resolvedPath;
    }
    return this.instances.locate(result.instance, resolvedPath) ?? resolvedPath;
  }

  ownsResolutionContext(_request: string, parent?: ResolverParent): boolean {
    const contextModule = getModuleContext()?.module;
    if (contextModule && this.modulesById.has(contextModule)) {
      return true;
    }
    return Boolean(this.owners.findOwner(parent?.filename ?? ""));
  }

  /**
   * The interface instance whose files a request loads: the instance an
   * interface request resolves into, or, for a relative request made by an
   * instance's own file, that file's instance.
   */
  instanceToLoad(request: string, parent?: ResolverParent): string | undefined {
    const resolved = this.resolve(request, parent)?.instance;
    if (resolved) {
      return resolved;
    }
    if (!RELATIVE_OR_ABSOLUTE.test(request) || !parent?.filename) {
      return undefined;
    }
    return (
      this.instanceFiles.get(parent.filename) ??
      this.owners.findOwner(parent.filename)?.instance
    );
  }

  /** Records that `filePath` was loaded as part of the interface instance `instance`. */
  recordInstanceFile(instance: string, filePath: string): void {
    this.instanceFiles.set(filePath, instance);
  }

  /**
   * Evaluates an interface instance's files in a context the instance owns,
   * so what they register or attach while evaluated lives as long as the
   * instance, not as long as the module that happened to import it first.
   * An interface package that is its own provider module evaluates in that
   * module's context instead.
   */
  runInInstance<T>(instance: string, load: () => T): T {
    const descriptor = this.instances.describe(instance);
    if (
      !descriptor ||
      this.lifecycleInterfacePackages.has(descriptor.interfaceName)
    ) {
      return load();
    }
    const module =
      getModuleContext()?.module ??
      descriptor.provider ??
      descriptor.interfaceName;
    return runWithModuleContext(
      { module, owner: `${instance}${INSTANCE_OWNER_SUFFIX}` },
      load,
    );
  }

  /**
   * Evaluates the entry of an interface instance, if it is not loaded yet,
   * and returns the root its files live in.
   */
  loadInstance(instance: string): string | undefined {
    const root = this.instances.rootOf(instance);
    const entry = this.instanceEntry(instance);
    if (!root || !entry) {
      return undefined;
    }
    this.runInInstance(instance, () => require(entry));
    return root;
  }

  /**
   * The entry an interface request must evaluate before the file it asked
   * for: a subpath of an interface package is loaded through the package's
   * declaration root, so a cycle between the two starts from the root.
   */
  entryToPrime(
    request: string,
    parent: ResolverParent | undefined,
    resolvedPath: string,
  ): string | undefined {
    const instance = this.resolve(request, parent)?.instance;
    const descriptor = instance && this.instances.describe(instance);
    if (
      !instance ||
      !descriptor ||
      this.lifecycleInterfacePackages.has(descriptor.interfaceName)
    ) {
      return undefined;
    }
    const entry = this.instanceEntry(instance);
    return entry && entry !== resolvedPath && !require.cache[entry]
      ? entry
      : undefined;
  }

  private instanceEntry(instance: string): string | undefined {
    const name = this.instances.describe(instance)?.interfaceName;
    const canonicalEntry = name
      ? (this.interfacePackageEntries.get(name) ??
        this.interfacePackages.get(name))
      : undefined;
    if (!canonicalEntry) {
      return undefined;
    }
    return (
      this.instances.locate(instance, realFolder(canonicalEntry)) ??
      canonicalEntry
    );
  }

  /**
   * Root of the interface instance a file was loaded as part of, if any.
   * Callers need the root, not just a yes/no: whether a cached file may
   * survive a module reload depends on where the instance sits relative to
   * the module being reloaded.
   */
  getInterfaceGraphRoot(filePath: string): string | undefined {
    const instance =
      this.instanceFiles.get(filePath) ??
      this.owners.findOwner(filePath)?.instance;
    return instance ? this.instances.rootOf(instance) : undefined;
  }

  /** Deletes every interface instance copy. */
  releaseInstances(): void {
    this.instances.release();
  }

  clearCache(): void {
    this.instanceFiles.clear();
    this.owners.invalidate();
  }

  private canonicalPackages(): Map<string, CanonicalPackage> {
    const canonical = new Map<string, CanonicalPackage>();
    for (const [name, root] of this.interfacePackages) {
      if (name !== CORE_PKG) {
        canonical.set(name, {
          root: path.resolve(root),
          realRoot: realFolder(root),
        });
      }
    }
    return canonical;
  }

  private fixedRoots(): Map<string, string> {
    const roots = new Map<string, string>();
    for (const name of this.lifecycleInterfacePackages) {
      for (const key of this.instances.keysOf(name)) {
        const provider = this.instances.describe(key)?.provider;
        const module = provider ? this.modulesById.get(provider) : undefined;
        if (module?.manifest.manifest.name === name) {
          roots.set(key, realFolder(module.manifest.folder));
        }
      }
    }
    return roots;
  }

  private resolveInterfaceCore(request: string): ResolveResult | undefined {
    if (request === CORE_PKG) {
      return { resolvedPath: CORE_ENTRY };
    }
    if (request.startsWith(`${CORE_PKG}/`)) {
      return { resolvedPath: request, resolveFrom: CORE_RESOLVE_FROM };
    }
    return undefined;
  }

  private resolveInterfaceRequest(
    request: string,
    owner: FileOwner | undefined,
  ): ResolveResult | undefined {
    const connection = parseConnection(request);
    const target = connection?.request ?? request;
    const packageName = this.findInterfacePackage(target);
    if (!packageName) {
      if (connection) {
        throw new Error(
          `Connection path '${request}' does not name an interface package.`,
        );
      }
      return undefined;
    }
    const instance = connection
      ? this.connectionInstance(owner, packageName, connection.index)
      : this.instanceFor(owner, packageName);
    return { ...this.canonicalRequest(packageName, target), instance };
  }

  private canonicalRequest(
    packageName: string,
    request: string,
  ): ResolveResult {
    const root = this.interfacePackages.get(packageName)!;
    if (request === packageName) {
      return {
        resolvedPath: this.interfacePackageEntries.get(packageName) ?? root,
      };
    }
    return {
      resolvedPath: request,
      resolveFrom: this.interfacePackageResolveFrom.get(packageName) ?? root,
    };
  }

  private findInterfacePackage(request: string): string | undefined {
    return [...this.interfacePackages.keys()].find(
      (packageName) =>
        packageName !== CORE_PKG &&
        (request === packageName || request.startsWith(`${packageName}/`)),
    );
  }

  private contextOwner(): FileOwner | undefined {
    const contextModule = getModuleContext()?.module;
    const module = contextModule
      ? this.modulesById.get(contextModule)
      : undefined;
    return module ? { module } : undefined;
  }

  private scopeOf(owner: FileOwner | undefined): ReadonlyMap<string, string> {
    if (owner?.module) {
      return this.bindings?.modules.get(owner.module.id)?.keys ?? new Map();
    }
    return owner?.instance ? this.instanceScope(owner.instance) : new Map();
  }

  private instanceScope(instance: string): ReadonlyMap<string, string> {
    const descriptor = this.instances.describe(instance);
    if (descriptor?.provider) {
      return this.bindings?.modules.get(descriptor.provider)?.keys ?? new Map();
    }
    const scope = new Map<string, string>();
    for (const key of descriptor?.dependencies ?? []) {
      const dependency = this.bindings?.instances.get(key);
      if (dependency) {
        scope.set(dependency.interfaceName, key);
      }
    }
    return scope;
  }

  private describeOwner(owner: FileOwner | undefined): string {
    if (owner?.module) {
      return `Module '${owner.module.id}'`;
    }
    return owner?.instance
      ? `Interface instance '${owner.instance}'`
      : "Code outside any module";
  }

  private instanceFor(
    owner: FileOwner | undefined,
    packageName: string,
  ): string | undefined {
    const bound = this.scopeOf(owner).get(packageName);
    if (bound) {
      return bound;
    }
    const keys = this.instances.keysOf(packageName);
    if (keys.length <= 1) {
      return keys[0];
    }
    throw new Error(
      `${this.describeOwner(owner)} imports ${packageName}, which has several instances (${keys.join(", ")}), but does not declare it; add it to the dependencies of the importing package.`,
    );
  }

  private connectionInstance(
    owner: FileOwner | undefined,
    packageName: string,
    index: number,
  ): string {
    const module = owner?.module;
    const key = module
      ? this.bindings?.modules
          .get(module.id)
          ?.connectionKeys.get(packageName)?.[index]
      : undefined;
    if (!key) {
      throw new Error(
        `${this.describeOwner(owner)} has no connection ${index} to ${packageName}.`,
      );
    }
    return key;
  }

  private listOwnerRoots(): PathOwnerRoot<FileOwner>[] {
    const modules = [...this.moduleByFolder].map(([root, module]) => ({
      root,
      owner: { module },
    }));
    const instances = [...this.instances.roots()].map(([instance, root]) => ({
      root,
      owner: { instance },
    }));
    return [...modules, ...instances];
  }
}
