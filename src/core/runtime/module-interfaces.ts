import type { ManagedModule, ModuleManager } from "../modules";
import {
  findUnresolvedInterfaces,
  type InterfaceConsumer,
  type InterfaceProvider,
  type InterfaceResolutionResult,
  type UnresolvedInterface,
} from "../resolution";

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
    await Promise.allSettled(created.map(({ module }) => module.destroy()));
    manager.discardModules(created.map(({ module }) => module.id));
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
  const result = findUnresolvedInterfaces(
    collectInterfaceProviders(manager),
    [...consumers].map(toInterfaceConsumer),
    collectStaticPackages(manager),
  );
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
  if (stubbed.length > 0) {
    manager.registerStubbedInterfaces(stubbed);
  }
}
