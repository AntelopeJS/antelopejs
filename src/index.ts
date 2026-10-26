import type { LaunchOptions } from "./types";
import { ModuleManager } from "./core/modules/module-manager";
import { DEFAULT_ENV } from "./core/config/config-paths";
import { startProject } from "./core/repl/project-launch";
import type { BuildOptions } from "./core/runtime/runtime-types";
import { prepareFromConfig } from "./core/runtime/launch-sequence";
import { writeProjectBuildArtifact } from "./core/runtime/build-runtime";
import {
  checkOutdatedModules,
  warnOutdatedModules,
} from "./core/modules/version-checker";
import {
  ensureGraphIsValid,
  loadModuleEntriesForManager,
} from "./core/runtime/module-loading";
import {
  loadProjectRuntimeConfig,
  withRaisedMaxListeners,
} from "./core/runtime/runtime-bootstrap";

export { ConfigLoader } from "./core/config/config-loader";
export { DEFAULT_ENV } from "./core/config/config-paths";
export { DownloaderRegistry } from "./core/downloaders/registry";
export { AntelopeRuntime, createRuntime } from "./core/embedded/runtime";
export type {
  EmbeddedModuleConfig,
  EmbeddedRuntimeOptions,
  ProvideHandle,
} from "./core/embedded/types";
export { Module } from "./core/modules/module";
export { ModuleCache } from "./core/modules/module-cache";
export { ModuleManager } from "./core/modules/module-manager";
export { ModuleManifest } from "./core/modules/module-manifest";
export { launchFromBuild } from "./core/repl/project-launch";
export { BuildModuleSetChangedError } from "./core/runtime/build-refresh";
export type { RuntimePolicy } from "./core/runtime/runtime-policy";
export type { BuildOptions } from "./core/runtime/runtime-types";
export { TestModule } from "./core/test/test-module";
export { BuildLaunchOptions, LaunchOptions } from "./types";

export async function launch(
  projectFolder: string = ".",
  env: string = DEFAULT_ENV,
  options: LaunchOptions = {},
): Promise<ModuleManager> {
  const started = await startProject(
    prepareFromConfig,
    projectFolder,
    env,
    options,
  );
  return started.manager;
}

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

export default launch;
