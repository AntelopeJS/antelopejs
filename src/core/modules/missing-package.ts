import { isString } from "../../utils";
import type { ModulePackageJson } from "./module-package-json";

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

/**
 * Names the package behind a module's failed load when Node could not find a
 * package the module declares in `dependencies` or `optionalDependencies`.
 * Returns `undefined` for any other failure.
 */
export function findMissingPackage(
  moduleId: string,
  manifest: ModulePackageJson,
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
  if (!Object.hasOwn(declared, packageName)) {
    return undefined;
  }
  return new MissingPackageError(moduleId, packageName, { cause: error });
}
