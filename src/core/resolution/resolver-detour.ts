import Module from "node:module";
import path from "node:path";
import type { ResolveResult, Resolver } from "./resolver";

type ModuleResolver = (
  request: string,
  parent: any,
  isMain: boolean,
  options: any,
) => string;

type ModuleLoader = (request: string, parent: any, isMain: boolean) => unknown;

interface ResolverLease {
  owner: symbol;
  resolver: Resolver;
}

class ResolverDetourCoordinator {
  private readonly leases: ResolverLease[] = [];
  private originalResolver?: ModuleResolver;
  private installedResolver?: ModuleResolver;
  private originalLoader?: ModuleLoader;
  private installedLoader?: ModuleLoader;

  attach(owner: symbol, resolver: Resolver): boolean {
    if (this.leases.some((lease) => lease.owner === owner)) {
      return false;
    }
    this.ensureInstalled();
    this.leases.push({ owner, resolver });
    return true;
  }

  detach(owner: symbol): void {
    const leaseIndex = this.leases.findIndex((lease) => lease.owner === owner);
    if (leaseIndex === -1) {
      return;
    }
    this.leases[leaseIndex].resolver.clearCache();
    this.leases.splice(leaseIndex, 1);
    const ownsResolver =
      (Module as any)._resolveFilename === this.installedResolver;
    const ownsLoader = (Module as any)._load === this.installedLoader;
    if (this.leases.length > 0 && (!ownsResolver || !ownsLoader)) {
      this.throwHookReplacement(ownsResolver, ownsLoader);
    }
    if (this.leases.length > 0) {
      return;
    }
    if (ownsResolver) {
      (Module as any)._resolveFilename = this.originalResolver;
    }
    if (ownsLoader) {
      (Module as any)._load = this.originalLoader;
    }
    this.releaseHooks();
    this.throwHookReplacement(ownsResolver, ownsLoader);
  }

  private ensureInstalled(): void {
    if (this.installedResolver) {
      this.ensureHookOwnership();
      return;
    }
    this.originalResolver = (Module as any)._resolveFilename;
    this.originalLoader = (Module as any)._load;
    this.installedResolver = (request, parent, isMain, options) =>
      this.resolve(request, parent, isMain, options);
    this.installedLoader = (request, parent, isMain) =>
      this.load(request, parent, isMain);
    (Module as any)._resolveFilename = this.installedResolver;
    (Module as any)._load = this.installedLoader;
  }

  private ensureHookOwnership(): void {
    if ((Module as any)._resolveFilename !== this.installedResolver) {
      throw new Error("Node module resolver hook was replaced externally");
    }
    if ((Module as any)._load !== this.installedLoader) {
      throw new Error("Node module loader hook was replaced externally");
    }
  }

  private load(request: string, parent: any, isMain: boolean): unknown {
    const activeResolver = this.findResolver(request, parent);
    if (!activeResolver?.requiresPreResolution(request, parent)) {
      return this.originalLoader?.(request, parent, isMain);
    }
    const result = activeResolver.resolve(request, parent);
    if (!result) {
      return this.originalLoader?.(request, parent, isMain);
    }
    const resolvedPath = this.resolveResult(
      activeResolver,
      result,
      parent,
      isMain,
      undefined,
    );
    this.primeInterfaceEntry(
      activeResolver,
      result,
      resolvedPath,
      parent,
      isMain,
    );
    const isCircularImport = require.cache[resolvedPath]?.loaded === false;
    const value = this.originalLoader?.(resolvedPath, parent, isMain);
    return isCircularImport
      ? value
      : activeResolver.bindProviderRoutes(result, value);
  }

  private primeInterfaceEntry(
    resolver: Resolver,
    result: ResolveResult,
    resolvedPath: string,
    parent: any,
    isMain: boolean,
  ): void {
    const entryResult = resolver.getInterfaceEntryToPrime(result, resolvedPath);
    if (!entryResult) {
      return;
    }
    const entryPath = this.resolveResult(
      resolver,
      entryResult,
      parent,
      isMain,
      undefined,
    );
    const value = this.originalLoader?.(entryPath, parent, isMain);
    resolver.bindProviderRoutes(entryResult, value);
  }

  private resolve(
    request: string,
    parent: any,
    isMain: boolean,
    options: any,
  ): string {
    const activeResolver = this.findResolver(request, parent);
    return this.resolveWith(activeResolver, request, parent, isMain, options);
  }

  private resolveWith(
    activeResolver: Resolver | undefined,
    request: string,
    parent: any,
    isMain: boolean,
    options: any,
  ): string {
    const result = activeResolver?.resolve(request, parent);
    if (!activeResolver || !result) {
      return this.originalResolver?.(
        request,
        parent,
        isMain,
        options,
      ) as string;
    }
    return this.resolveResult(activeResolver, result, parent, isMain, options);
  }

  private resolveResult(
    activeResolver: Resolver,
    result: ResolveResult,
    parent: any,
    isMain: boolean,
    options: any,
  ): string {
    const contextParent = this.createResolutionParent(
      parent,
      result.resolveFrom,
    );
    const resolvedPath = this.originalResolver?.(
      result.resolvedPath,
      contextParent,
      isMain,
      options,
    ) as string;
    activeResolver.trackInterfaceFile(result, resolvedPath);
    return resolvedPath;
  }

  private createResolutionParent(parent: any, resolveFrom?: string): any {
    if (!resolveFrom) {
      return parent;
    }
    return {
      ...parent,
      filename: path.join(resolveFrom, "_"),
      paths: (Module as any)._nodeModulePaths(resolveFrom),
    };
  }

  private findResolver(request: string, parent: any): Resolver | undefined {
    for (let index = this.leases.length - 1; index >= 0; index -= 1) {
      const resolver = this.leases[index].resolver;
      if (resolver.ownsResolutionContext(request, parent)) {
        return resolver;
      }
    }
    return this.leases.at(-1)?.resolver;
  }

  private releaseHooks(): void {
    this.originalResolver = undefined;
    this.installedResolver = undefined;
    this.originalLoader = undefined;
    this.installedLoader = undefined;
  }

  private throwHookReplacement(
    ownsResolver: boolean,
    ownsLoader: boolean,
  ): void {
    if (!ownsResolver) {
      throw new Error("Node module resolver hook was replaced externally");
    }
    if (!ownsLoader) {
      throw new Error("Node module loader hook was replaced externally");
    }
  }
}

const coordinator = new ResolverDetourCoordinator();

export class ResolverDetour {
  private readonly owner = Symbol("resolver-detour");

  constructor(private resolver: Resolver) {}

  attach(): boolean {
    return coordinator.attach(this.owner, this.resolver);
  }

  detach(): void {
    coordinator.detach(this.owner);
  }
}
