import Module from "node:module";
import path from "node:path";
import { internal } from "@antelopejs/interface-core/internal";
import type { ModuleManifest } from "../module-manifest";
import {
  findPackageFromEntry,
  isPathWithin,
  resolvePackage,
} from "./package-resolution";
import type { PathMapper } from "./path-mapper";

export interface ModuleRef {
  id: string;
  manifest: ModuleManifest;
}

export interface ResolveResult {
  resolvedPath: string;
  resolveFrom?: string;
  exact?: boolean;
  alias?: InterfacePackageAlias;
  parentFilename?: string;
}

export interface InterfacePackageAlias {
  root: string;
  separatorCount: number;
  coreFacadeEntries: Set<string>;
}

interface InterfacePackageRequest {
  packageName: string;
  result: ResolveResult;
}

interface ProxyConstructor {
  new (identity?: string): object;
}

interface CoreFacadeExports {
  AsyncProxy: ProxyConstructor;
  EventProxy: ProxyConstructor;
  InterfaceFunction(identity?: string): (...args: any[]) => Promise<unknown>;
  RegisteringProxy: ProxyConstructor;
}

const CORE_PKG = "@antelopejs/interface-core";
const CORE_PACKAGE = resolvePackage(CORE_PKG, __dirname);
const CORE_RESOLVE_FROM = CORE_PACKAGE?.root ?? __dirname;
const CORE_ENTRY = CORE_PACKAGE?.entry ?? CORE_PKG;
const CORE_ENTRY_RELATIVE = CORE_PACKAGE
  ? path.relative(CORE_PACKAGE.root, CORE_PACKAGE.entry)
  : path.join("dist", "index.js");
const CORE_PROXIES_RELATIVE = path.join("dist", "proxies.js");
let nextResolverIdentity = 1;
let nextAliasIdentity = 2;

export class Resolver {
  public readonly moduleByFolder = new Map<string, ModuleRef>();
  public readonly modulesById = new Map<string, ModuleRef>();
  public readonly interfacePackages = new Map<string, string>();
  public readonly interfacePackageEntries = new Map<string, string>();
  public readonly interfacePackageResolveFrom = new Map<string, string>();
  public stubModulePath?: string;
  private readonly resolverIdentity = nextResolverIdentity++;
  private readonly interfaceAliases = new Map<string, InterfacePackageAlias>();
  private readonly facadeWrappers = new WeakMap<
    InterfacePackageAlias,
    Map<string, CoreFacadeExports>
  >();
  private readonly facadePaths = new WeakMap<
    InterfacePackageAlias,
    Map<string, string>
  >();

  constructor(private pathMapper: PathMapper) {}

  resolve(
    request: string,
    parent?: { filename?: string },
  ): ResolveResult | undefined {
    if (this.isExactResolverPath(request)) {
      return { resolvedPath: request, exact: true };
    }
    const inheritedAlias = this.resolveInheritedAlias(
      request,
      parent?.filename,
    );
    if (inheritedAlias) {
      return inheritedAlias;
    }
    const matchingModule = this.resolveLocalModule(parent?.filename);
    if (matchingModule) {
      const mapped = this.pathMapper.resolve(request, matchingModule.manifest);
      if (mapped) {
        return { resolvedPath: mapped };
      }
    }

    const coreResult = this.resolveInterfaceCore(request);
    if (coreResult) {
      return coreResult;
    }

    const interfaceRequest = this.resolveInterfacePackage(request);
    if (interfaceRequest) {
      const provider = matchingModule
        ? this.resolveProvider(matchingModule, interfaceRequest.packageName)
        : undefined;
      if (!provider) {
        return interfaceRequest.result;
      }
      return {
        ...interfaceRequest.result,
        alias: this.getInterfaceAlias(interfaceRequest.packageName, provider),
      };
    }

    return undefined;
  }

  ownsResolutionContext(
    request: string,
    parent?: { filename?: string },
  ): boolean {
    return Boolean(
      this.isExactResolverPath(request) ||
        (parent?.filename &&
          (this.findAliasByPath(parent.filename) ||
            this.resolveLocalModule(parent.filename))),
    );
  }

