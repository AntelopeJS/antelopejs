import type { ModuleSource } from "@antelopejs/interface-core/config";

import { ModuleState } from "../../types";
import type { ManagedModule, ModuleManager } from "../modules";
import { Module, ModuleManifest, unpackErrors } from "../modules";
import type { LoaderContext } from "./runtime-types";

async function loadModuleManifestFromSource(
  loaderContext: LoaderContext,
  source: ModuleSource,
  moduleId: string,
  reload = false,
): Promise<ModuleManifest> {
  const manifests = await loaderContext.registry.load(
    loaderContext.projectFolder,
    loaderContext.cache,
    {
      ...source,
      id: moduleId,
    },
    { reload },
  );
  const [manifest] = manifests;
  if (!manifest) {
    throw new Error(
      `Failed to reload module ${moduleId}: no manifest returned`,
    );
  }
  return manifest;
}

function ensureReloadedModuleId(module: Module, moduleId: string): void {
  if (module.id !== moduleId) {
    throw new Error(
      `Reloaded module id mismatch: expected ${moduleId}, got ${module.id}`,
    );
  }
}

export async function reloadLoadedModuleFromSource(
  manager: ModuleManager,
  loaderContext: LoaderContext,
  moduleId: string,
): Promise<void> {
  const entry = manager.getLoadedModuleEntry(moduleId);
  if (!entry) {
    return;
  }

  const previous = entry.module;
  const manifest = manager.placeModule(
    moduleId,
    await loadModuleManifestFromSource(
      loaderContext,
      previous.manifest.source,
      moduleId,
      true,
    ),
  );
  const replacement = new Module(manifest);
  try {
    ensureReloadedModuleId(replacement, moduleId);
    manager.checkReplacement(moduleId, replacement);
  } catch (error) {
    manager.discardPlacedModule(manifest);
    throw error;
  }
  const previousWasActive = previous.state === ModuleState.Active;
  try {
    await previous.destroy();
  } catch (error) {
    manager.discardPlacedModule(manifest);
    const recoveryErrors = await recoverPreviousModule(
      manager,
      entry,
      previousWasActive,
    );
    throw new AggregateError(
      [...unpackErrors(error), ...recoveryErrors],
      `Failed to destroy module ${moduleId} during reload`,
    );
  }
  manager.unrequireModuleFiles(moduleId);
  await activateReplacement(manager, entry, replacement);
}

async function recoverPreviousModule(
  manager: ModuleManager,
  previous: ManagedModule,
  previousWasActive: boolean,
): Promise<unknown[]> {
  if (!previousWasActive || previous.module.state !== ModuleState.Constructed) {
    return [];
  }
  try {
    await manager.startModules([previous]);
    return [];
  } catch (error) {
    return [error];
  }
}

async function activateReplacement(
  manager: ModuleManager,
  entry: ManagedModule,
  replacement: Module,
): Promise<void> {
  let replacementInstalled = false;
  try {
    replacementInstalled = Boolean(
      manager.replaceLoadedModule(replacement.id, replacement),
    );
    if (!replacementInstalled) {
      throw new Error(`Failed to replace module ${replacement.id}`);
    }
    manager.refreshAssociations();
    const replacementEntry = { module: replacement, config: entry.config };
    await manager.constructModules([replacementEntry]);
    await manager.startModules([replacementEntry]);
  } catch (error) {
    const cleanupErrors = replacementInstalled
      ? await cleanupReplacement(replacement)
      : [];
    throw new AggregateError(
      [...unpackErrors(error), ...cleanupErrors],
      `Failed to activate replacement module ${replacement.id}`,
    );
  }
}

async function cleanupReplacement(replacement: Module): Promise<unknown[]> {
  try {
    await replacement.destroy();
    return [];
  } catch (error) {
    return unpackErrors(error);
  }
}

export async function reloadWatchedModule(
  manager: ModuleManager,
  moduleId: string,
  loaderContext: LoaderContext,
): Promise<void> {
  await reloadLoadedModuleFromSource(manager, loaderContext, moduleId);
}
