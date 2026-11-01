import { Logging } from "@antelopejs/interface-core/logging";

import type { ManagedModule, ModuleManager } from "../modules";
import {
  type InterfaceRangeConflict,
  InterfaceResolutionError,
} from "../output";
import {
  findUnresolvedInterfaces,
  type InterfaceConsumer,
  type InterfaceProvider,
  type InterfaceResolutionResult,
  type UnresolvedInterface,
} from "../resolution";
import type { ModuleManifestEntry } from "./runtime-types";

const Logger = new Logging.Channel("loader");

interface PartitionedModuleEntries {
  required: ModuleManifestEntry[];
  optional: ModuleManifestEntry[];
}

/**
 * Splits the entries of a project into the ones a launch adds and starts as a
 * whole and the `optional: true` ones it adds one at a time afterwards.
 */
export function partitionModuleEntries(
  entries: ModuleManifestEntry[],
): PartitionedModuleEntries {
  return {
    required: entries.filter((entry) => !entry.config?.optional),
    optional: entries.filter((entry) => entry.config?.optional),
  };
}

async function discardCreatedModules(
  manager: ModuleManager,
  created: ManagedModule[],
): Promise<void> {
  await Promise.allSettled(created.map(({ module }) => module.destroy()));
  manager.discardModules(created.map(({ module }) => module.id));
}

/**
 * Checks the interfaces of modules `LoadModule` just added, then constructs
 * and optionally starts them. When any of that fails, they are destroyed and
 * dropped again: a module left behind would still count as a consumer of its
 * interface packages, and every later load would fail its checks.
 */
export async function activateLoadedModules(
  manager: ModuleManager,
  created: ManagedModule[],
  autostart: boolean,
): Promise<void> {
  try {
    ensureInterfacesResolved(manager, created);
    await manager.constructModules(created);
    if (autostart) {
      await manager.startModules(created);
    }
  } catch (error) {
    await discardCreatedModules(manager, created);
    throw error;
  }
}

function collectInterfaceProviders(
  manager: ModuleManager,
): InterfaceProvider[] {
  return manager.getAllManagedModules().map(({ module, config }) => ({
    name: module.manifest.manifest.name,
    implements: module.manifest.implements ?? [],
    disabledExports: config.disabledExports,
  }));
}

function collectStaticPackages(manager: ModuleManager): string[] {
  const loadedIds = new Set(
    [...manager.getLoadedModules()].map(({ module }) => module.id),
  );
  return manager
    .getAllManagedModules()
    .filter(({ module }) => !loadedIds.has(module.id))
    .flatMap(({ module }) => [
      module.manifest.manifest.name,
      ...Object.keys(module.manifest.manifest.dependencies ?? {}),
    ]);
}

function toInterfaceConsumer({ module }: ManagedModule): InterfaceConsumer {
  return {
    id: module.id,
    folder: module.manifest.folder,
    dependencies: module.manifest.manifest.dependencies ?? {},
    optionalDependencies: module.manifest.manifest.optionalDependencies ?? {},
  };
}

function unresolvedInterfacesError(unresolved: UnresolvedInterface[]): Error {
  const details = unresolved
    .map(
      ({ moduleId, interfacePackage }) =>
        `  - ${moduleId} requires ${interfacePackage}`,
    )
    .join("\n");
  return new Error(
    `Unresolved interface dependencies:\n${details}\n\nRun 'ajs project modules install' to resolve missing dependencies.`,
  );
}

function findInterfaces(
  manager: ModuleManager,
  consumers: Iterable<ManagedModule>,
): InterfaceResolutionResult {
  return findUnresolvedInterfaces(
    collectInterfaceProviders(manager),
    [...consumers].map(toInterfaceConsumer),
    collectStaticPackages(manager),
  );
}

function registerStubs(
  manager: ModuleManager,
  stubbed: UnresolvedInterface[],
): void {
  if (stubbed.length > 0) {
    manager.registerStubbedInterfaces(stubbed);
  }
}

/**
 * Checks that every interface `consumers` require is implemented by a module
 * the manager holds, them included, and tells which optional ones nothing
 * implements.
 *
 * @throws the "Unresolved interface dependencies" error naming each missing
 * interface and the module that requires it.
 */
function ensureInterfacesResolved(
  manager: ModuleManager,
  consumers: Iterable<ManagedModule>,
): InterfaceResolutionResult {
  const result = findInterfaces(manager, consumers);
  if (result.unresolved.length > 0) {
    throw unresolvedInterfacesError(result.unresolved);
  }
  return result;
}

/**
 * Checks the interfaces of every loaded module at startup, and stubs the
 * optional ones nothing implements.
 */
export function ensureGraphIsValid(manager: ModuleManager): void {
  const { stubbed } = ensureInterfacesResolved(
    manager,
    manager.getLoadedModules(),
  );
  registerStubs(manager, stubbed);
}

/**
 * Plans the shared copy of every interface package the loaded modules use,
 * stubbing the optional ones nothing implements, without failing on a
 * required interface nothing implements.
 */
export function planInterfacePackages(manager: ModuleManager): void {
  registerStubs(
    manager,
    findInterfaces(manager, manager.getLoadedModules()).stubbed,
  );
}

function rangeConflictError(
  rangeConflicts: InterfaceRangeConflict[],
): InterfaceResolutionError {
  return new InterfaceResolutionError({ rangeConflicts, preloadedCopies: [] });
}

/**
 * Adds one optional module and checks, from package.json files only, what
 * constructing it would check. A module that fails is dropped again and its
 * error is logged, as a launch runs on without it.
 */
async function checkOptionalModule(
  manager: ModuleManager,
  entry: ModuleManifestEntry,
): Promise<void> {
  const created = manager.addModules([entry]);
  try {
    ensureInterfacesResolved(manager, created);
    const rangeConflicts = manager.findInterfaceRangeConflicts();
    if (rangeConflicts.length > 0) {
      throw rangeConflictError(rangeConflicts);
    }
  } catch (error) {
    await discardCreatedModules(manager, created);
    Logger.Warn(
      `Optional module ${entry.manifest.name} would fail to start; a launch runs without it.`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Adds the entries of a project to `manager` in the order a launch does, and
 * checks from package.json files only that the shared copy of each interface
 * package satisfies the range every module declares for it. The required
 * modules are checked together and decide the result. Each optional module is
 * then added on its own, and one that would fail is dropped with a warning,
 * since a launch runs without it.
 *
 * @param planRequired plans the interface packages of the required modules.
 * @returns the range conflicts among the required modules, none when the
 * check passes.
 */
export async function findEntryRangeConflicts(
  manager: ModuleManager,
  entries: ModuleManifestEntry[],
  planRequired: (manager: ModuleManager) => void,
): Promise<InterfaceRangeConflict[]> {
  const { required, optional } = partitionModuleEntries(entries);
  manager.addModules(required);
  planRequired(manager);
  const rangeConflicts = manager.findInterfaceRangeConflicts();
  if (rangeConflicts.length > 0) {
    return rangeConflicts;
  }
  for (const entry of optional) {
    await checkOptionalModule(manager, entry);
  }
  return [];
}

/**
 * Throws the {@link InterfaceResolutionError} the modules would otherwise
 * throw when constructed.
 *
 * @throws InterfaceResolutionError when `rangeConflicts` is not empty.
 */
export function ensureNoRangeConflicts(
  rangeConflicts: InterfaceRangeConflict[],
): void {
  if (rangeConflicts.length > 0) {
    throw rangeConflictError(rangeConflicts);
  }
}
