import { DEFAULT_ENV } from "../config";
import {
  ModuleManager,
  checkOutdatedModules,
  getBuildArtifactPath,
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
  pruneModuleCache,
  withRaisedMaxListeners,
  writeBuildPin,
  writeProjectBuildArtifact,
} from "../runtime";

export * as interfaceRangesModule from "./interface-ranges";
export type { ProjectInterfaceCheck } from "./interface-ranges";

/**
 * Loads the modules of the project for `env`, checks that their interfaces
 * resolve and that each shared interface package satisfies the range every
 * module declares, then writes `.antelope/build/build.json`, pins it in the
 * module cache and removes the cached modules that no live run uses and no
 * build points at. Nothing is written or removed when a check fails. The
 * check follows a launch: the required modules decide it, and an
 * `optional: true` module that would fail it is only warned about, since a
 * launch runs without it.
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
      const { normalizedConfig, fs } = runtimeConfig;
      const loaderContext = await createLoaderContext(normalizedConfig, fs);
      const entries = await createModuleEntriesForManager(
        manager,
        normalizedConfig,
        false,
        loaderContext,
      );
      ensureNoRangeConflicts(
        await findEntryRangeConflicts(manager, entries, ensureGraphIsValid),
      );
      await writeProjectBuildArtifact(normalizedConfig, env, entries, fs);
      const { cache } = loaderContext;
      await writeBuildPin(
        cache.path,
        getBuildArtifactPath(normalizedConfig.projectFolder),
        fs,
      );
      await pruneModuleCache(cache, normalizedConfig.projectFolder, fs);
    } finally {
      await manager.destroyAll();
    }
  });
}
