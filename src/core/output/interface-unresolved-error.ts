import type { CliProblem } from "./types";

const UNRESOLVED_INTERFACES_ERROR_NAME = "UnresolvedInterfacesError";
const UNRESOLVED_INTERFACES_TITLE = "Unresolved interface dependencies";
const UNRESOLVED_INTERFACES_REASON =
  "No loaded module implements these required interfaces:";
const INSTALL_FIX =
  "Run 'ajs project modules install' to resolve missing dependencies.";

/** A module requires an interface package that no loaded module implements. */
export interface UnresolvedInterfaceDependency {
  moduleId: string;
  interfacePackage: string;
}

function describeDependency({
  moduleId,
  interfacePackage,
}: UnresolvedInterfaceDependency): string {
  return `${moduleId} requires ${interfacePackage}`;
}

/**
 * Thrown before any module is constructed when a module requires an
 * interface that no loaded module implements. Its message lists each module
 * and the interface it requires.
 */
export class UnresolvedInterfacesError extends Error {
  constructor(readonly unresolved: UnresolvedInterfaceDependency[]) {
    const lines = unresolved.map((entry) => `  - ${describeDependency(entry)}`);
    super(
      `${UNRESOLVED_INTERFACES_TITLE}:\n${lines.join("\n")}\n\n${INSTALL_FIX}`,
    );
    this.name = UNRESOLVED_INTERFACES_ERROR_NAME;
  }
}

/** Lists each module and the interface it requires, and how to install it. */
export function describeUnresolvedInterfaces(
  error: UnresolvedInterfacesError,
): CliProblem {
  return {
    title: UNRESOLVED_INTERFACES_TITLE,
    reason: UNRESOLVED_INTERFACES_REASON,
    details: error.unresolved.map(describeDependency),
    fixes: [INSTALL_FIX],
  };
}
