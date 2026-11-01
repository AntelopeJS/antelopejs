import { ModuleManager } from "../modules";
import type { InterfaceRangeConflict } from "../output";
import {
  createModuleEntriesForManager,
  findEntryRangeConflicts,
  loadProjectConfig,
  planInterfacePackages,
  withRaisedMaxListeners,
} from "../runtime";

/**
 * Loads the modules of the project for `env` the way `build` does, without
 * running their code, and lists every required module whose declared range of
 * an interface package excludes the shared copy it would get at startup. An
 * `optional: true` module is checked after them as a launch adds it and is
 * left out, with a warning, when it would fail. A required interface that no
 * module implements is not reported here.
 */
export async function findProjectInterfaceRangeConflicts(
  projectFolder: string,
  env: string,
): Promise<InterfaceRangeConflict[]> {
  const { normalizedConfig } = await loadProjectConfig(projectFolder, env);
  return withRaisedMaxListeners(async () => {
    const manager = new ModuleManager();
    try {
      const entries = await createModuleEntriesForManager(
        manager,
        normalizedConfig,
        false,
      );
      return findEntryRangeConflicts(manager, entries, planInterfacePackages);
    } finally {
      await manager.destroyAll();
    }
  });
}
