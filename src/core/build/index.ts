import type { ModuleSource } from "@antelopejs/interface-core/config";

import { DEFAULT_ENV } from "../config";
import {
  ModuleManager,
  checkOutdatedModules,
  getBuildArtifactPath,
  warnOutdatedModules,
} from "../modules";
import type { BuildOptions } from "../runtime";
import {
  buildModuleConfigs,
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

const REMOTE_SOURCE_TYPES: ReadonlySet<ModuleSource["type"]> = new Set([
  "package",
  "git",
]);

/**
 * Downloads and installs into the module cache the modules of `env` that come
 * from outside the project, `package` and `git` sources, exactly as
 * {@link build} does, honouring the module locks and `frozenModules`. It needs
 * only the configuration and `antelope-lock/`: it skips `local` and
 * `local-folder` modules, checks nothing about how the modules load, and
 * writes no build artifact. A later {@link build} with the same configuration
 * and locks reuses what it installed.
 *
 * @returns The ids of the modules it installed.
 */
export async function installRemoteModules(
  projectFolder: string = ".",
  env: string = DEFAULT_ENV,
  options: BuildOptions = {},
): Promise<string[]> {
  const { normalizedConfig, fs } = await loadProjectRuntimeConfig(
    projectFolder,
    env,
    options,
  );
  const modules = Object.fromEntries(
    Object.entries(normalizedConfig.modules).filter(([, module]) =>
      REMOTE_SOURCE_TYPES.has(module.source.type),
    ),
  );
  await withRaisedMaxListeners(async () => {
    const loaderContext = await createLoaderContext(normalizedConfig, fs);
    await buildModuleConfigs({ ...normalizedConfig, modules }, loaderContext);
  });
  return Object.keys(modules);
}

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
