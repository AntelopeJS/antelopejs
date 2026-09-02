import { DEFAULT_ENV } from "./core/config/config-paths";
import { ModuleManager } from "./core/module-manager";
import { writeProjectBuildArtifact } from "./core/runtime/build-runtime";
import { prepareFromConfig } from "./core/runtime/launch-sequence";
import {
  ensureGraphIsValid,
  loadModuleEntriesForManager,
} from "./core/runtime/module-loading";
import { startProject } from "./core/runtime/project-launch";
import {
  loadProjectRuntimeConfig,
  withRaisedMaxListeners,
} from "./core/runtime/runtime-bootstrap";
import type { BuildOptions } from "./core/runtime/runtime-types";
import {
  checkOutdatedModules,
  warnOutdatedModules,
} from "./core/version-checker";
import type { LaunchOptions } from "./types";

export { ConfigLoader } from "./core/config/config-loader";
export { DEFAULT_ENV } from "./core/config/config-paths";
export { DownloaderRegistry } from "./core/downloaders/registry";
export {
  AntelopeRuntime,
  createRuntime,
} from "./core/embedded/runtime";
export type {
  EmbeddedModuleConfig,
  EmbeddedRuntimeOptions,
  ProvideHandle,
} from "./core/embedded/types";
export { Module } from "./core/module";
export { ModuleCache } from "./core/module-cache";
export { ModuleManager } from "./core/module-manager";
export { ModuleManifest } from "./core/module-manifest";
export { launchFromBuild } from "./core/runtime/project-launch";
export type { RuntimePolicy } from "./core/runtime/runtime-policy";
export type { BuildOptions } from "./core/runtime/runtime-types";
export { TestModule } from "./core/test/test-module";
export { LaunchOptions } from "./types";

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
