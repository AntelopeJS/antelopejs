import type {
  InterfacePackageCopy,
  InterfaceRangeConflict,
  InterfaceResolutionError,
  PreloadedInterfaceCopy,
} from "../../resolution/interface-resolution-error";
import { displayPath } from "./format";
import type { CliProblem } from "./types";

const INTERFACE_CONFLICT_TITLE = "Incompatible interface package resolution";
const INTERFACE_CONFLICT_REASON =
  "Modules share one copy of each interface package, and that copy does not work for these modules:";
const NESTED_DETAIL_INDENT = "  ";
const COMPATIBLE_RANGE_PREFIX = "^";
const MISSING_COPY = "not installed";

function sharedCopyDetail(canonical: InterfacePackageCopy): string {
  return `${NESTED_DETAIL_INDENT}shared copy: ${displayPath(canonical.root)}`;
}

function rangeConflictDetails(conflict: InterfaceRangeConflict): string[] {
  const { moduleId, packageName, consumerCopy } = conflict;
  const ownCopy = consumerCopy
    ? `${consumerCopy.version} at ${displayPath(consumerCopy.root)}`
    : MISSING_COPY;
  return [
    `${moduleId} requires ${packageName}@${conflict.range}, but the shared copy is ${conflict.canonical.version}`,
    sharedCopyDetail(conflict.canonical),
    `${NESTED_DETAIL_INDENT}copy of ${moduleId}: ${ownCopy}`,
  ];
}

function rangeConflictFixes(conflict: InterfaceRangeConflict): string[] {
  const { moduleId, packageName } = conflict;
  const version = conflict.canonical.version;
  return [
    `Update ${moduleId} to a release that supports ${packageName} ${version}`,
    `Or depend on "${packageName}": "${COMPATIBLE_RANGE_PREFIX}${version}" in the package.json of ${moduleId}, then reinstall its dependencies`,
  ];
}

function preloadedCopyDetails(preloaded: PreloadedInterfaceCopy): string[] {
  const { moduleId, packageName, copy, canonical } = preloaded;
  return [
    `The copy of ${packageName} installed by ${moduleId} (${copy.version}) was loaded before the shared copy (${canonical.version}) and cannot be redirected`,
    `${NESTED_DETAIL_INDENT}loaded first: ${displayPath(preloaded.loadedFile)}`,
    sharedCopyDetail(canonical),
  ];
}

function preloadedCopyFixes(preloaded: PreloadedInterfaceCopy): string[] {
  return [
    `Make sure nothing loads ${preloaded.packageName} from ${preloaded.moduleId} before AntelopeJS loads the modules`,
  ];
}

/**
 * Lists each interface package conflict: the module, the range it requires
 * or the copy it loaded, the shared copy it conflicts with, and how to
 * resolve it.
 */
export function describeInterfaceConflicts(
  error: InterfaceResolutionError,
): CliProblem {
  const { rangeConflicts, preloadedCopies } = error.conflicts;
  const fixes = [
    ...rangeConflicts.flatMap(rangeConflictFixes),
    ...preloadedCopies.flatMap(preloadedCopyFixes),
  ];
  return {
    title: INTERFACE_CONFLICT_TITLE,
    reason: INTERFACE_CONFLICT_REASON,
    details: [
      ...rangeConflicts.flatMap(rangeConflictDetails),
      ...preloadedCopies.flatMap(preloadedCopyDetails),
    ],
    fixes: [...new Set(fixes)],
  };
}
