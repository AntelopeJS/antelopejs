import { DEFAULT_ENV } from "../config";
import {
  ModuleManager,
  checkOutdatedModules,
  warnOutdatedModules,
} from "../modules";
import type { BuildOptions } from "../runtime";
import {
  createLoaderContext,
  createModuleEntriesForManager,
  ensureGraphIsValid,
  ensureNoRangeConflicts,
  findEntryRangeConflicts,
  loadProjectRuntimeConfig,
  withRaisedMaxListeners,
  writeProjectBuildArtifact,
} from "../runtime";

export * as interfaceRangesModule from "./interface-ranges";
export type { ProjectInterfaceCheck } from "./interface-ranges";

/**
 * Loads the modules of the project for `env`, checks that their interfaces
 * resolve and that each shared interface package satisfies the range every
 * module declares, then writes `.antelope/build/build.json` and removes the
 * cached modules it did not load. Nothing is written or removed when a check
 * fails. The check follows a launch: the required
 * modules decide it, and an `optional: true` module that would fail it is
 * only warned about, since a launch runs without it.
 *
 * @throws InterfaceResolutionError when a required module's declared range of
 * an interface package excludes the shared copy.
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
      const loaderContext = await createLoaderContext(
        runtimeConfig.normalizedConfig,
        runtimeConfig.fs,
      );
      const entries = await createModuleEntriesForManager(
        manager,
        runtimeConfig.normalizedConfig,
        false,
        loaderContext,
      );
      ensureNoRangeConflicts(
        await findEntryRangeConflicts(manager, entries, ensureGraphIsValid),
      );
      await writeProjectBuildArtifact(
        runtimeConfig.normalizedConfig,
        env,
        entries,
        runtimeConfig.fs,
      );
      await loaderContext.cache.prune();
    } finally {
      await manager.destroyAll();
    }
  });
}