  requiresPreResolution(
    request: string,
    parent?: { filename?: string },
  ): boolean {
    if (parent?.filename && this.findAliasByPath(parent.filename)) {
      return true;
    }
    const matchingModule = this.resolveLocalModule(parent?.filename);
    const interfaceRequest = this.findInterfacePackageRequest(request);
    return Boolean(
      matchingModule &&
        interfaceRequest &&
        this.resolveProvider(matchingModule, interfaceRequest),
    );
  }

  applyAlias(resolvedPath: string, alias?: InterfacePackageAlias): string {
    if (!alias) {
      return resolvedPath;
    }
    const coreFacade = this.resolveCoreFacade(resolvedPath, alias);
    if (coreFacade) {
      return coreFacade;
    }
    if (!isPathWithin(resolvedPath, alias.root)) {
      return resolvedPath;
    }
    const relativePath = path.relative(alias.root, resolvedPath);
    return `${alias.root}${path.sep.repeat(alias.separatorCount)}${relativePath}`;
  }

  clearCache(): void {
    for (const cachePath of Object.keys(require.cache)) {
      if (this.isExactResolverPath(cachePath)) {
        delete require.cache[cachePath];
      }
    }
    this.interfaceAliases.clear();
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

  private resolveInterfacePackage(
    request: string,
  ): InterfacePackageRequest | undefined {
    for (const [pkg, rootDir] of this.interfacePackages) {
      if (request === pkg) {
        return {
          packageName: pkg,
          result: {
            resolvedPath: this.interfacePackageEntries.get(pkg) ?? rootDir,
          },
        };
      }
      if (request.startsWith(`${pkg}/`)) {
        return {
          packageName: pkg,
          result: {
            resolvedPath: request,
            resolveFrom: this.interfacePackageResolveFrom.get(pkg) ?? rootDir,
          },
        };
      }
    }
    return undefined;
  }

  private resolveInheritedAlias(
    request: string,
    parentFilename?: string,
  ): ResolveResult | undefined {
    if (!parentFilename) {
      return undefined;
    }
    const alias = this.findAliasByPath(parentFilename);
    if (!alias) {
      return undefined;
    }
    const coreResult = this.resolveInterfaceCore(request);
    if (coreResult) {
      return { ...coreResult, alias };
    }
    return {
      resolvedPath: request,
      parentFilename: this.removeAlias(parentFilename, alias),
      alias,
    };
  }

  private resolveProvider(
    module: ModuleRef,
    packageName: string,
  ): string | undefined {
    if (module.manifest.implements?.includes(packageName)) {
      return module.id;
    }
    return internal.interfaceConnections[module.id]?.[packageName]?.find(
      ({ selected }) => selected,
    )?.provider;
  }

  private getInterfaceAlias(
    packageName: string,
    provider: string,
  ): InterfacePackageAlias {
    const key = `${packageName}\0${provider}`;
    const existing = this.interfaceAliases.get(key);
    if (existing) {
      return existing;
    }
    const root = this.interfacePackages.get(packageName) as string;
    const separatorCount = nextAliasIdentity++;
    const alias = {
      root,
      separatorCount,
      coreFacadeEntries: new Set<string>(),
    };
    this.facadeWrappers.set(alias, new Map());
    this.facadePaths.set(alias, new Map());
    this.interfaceAliases.set(key, alias);
    return alias;
  }

  private resolveCoreFacade(
    entry: string,
    alias: InterfacePackageAlias,
  ): string | undefined {
    if (!path.isAbsolute(entry)) {
      return undefined;
    }
    const corePackage = findPackageFromEntry(
      entry,
      CORE_PKG,
      path.dirname(entry),
    );
    if (!corePackage || !this.isFacadeCoreEntry(entry, corePackage.root)) {
      return undefined;
    }
    const paths = this.facadePaths.get(alias) as Map<string, string>;
    const existing = paths.get(entry);
    if (existing) {
      return existing;
    }
    const wrappersByRoot = this.facadeWrappers.get(alias) as Map<
      string,
      CoreFacadeExports
    >;
    const namespace = `${this.resolverIdentity}:${alias.separatorCount}`;
    const coreEntry = path.join(corePackage.root, CORE_ENTRY_RELATIVE);
    const wrappers =
      wrappersByRoot.get(corePackage.root) ??
      this.createCoreWrappers(namespace, coreEntry);
    wrappersByRoot.set(corePackage.root, wrappers);
    const facadePath = this.createCoreFacade(entry, wrappers, namespace);
    paths.set(entry, facadePath);
    alias.coreFacadeEntries.add(facadePath);
    return facadePath;
  }

  private createCoreWrappers(
    namespace: string,
    coreEntry: string,
  ): CoreFacadeExports {
    const core = require(coreEntry) as CoreFacadeExports;
    let nextAnonymousIdentity = 1;
    const namespacedIdentity = (identity?: string) =>
      `${namespace}:${identity ?? `anonymous:${nextAnonymousIdentity++}`}`;
    class AsyncProxy extends core.AsyncProxy {
      constructor(identity?: string) {
        super(namespacedIdentity(identity));
      }
    }
    class EventProxy extends core.EventProxy {
      constructor(identity?: string) {
        super(namespacedIdentity(identity));
      }
    }
    class RegisteringProxy extends core.RegisteringProxy {
      constructor(identity?: string) {
        super(namespacedIdentity(identity));
      }
    }
    const InterfaceFunction = (identity?: string) => {
      const proxy = new AsyncProxy(identity) as any;
      const func = (...args: any[]) => proxy.call(...args);
      func.proxy = proxy;
      return func;
    };
    return { AsyncProxy, EventProxy, InterfaceFunction, RegisteringProxy };
  }

  private isFacadeCoreEntry(entry: string, coreRoot: string): boolean {
    const relativeEntry = path.relative(coreRoot, entry);
    return (
      relativeEntry === CORE_ENTRY_RELATIVE ||
      relativeEntry === CORE_PROXIES_RELATIVE
    );
  }

  private facadeSuffix(entry: string): string {
    return `-${path.basename(entry, path.extname(entry))}.js`;
  }

  private createCoreFacade(
    entry: string,
    wrappers: CoreFacadeExports,
    namespace: string,
  ): string {
    const facadePath = path.join(
      path.dirname(entry),
      `.antelope-resolver-${namespace}${this.facadeSuffix(entry)}`,
    );
    const facade = Object.create(Object.getPrototypeOf(require(entry)));
    Object.defineProperties(
      facade,
      Object.getOwnPropertyDescriptors(require(entry)),
    );
    Object.defineProperties(facade, {
      AsyncProxy: { enumerable: true, value: wrappers.AsyncProxy },
      EventProxy: { enumerable: true, value: wrappers.EventProxy },
      InterfaceFunction: {
        enumerable: true,
        value: wrappers.InterfaceFunction,
      },
      RegisteringProxy: { enumerable: true, value: wrappers.RegisteringProxy },
    });
    const facadeModule = new Module(facadePath);
    facadeModule.filename = facadePath;
    facadeModule.exports = facade;
    facadeModule.loaded = true;
    require.cache[facadePath] = facadeModule;
    return facadePath;
  }

  private findInterfacePackageRequest(request: string): string | undefined {
    return [...this.interfacePackages.keys()].find(
      (packageName) =>
        request === packageName || request.startsWith(`${packageName}/`),
    );
  }

  private findAliasByPath(fileName: string): InterfacePackageAlias | undefined {
    return [...this.interfaceAliases.values()].find((alias) => {
      if (!fileName.startsWith(alias.root)) {
        return false;
      }
      const suffix = fileName.slice(alias.root.length);
      const separators = suffix.match(new RegExp(`^\\${path.sep}+`))?.[0];
      return separators?.length === alias.separatorCount;
    });
  }

  private removeAlias(fileName: string, alias: InterfacePackageAlias): string {
    return `${alias.root}${path.sep}${fileName.slice(
      alias.root.length + alias.separatorCount,
    )}`;
  }

  private isExactResolverPath(request: string): boolean {
    if (this.findAliasByPath(request)) {
      return true;
    }
    return [...this.interfaceAliases.values()].some((alias) =>
      alias.coreFacadeEntries.has(request),
    );
  }

  private resolveLocalModule(fileName?: string): ModuleRef | undefined {
    if (!fileName) {
      return undefined;
    }
    let matchingFolder = "";
    let matchingModule: ModuleRef | undefined;
    for (const [folder, module] of this.moduleByFolder) {
      if (
        isPathWithin(fileName, folder) &&
        folder.length > matchingFolder.length
      ) {
        matchingFolder = folder;
        matchingModule = module;
      }
    }
    return matchingModule;
  }
}
