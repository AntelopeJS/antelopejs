import path from "node:path";
import type { ModuleManifest } from "../module-manifest";
import type { PathMapper } from "./path-mapper";

export interface ModuleRef {
  id: string;
  manifest: ModuleManifest;
}

export interface ResolveResult {
  resolvedPath: string;
  resolveFrom?: string;
}

const CORE_PKG = "@antelopejs/interface-core";
const CORE_RESOLVE_FROM = path.dirname(
  require.resolve(`${CORE_PKG}/package.json`),
);

export class Resolver {
  public readonly moduleByFolder = new Map<string, ModuleRef>();
  public readonly modulesById = new Map<string, ModuleRef>();
  public readonly interfacePackages = new Map<string, string>();
  public stubModulePath?: string;

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
      return interfaceResult;
    }

    return undefined;
  }

  private resolveInterfaceCore(request: string): ResolveResult | undefined {
    if (request === CORE_PKG) {
      return { resolvedPath: CORE_RESOLVE_FROM };
    }
    if (request.startsWith(`${CORE_PKG}/`)) {
      return { resolvedPath: request, resolveFrom: CORE_RESOLVE_FROM };
    }
    return undefined;
  }

  private resolveInterfacePackage(request: string): ResolveResult | undefined {
    for (const [pkg, rootDir] of this.interfacePackages) {
      if (request === pkg) {
        return { resolvedPath: rootDir };
      }
      if (request.startsWith(`${pkg}/`)) {
        return { resolvedPath: request, resolveFrom: rootDir };
      }
    }
    return undefined;
  }

  private resolveLocalModule(fileName?: string): ModuleRef | undefined {
    if (!fileName) {
      return undefined;
    }
    let matchingFolder = "";
    let matchingModule: ModuleRef | undefined;
    for (const [folder, module] of this.moduleByFolder) {
      if (
        fileName.startsWith(folder) &&
        folder.length > matchingFolder.length
      ) {
        matchingFolder = folder;
        matchingModule = module;
      }
    }
    return matchingModule;
  }
}
