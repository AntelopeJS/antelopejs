import { type InterfaceBump, ModuleManager } from "../modules";
import type { InterfaceRangeConflict } from "../output";
import {
  createLoaderContext,
  createModuleEntriesForManager,
  findEntryRangeConflicts,
  type LoaderConfig,
  loadProjectConfig,
  planInterfacePackages,
  withRaisedMaxListeners,
} from "../runtime";

/** What {@link checkProjectInterfaces} finds in one environment. */
export interface ProjectInterfaceCheck {
  /** The required modules whose range excludes the shared copy. */
  conflicts: InterfaceRangeConflict[];
  /** The changes that give each module the copy every module accepts. */
  bumps: InterfaceBump[];
}

/**
 * Loads the modules of the project for `env` the way `build` does, without
 * running their code, and lists every required module whose declared range of
 * an interface package excludes the shared copy it would get at startup,
 * with the bumps that fix it. An `optional: true` module is checked after
 * them as a launch adds it and is left out, with a warning, when it would
 * fail. A required interface that no module implements is not reported here.
 */
export async function checkProjectInterfaces(
  projectFolder: string,
  env: string,
  { installCommands }: Pick<LoaderConfig, "installCommands"> = {},
): Promise<ProjectInterfaceCheck> {
  const { normalizedConfig } = await loadProjectConfig(projectFolder, env);
  return withRaisedMaxListeners(async () => {
    const manager = new ModuleManager();
    try {
      const entries = await createModuleEntriesForManager(
        manager,
        normalizedConfig,
        false,
        await createLoaderContext({ ...normalizedConfig, installCommands }),
      );
      const conflicts = await findEntryRangeConflicts(
        manager,
        entries,
        planInterfacePackages,
      );
      return { conflicts, bumps: manager.findInterfaceBumps() };
    } finally {
      await manager.destroyAll();
    }
  });
}
