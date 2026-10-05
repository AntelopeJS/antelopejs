import type { ResolvedPackage } from "./package-resolution";

const INTERFACE_RESOLUTION_ERROR_NAME = "InterfaceResolutionError";
const INTERFACE_RESOLUTION_HEADLINE =
  "Incompatible interface package resolution:";
const MISSING_CONSUMER_COPY = "not installed from the consumer";

export type InterfacePackageCopy = Pick<ResolvedPackage, "version" | "root">;

/**
 * A module declares a range of an interface package that the shared
 * (canonical) copy does not satisfy.
 */
export interface InterfaceRangeConflict {
  moduleId: string;
  packageName: string;
  range: string;
  canonical: InterfacePackageCopy;
  consumerCopy?: InterfacePackageCopy;
}

/**
 * A module's own copy of an interface package was loaded before the shared
 * (canonical) copy, so its loaded files cannot be redirected to it.
 */
export interface PreloadedInterfaceCopy {
  moduleId: string;
  packageName: string;
  copy: InterfacePackageCopy;
  canonical: InterfacePackageCopy;
  loadedFile: string;
}

export interface InterfaceResolutionConflicts {
  rangeConflicts: InterfaceRangeConflict[];
  preloadedCopies: PreloadedInterfaceCopy[];
}

function describeRangeConflict(conflict: InterfaceRangeConflict): string {
  const { canonical, consumerCopy } = conflict;
  const installed = consumerCopy
    ? `${consumerCopy.version} at ${consumerCopy.root}`
    : MISSING_CONSUMER_COPY;
  return `  - ${conflict.moduleId} requires ${conflict.packageName}@${conflict.range}, but the canonical package is ${canonical.version} at ${canonical.root} (consumer copy: ${installed})`;
}

function describePreloadedCopy(preloaded: PreloadedInterfaceCopy): string {
  return `  - ${preloaded.packageName}@${preloaded.copy.version} was loaded from ${preloaded.copy.root} before the canonical copy at ${preloaded.canonical.root}; preloaded interface copies cannot be redirected (${preloaded.loadedFile})`;
}

/**
 * Thrown before any module is constructed when the interface packages the
 * modules depend on cannot be shared: a module requires a range the shared
 * copy does not satisfy, or its own copy was already loaded.
 */
export class InterfaceResolutionError extends Error {
  constructor(readonly conflicts: InterfaceResolutionConflicts) {
    const lines = [
      ...conflicts.rangeConflicts.map(describeRangeConflict),
      ...conflicts.preloadedCopies.map(describePreloadedCopy),
    ];
    super(`${INTERFACE_RESOLUTION_HEADLINE}\n${lines.join("\n")}`);
    this.name = INTERFACE_RESOLUTION_ERROR_NAME;
  }
}
