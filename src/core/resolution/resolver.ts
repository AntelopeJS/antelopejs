import { createHash } from "node:crypto";
import Module from "node:module";
import path from "node:path";
import { CreateInterfaceFacade } from "@antelopejs/interface-core/facades";
import type { ModuleExecutionContext } from "@antelopejs/interface-core/modules";
import type { ModuleManifest } from "../module-manifest";
import { isPathWithin, resolvePackage } from "./package-resolution";
import type { PathMapper } from "./path-mapper";

export interface ModuleRef {
  id: string;
  manifest: ModuleManifest;
}

export interface ResolveResult {
  resolvedPath: string;
  resolveFrom?: string;
  exact?: boolean;
  facadeModuleId?: string;
}

const CORE_PKG = "@antelopejs/interface-core";
const CORE_PACKAGE = resolvePackage(CORE_PKG, __dirname);
const CORE_RESOLVE_FROM = CORE_PACKAGE?.root ?? __dirname;
const CORE_ENTRY = CORE_PACKAGE?.entry ?? CORE_PKG;

export class Resolver {
  public readonly moduleByFolder = new Map<string, ModuleRef>();
  public readonly modulesById = new Map<string, ModuleRef>();
  public readonly interfacePackages = new Map<string, string>();
  public readonly interfacePackageEntries = new Map<string, string>();
  public readonly interfacePackageResolveFrom = new Map<string, string>();
  public stubModulePath?: string;
  private readonly moduleContexts = new Map<string, ModuleExecutionContext>();
  private readonly facadePaths = new Map<string, Set<string>>();

  constructor(private pathMapper: PathMapper) {}

  resolve(
    request: string,
    parent?: { filename?: string },
  ): ResolveResult | undefined {
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

    const interfaceResult = this.resolveInterfacePackage(request);
    if (interfaceResult) {
      return matchingModule &&
        this.moduleContexts.has(matchingModule.id) &&
        !this.isImplementedInterfaceRequest(request, matchingModule)
        ? { ...interfaceResult, facadeModuleId: matchingModule.id }
        : interfaceResult;
    }

    return undefined;
  }

  setModuleContext(moduleId: string, context: ModuleExecutionContext): void {
    this.moduleContexts.set(moduleId, context);
  }

  clearModuleFacades(moduleId: string): void {
    for (const facadePath of this.facadePaths.get(moduleId) ?? []) {
      delete require.cache[facadePath];
    }
    this.facadePaths.delete(moduleId);
  }

  clearFacades(): void {
    for (const moduleId of this.facadePaths.keys()) {
      this.clearModuleFacades(moduleId);
    }
    this.moduleContexts.clear();
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

  createInterfaceFacade(entry: string, moduleId: string): string | undefined {
    const context = this.moduleContexts.get(moduleId);
    if (!context) {
      return undefined;
    }
    const facadePath = this.getFacadePath(entry, moduleId, context.owner);
    if (!require.cache[facadePath]) {
      const declaration = require(entry) as Record<string, unknown>;
      const facade = CreateInterfaceFacade(declaration, context);
      if (facade === declaration) {
        return undefined;
      }
      const facadeModule = new Module(facadePath);
      facadeModule.filename = facadePath;
      facadeModule.paths = (Module as any)._nodeModulePaths(
        path.dirname(entry),
      );
      facadeModule.exports = facade;
      facadeModule.loaded = true;
      require.cache[facadePath] = facadeModule;
      const paths = this.facadePaths.get(moduleId) ?? new Set<string>();
      paths.add(facadePath);
      this.facadePaths.set(moduleId, paths);
    }
    return facadePath;
  }

  private getFacadePath(
    entry: string,
    moduleId: string,
    owner = moduleId,
  ): string {
    const generation = Buffer.from(owner).toString("base64url");
    const consumer = Buffer.from(moduleId).toString("base64url");
    const declaration = createHash("sha256")
      .update(entry)
      .digest("hex")
      .slice(0, 16);
    return path.join(
      path.dirname(entry),
      ".antelope-facades",
      `${declaration}-${consumer}-${generation}.cjs`,
    );
  }

  private resolveInterfacePackage(request: string): ResolveResult | undefined {
    for (const [pkg, rootDir] of this.interfacePackages) {
      if (request === pkg) {
        return {
          resolvedPath: this.interfacePackageEntries.get(pkg) ?? rootDir,
        };
      }
      if (request.startsWith(`${pkg}/`)) {
        return {
          resolvedPath: request,
          resolveFrom: this.interfacePackageResolveFrom.get(pkg) ?? rootDir,
        };
      }
    }
    return undefined;
  }

  private isImplementedInterfaceRequest(
    request: string,
    module: ModuleRef,
  ): boolean {
    return (module.manifest.implements ?? []).some(
      (interfaceName) =>
        request === interfaceName || request.startsWith(`${interfaceName}/`),
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
