import Module from "node:module";
import path from "node:path";
import type { Resolver } from "./resolver";

type ModuleResolver = (
  request: string,
  parent: any,
  isMain: boolean,
  options: any,
) => string;

interface ResolverLease {
  owner: symbol;
  resolver: Resolver;
}

class ResolverDetourCoordinator {
  private readonly leases: ResolverLease[] = [];
  private originalResolver?: ModuleResolver;
  private installedResolver?: ModuleResolver;

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
    this.leases.splice(leaseIndex, 1);
    if ((Module as any)._resolveFilename !== this.installedResolver) {
      if (this.leases.length === 0) {
        this.originalResolver = undefined;
        this.installedResolver = undefined;
      }
      throw new Error("Node module resolver hook was replaced externally");
    }
    if (this.leases.length === 0) {
      (Module as any)._resolveFilename = this.originalResolver;
      this.originalResolver = undefined;
      this.installedResolver = undefined;
    }
  }

  private ensureInstalled(): void {
    if (this.installedResolver) {
      this.ensureHookOwnership();
      return;
    }
    this.originalResolver = (Module as any)._resolveFilename;
    this.installedResolver = (request, parent, isMain, options) =>
      this.resolve(request, parent, isMain, options);
    (Module as any)._resolveFilename = this.installedResolver;
  }

  private ensureHookOwnership(): void {
    if ((Module as any)._resolveFilename !== this.installedResolver) {
      throw new Error("Node module resolver hook was replaced externally");
    }
  }

  private resolve(
    request: string,
    parent: any,
    isMain: boolean,
    options: any,
  ): string {
    const activeResolver = this.leases.at(-1)?.resolver;
    const result = activeResolver?.resolve(request, parent);
    if (!result) {
      return this.originalResolver?.(
        request,
        parent,
        isMain,
        options,
      ) as string;
    }
    if (result.exact) {
      return result.resolvedPath;
    }
    const contextParent = result.resolveFrom
      ? { ...parent, filename: path.join(result.resolveFrom, "_") }
      : parent;
    const resolvedPath = this.originalResolver?.(
      result.resolvedPath,
      contextParent,
      isMain,
      options,
    ) as string;
    if (!result.facadeModuleId) {
      return resolvedPath;
    }
    return (
      activeResolver?.createInterfaceFacade(
        resolvedPath,
        result.facadeModuleId,
      ) ?? resolvedPath
    );
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
