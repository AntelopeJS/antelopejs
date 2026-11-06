import { readFileSync } from "node:fs";
import path from "node:path";
import { satisfies } from "semver";

import {
  isObject,
  isString,
  type ResolvedPackage,
  resolvePackage,
} from "../../utils";
import { CliError } from "../output";

const INTERFACE_CORE = "@antelopejs/interface-core";
const CORE_MANIFEST = path.join(__dirname, "../../../package.json");

/** What the core declares for `@antelopejs/interface-core` and what it loads. */
export interface InterfaceCoreCopy {
  coreVersion: string;
  requiredRange: string;
  installed: ResolvedPackage | undefined;
}

function readInterfaceCoreCopy(): InterfaceCoreCopy {
  const manifest: unknown = JSON.parse(readFileSync(CORE_MANIFEST, "utf8"));
  const version = isObject(manifest) ? manifest.version : undefined;
  const dependencies = isObject(manifest) ? manifest.dependencies : undefined;
  const range = isObject(dependencies)
    ? dependencies[INTERFACE_CORE]
    : undefined;
  return {
    coreVersion: isString(version) ? version : "unknown",
    requiredRange: isString(range) ? range : "*",
    installed: resolvePackage(INTERFACE_CORE, __dirname),
  };
}

/**
 * Throws when the core's own copy of `@antelopejs/interface-core` falls
 * outside the range the core declares. A package manager override or
 * resolution can replace that copy without a warning at install, and the
 * core would then fail later on a function the old copy lacks.
 */
export function assertInterfaceCoreCopy(
  copy: InterfaceCoreCopy = readInterfaceCoreCopy(),
): void {
  const { coreVersion, requiredRange, installed } = copy;
  const version = installed?.version;
  if (
    version !== undefined &&
    satisfies(version, requiredRange, { includePrerelease: true })
  ) {
    return;
  }
  throw new CliError({
    title: `@antelopejs/core ${coreVersion} requires ${INTERFACE_CORE} ${requiredRange}, but it loads ${version ?? "an unknown version"}`,
    reason: installed
      ? `The core resolves ${INTERFACE_CORE} to ${installed.root}. A package manager override or resolution usually pins this copy.`
      : `The core cannot find the version of its ${INTERFACE_CORE} copy.`,
    fixes: [
      `Raise or remove the ${INTERFACE_CORE} entry in your overrides (pnpm-workspace.yaml, or pnpm.overrides, overrides or resolutions in package.json) so it allows ${requiredRange}, then reinstall`,
    ],
  });
}
