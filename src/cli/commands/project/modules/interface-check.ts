import type { AntelopeConfig } from "@antelopejs/interface-core/config";
import path from "node:path";
import { lt, valid } from "semver";

import {
  interfaceRangesModule,
  type ProjectInterfaceCheck,
} from "../../../../core/build";
import type {
  InterfaceBump,
  RangeBump,
  RelockBump,
} from "../../../../core/modules";
import {
  CliError,
  type CliProblem,
  displayPath,
  ExecuteCMD,
  getInstallCommand,
  getProcessUi,
  type InterfaceRangeConflict,
  InterfaceResolutionError,
  runTask,
} from "../../../../core/output";
import { resolvePackage } from "../../../../utils";
import { readModuleManifest, writeModuleManifest } from "../../../common";
import { scopedCommand } from "../../shared/next-steps";
import { refreshModuleLocks } from "./module-locks";

/** How a modules command checks the interface packages of the project. */
export interface InterfaceCheckOptions {
  project: string;
  env?: string;
  environments: string[];
  config: AntelopeConfig;
  /** The command that runs the check, suggested again with `--fix`. */
  command: string;
  /** Applies the bumps, then checks again. */
  fix?: boolean;
}

const FIX_FLAG = "--fix";
const UPDATE_COMMAND = "ajs project modules update";
const BUMP_TITLE = "Interface packages need a newer copy";
const UNREACHED_TITLE = "The fix did not install the newer interface copy";
const UNREACHED_REASON =
  "The dependencies were resolved again, and these modules still hold an older copy than the one every module accepts:";
const BUMP_REASON =
  "Every module accepts a newer installed copy than the one a launch would share, and the launch fails until each module below gets it:";

function bumpKey(bump: InterfaceBump): string {
  return JSON.stringify([bump.kind, bump.moduleId, bump.packageName]);
}

function conflictKey(conflict: InterfaceRangeConflict): string {
  return JSON.stringify([
    conflict.moduleId,
    conflict.packageName,
    conflict.range,
    conflict.canonical.root,
  ]);
}

async function checkEnvironments(
  project: string,
  environments: string[],
): Promise<ProjectInterfaceCheck> {
  const conflicts = new Map<string, InterfaceRangeConflict>();
  const bumps = new Map<string, InterfaceBump>();
  for (const env of environments) {
    const found = await runTask(
      `Checking interface versions in ${env}`,
      () => interfaceRangesModule.checkProjectInterfaces(project, env),
      { done: `Checked interface versions in ${env}` },
    );
    found.conflicts.forEach((conflict) =>
      conflicts.set(conflictKey(conflict), conflict),
    );
    found.bumps.forEach((bump) => bumps.set(bumpKey(bump), bump));
  }
  return { conflicts: [...conflicts.values()], bumps: [...bumps.values()] };
}

function requiredByText(bump: InterfaceBump): string {
  return bump.requiredBy.length > 0
    ? `required by ${bump.requiredBy.join(", ")}`
    : `to match the shared copy ${bump.target}`;
}

/** One line naming a bump: the module, the package and the exact change. */
function manifestPath(bump: RangeBump): string {
  return displayPath(path.join(bump.folder, "package.json"));
}

function describeBump(bump: InterfaceBump): string {
  const { arrow } = getProcessUi().symbols;
  if (bump.kind === "range") {
    const manifest = manifestPath(bump);
    return `${bump.packageName}: ${bump.from} ${arrow} ${bump.to} in ${manifest}, ${requiredByText(bump)}`;
  }
  return `${bump.moduleId} installs ${bump.packageName} ${bump.current}; resolving its dependencies again gives ${bump.target}, ${requiredByText(bump)}`;
}

function fixHint(options: InterfaceCheckOptions): string {
  return `Run ${scopedCommand(`${options.command} ${FIX_FLAG}`, options)} to apply the changes`;
}

function bumpFixes(
  bumps: InterfaceBump[],
  options: InterfaceCheckOptions,
): string[] {
  const relocked = [
    ...new Set(
      bumps.filter((bump) => bump.kind === "relock").map((b) => b.moduleId),
    ),
  ];
  return [
    fixHint(options),
    ...relocked.map(
      (moduleId) =>
        `Or run ${scopedCommand(`${UPDATE_COMMAND} ${moduleId}`, options)}`,
    ),
  ];
}

