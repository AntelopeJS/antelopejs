import { DEFAULT_ENV } from "../config";
import {
  ModuleManager,
  checkOutdatedModules,
  warnOutdatedModules,
} from "../modules";
import type { BuildOptions } from "../runtime";
import {
  ensureGraphIsValid,
  ensureInterfaceRangesAreValid,
  loadModuleEntriesForManager,
  loadProjectRuntimeConfig,
  withRaisedMaxListeners,
  writeProjectBuildArtifact,
} from "../runtime";

export * as interfaceRangesModule from "./interface-ranges";

/**
 * Loads the modules of the project for `env`, checks that their interfaces
 * resolve and that each shared interface package satisfies the range every
 * module declares, then writes `.antelope/build/build.json`. Nothing is
 * written when a check fails.
 *
 * @throws InterfaceResolutionError when a module's declared range of an
 * interface package excludes the shared copy.
 */
export async function build(
  projectFolder: string = ".",
  env: string = DEFAULT_ENV,
  options: BuildOptions = {},
): Promise<void> {
  const runtimeConfig = await loadProjectRuntimeConfig(
    projectFolder,
    env,
    options,
  );
  const outdated = await checkOutdatedModules(
    runtimeConfig.normalizedConfig.modules,
  );
  warnOutdatedModules(outdated);

  await withRaisedMaxListeners(async () => {
    const manager = new ModuleManager();
    try {
      const entries = await loadModuleEntriesForManager(
        manager,
        runtimeConfig.normalizedConfig,
        false,
      );
      ensureGraphIsValid(manager);
      ensureInterfaceRangesAreValid(manager);
      await writeProjectBuildArtifact(
        runtimeConfig.normalizedConfig,
        env,
        entries,
        runtimeConfig.fs,
      );
    } finally {
      await manager.destroyAll();
    }
  });
}
