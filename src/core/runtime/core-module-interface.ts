import * as coreInterfaceBeta from "@antelopejs/interface-core";
import type {
  ModuleSource,
  ModuleSourceLocal,
} from "@antelopejs/interface-core/config";
import * as moduleInterfaceBeta from "@antelopejs/interface-core/modules";
import path from "node:path";

import type { ModuleDeclarationChanges } from "../config";
import {
  listModuleDeclarations,
  removeModuleDeclaration,
  saveModuleDeclaration,
} from "../config";
import type { ModuleConfig, ModuleManager } from "../modules";
import { ModuleManifest } from "../modules";
import { activateLoadedModules } from "./module-interfaces";
import { reloadLoadedModuleFromSource } from "./module-reloading";
import type {
  LoaderContextProvider,
  ModuleOverrideMap,
  ModuleOverrideRef,
} from "./runtime-types";

const CORE_MODULE_ID = "antelopejs";

const MODULE_STATUS_MAP = {
  loaded: "loaded",
  constructed: "constructed",
  active: "active",
} satisfies Record<string, moduleInterfaceBeta.ModuleInfo["status"]>;

function mapImportOverrides(
  overrides?: Record<string, string[]>,
): ModuleOverrideMap {
  const mapped: ModuleOverrideMap = new Map();
  if (!overrides) {
    return mapped;
  }

  for (const [interfaceName, modules] of Object.entries(overrides)) {
    const overrideEntries = modules.map((module): ModuleOverrideRef => ({
      module,
    }));
    mapped.set(interfaceName, overrideEntries);
  }

  return mapped;
}

function exportImportOverrides(overrides?: ModuleOverrideMap) {
  const result: Record<string, string[]> = {};
  if (!overrides) {
    return result;
  }

  for (const [interfaceName, modules] of overrides.entries()) {
    result[interfaceName] = modules.flatMap((entry) =>
      entry.module === undefined ? [] : [entry.module],
    );
  }

  return result;
}

function getModuleStatus(module: {
  state: string;
}): moduleInterfaceBeta.ModuleInfo["status"] {
  const statuses: typeof MODULE_STATUS_MAP &
    Record<string, moduleInterfaceBeta.ModuleInfo["status"]> =
    MODULE_STATUS_MAP;
  return statuses[module.state] ?? "unknown";
}

function toModuleSource(
  source: moduleInterfaceBeta.ModuleDefinition["source"],
): ModuleSource {
  const type = source?.type;
  if (
    type !== "local" &&
    type !== "git" &&
    type !== "package" &&
    type !== "local-folder"
  ) {
    throw new Error(`Unsupported module source type: ${String(type)}`);
  }
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- Beta source declarations allow arbitrary id/ignoreCache values; validating more than type would change the accepted definition contract (#228).
  return source as ModuleSource;
}

/**
 * Takes down the running generation of every module `manifests` replaces, so
 * `LoadModule` on an id that is already loaded behaves like a reload. Without
 * this the replacement is required from the files the previous generation
 * left in the require cache, whose interface calls are bound to its
 * now-invalidated context: its `construct` fails with
 * `ModuleContextInvalidatedError`.
 */
async function retireReplacedModules(
  manager: ModuleManager,
  manifests: ModuleManifest[],
): Promise<void> {
  for (const manifest of manifests) {
    const previous = manager.getLoadedModuleEntry(manifest.name);
    if (!previous) {
      continue;
    }
    await previous.module.stop();
    await previous.module.destroy();
    manager.unrequireModuleFiles(manifest.name);
  }
}

export function registerCoreModuleInterface(
  manager: ModuleManager,
  loadContext: LoaderContextProvider,
): void {
  moduleInterfaceBeta.RunWithModuleContext({ module: CORE_MODULE_ID }, () =>
    coreInterfaceBeta.ImplementInterface(moduleInterfaceBeta, {
      ListModules: async () => manager.listModules(),
      GetModuleInfo: async (moduleId: string) => {
        const entry = manager.getModuleEntry(moduleId);
        if (!entry) {
          throw new Error(`Module not found: ${moduleId}`);
        }

        return {
          source: entry.module.manifest.source,
          config: entry.config.config,
          disabledExports: [...(entry.config.disabledExports ?? new Set())],
          importOverrides: exportImportOverrides(entry.config.importOverrides),
          localPath: entry.module.manifest.folder,
          status: getModuleStatus(entry.module),
        };
      },
      LoadModule: async (
        moduleId: string,
        declaration: moduleInterfaceBeta.ModuleDefinition,
        autostart = false,
      ) => {
        const source = toModuleSource(declaration.source);
        const loaderContext = await loadContext();
        const manifests = await loaderContext.registry.load(
          loaderContext.projectFolder,
          loaderContext.cache,
          {
            ...source,
            id: moduleId,
          },
        );

        await retireReplacedModules(manager, manifests);

        const moduleConfig: ModuleConfig = {
          config: declaration.config,
          disabledExports: new Set(declaration.disabledExports ?? []),
          importOverrides: mapImportOverrides(declaration.importOverrides),
        };

        const created = manager.addModules(
          manifests.map((manifest) => ({ manifest, config: moduleConfig })),
        );
        await activateLoadedModules(manager, created, autostart);
        return created.map(({ module }) => module.id);
      },
      StartModule: async (moduleId: string) => {
        const entry = manager.getModuleEntry(moduleId);
        if (entry) {
          await manager.startModules([entry]);
        }
      },
      StopModule: async (moduleId: string) => {
        await manager.getModule(moduleId)?.stop();
      },
      DestroyModule: async (moduleId: string) => {
        await manager.getModule(moduleId)?.destroy();
      },
      ListModuleDeclarations: async () =>
        listModuleDeclarations((await loadContext()).projectFolder),
      SaveModuleDeclaration: async (
        moduleId: string,
        changes: ModuleDeclarationChanges,
      ) =>
        saveModuleDeclaration(
          (await loadContext()).projectFolder,
          moduleId,
          changes,
        ),
      RemoveModuleDeclaration: async (moduleId: string) =>
        removeModuleDeclaration((await loadContext()).projectFolder, moduleId),
      ReloadModule: async (moduleId: string) => {
        await reloadLoadedModuleFromSource(
          manager,
          await loadContext(),
          moduleId,
        );
      },
    }),
  );
}

export async function registerCoreInterfaces(
  manager: ModuleManager,
): Promise<ModuleManifest> {
  const coreFolder = path.resolve(path.join(__dirname, "..", "..", ".."));
  const coreSource: ModuleSourceLocal = { type: "local", path: coreFolder };
  const coreManifest = await ModuleManifest.create(
    coreFolder,
    coreSource,
    "antelopejs",
  );
  manager.addStaticModule({ manifest: coreManifest });
  return coreManifest;
}
