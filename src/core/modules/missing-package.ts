import { existsSync } from "node:fs";
import path from "node:path";

import { isString } from "../../utils";
import type { ModuleManifest } from "./module-manifest";

const NOT_FOUND_CODES: ReadonlySet<string> = new Set([
  "MODULE_NOT_FOUND",
  "ERR_MODULE_NOT_FOUND",
]);
const NOT_FOUND_REQUEST = /^Cannot find (?:module|package) '([^']+)'/;

/**
 * Thrown when a module's code loads a package the module declares as a
 * dependency and that package is not installed. Its first line names the
 * module, the package, and the steps that fix it: install the module's
 * dependencies, then `ajs project modules install`.
 */
export class MissingPackageError extends Error {
  constructor(
    readonly moduleId: string,
    readonly packageName: string,
    options?: ErrorOptions,
  ) {
    super(
      `${moduleId} requires ${packageName}, which is not installed. Install the dependencies of ${moduleId}, then run 'ajs project modules install' to add the modules that implement its interfaces.`,
      options,
    );
    this.name = "MissingPackageError";
  }
}

function packageNameOf(request: string): string {
  const segments = request.split("/");
  return segments.slice(0, request.startsWith("@") ? 2 : 1).join("/");
}

function notFoundRequest(error: Error): string | undefined {
  const { code }: NodeJS.ErrnoException = error;
  if (!isString(code) || !NOT_FOUND_CODES.has(code)) {
    return undefined;
  }
  return NOT_FOUND_REQUEST.exec(error.message)?.[1];
}

function isInstalledFrom(folder: string, packageName: string): boolean {
  let current = path.resolve(folder);
  while (true) {
    if (existsSync(path.join(current, "node_modules", packageName))) {
      return true;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }
}

/**
 * Names the package behind a module's failed load when Node could not find a
 * package the module declares in `dependencies` or `optionalDependencies`,
 * and no `node_modules` folder above the module's folder holds it. Returns
 * `undefined` for any other failure, such as a missing file inside an
 * installed package or a request a dependency of the module made.
 */
export function findMissingPackage(
  {
    name,
    folder,
    manifest,
  }: Pick<ModuleManifest, "name" | "folder" | "manifest">,
  error: Error,
): MissingPackageError | undefined {
  const request = notFoundRequest(error);
  if (request === undefined) {
    return undefined;
  }
  const packageName = packageNameOf(request);
  const declared = {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
  };
  if (
    !Object.hasOwn(declared, packageName) ||
    isInstalledFrom(folder, packageName)
  ) {
    return undefined;
  }
  return new MissingPackageError(name, packageName, { cause: error });
}