async function applyRangeBumps(folder: string, bumps: RangeBump[]) {
  const manifest = await readModuleManifest(folder);
  if (!manifest) {
    return;
  }
  bumps.forEach((bump) => {
    manifest[bump.field] = {
      ...manifest[bump.field],
      [bump.packageName]: bump.to,
    };
  });
  await writeModuleManifest(folder, manifest);
  bumps.forEach((bump) =>
    getProcessUi().message(
      "success",
      `Raised ${bump.packageName} to ${bump.to} in ${manifestPath(bump)}`,
    ),
  );
  const command = await getInstallCommand(folder, false, undefined, "update");
  await runTask(
    `Installing the dependencies of ${displayPath(folder)}`,
    () => ExecuteCMD(command, { cwd: folder }),
    { done: `Installed the dependencies of ${displayPath(folder)}` },
  );
  bumps.forEach(ensureTargetInstalled);
}

/**
 * Checks that the install after a range bump left the module on a copy at
 * least as new as the target: a package manager skips an optional dependency
 * it cannot fetch, and a check of a module without a copy finds nothing.
 *
 * @throws CliError naming the module, the package and the copy it got.
 */
function ensureTargetInstalled(bump: RangeBump): void {
  const installed = valid(
    resolvePackage(bump.packageName, bump.folder)?.version,
  );
  if (installed && !lt(installed, bump.target)) {
    return;
  }
  throw new CliError({
    title: `Could not install ${bump.packageName} ${bump.target} for ${bump.moduleId}`,
    reason: `${manifestPath(bump)} now asks for ${bump.to}, but its dependencies hold ${installed ?? "no copy"} of ${bump.packageName}.`,
    fixes: [
      `Check that the registry serves ${bump.packageName} ${bump.target}, then install the dependencies of ${displayPath(bump.folder)} again`,
    ],
  });
}

async function applyBumps(
  bumps: InterfaceBump[],
  options: InterfaceCheckOptions,
): Promise<void> {
  const ranges = new Map<string, RangeBump[]>();
  const relocks = new Map<string, RelockBump>();
  for (const bump of bumps) {
    if (bump.kind === "range") {
      ranges.set(bump.folder, [...(ranges.get(bump.folder) ?? []), bump]);
    } else {
      relocks.set(bump.moduleId, bump);
    }
  }
  for (const [folder, folderBumps] of ranges) {
    await applyRangeBumps(folder, folderBumps);
  }
  await refreshModuleLocks(
    options.project,
    options.config,
    [...relocks.values()].map(({ moduleId, source }) => ({
      id: moduleId,
      source,
    })),
  );
}

function warnDrift(bumps: InterfaceBump[], options: InterfaceCheckOptions) {
  if (bumps.length === 0) {
    return;
  }
  getProcessUi().message(
    "warn",
    "Modules compile against an older interface copy than the shared one:",
    {
      details: [...bumps.map(describeBump), fixHint(options)],
    },
  );
}

/**
 * What a check after `--fix` reports for the bumps still pending: resolving
 * again did not reach the target, so running `--fix` again would not either.
 */
function unreachedProblem(bumps: InterfaceBump[]): CliProblem {
  return {
    title: UNREACHED_TITLE,
    reason: UNREACHED_REASON,
    details: bumps.map(
      (bump) =>
        `${bump.moduleId} still installs ${bump.packageName} ${bump.current}, and ${bump.target} is ${requiredByText(bump)}`,
    ),
    fixes: bumps.flatMap((bump) => [
      `Check that the registry serves ${bump.packageName} ${bump.target} to ${bump.moduleId}`,
      `Or update ${bump.moduleId} to a release that depends on ${bump.packageName} ${bump.target}`,
    ]),
  };
}

/**
 * Checks, for every environment in `options`, that each interface package
 * has one installed copy every module accepts, and that the project's own
 * modules and the shared copy use it. With `fix`, applies the bumps first and
 * checks again. A bump that only aligns a local module's copy is a warning.
 *
 * @returns the failure to throw once the command has reported its summary:
 * the bumps a launch needs, or the range conflicts no installed copy solves.
 */
export async function checkInterfaceVersions(
  options: InterfaceCheckOptions,
): Promise<Error | undefined> {
  let result = await checkEnvironments(options.project, options.environments);
  if (options.fix && result.bumps.length > 0) {
    await applyBumps(result.bumps, options);
    result = await checkEnvironments(options.project, options.environments);
  }
  warnDrift(
    result.bumps.filter((bump) => !bump.required),
    options,
  );
  const required = result.bumps.filter((bump) => bump.required);
  if (required.length > 0 && options.fix) {
    return new CliError(unreachedProblem(required));
  }
  if (required.length > 0) {
    return new CliError({
      title: BUMP_TITLE,
      reason: BUMP_REASON,
      details: required.map(describeBump),
      fixes: bumpFixes(required, options),
    });
  }
  if (result.conflicts.length > 0) {
    return new InterfaceResolutionError({
      rangeConflicts: result.conflicts,
      preloadedCopies: [],
    });
  }
  return undefined;
}
