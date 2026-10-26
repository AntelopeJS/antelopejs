import { DEFAULT_ENV } from "../config";
import {
  ModuleManager,
  checkOutdatedModules,
  warnOutdatedModules,
} from "../modules";
import type { BuildOptions } from "../runtime";
import {
  ensureGraphIsValid,
  loadModuleEntriesForManager,
  loadProjectRuntimeConfig,
  withRaisedMaxListeners,
  writeProjectBuildArtifact,
} from "../runtime";

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
