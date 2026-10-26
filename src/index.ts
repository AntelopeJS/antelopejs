import { build as buildProject } from "./core/build";
import { DEFAULT_ENV } from "./core/config";
import type { ModuleManager } from "./core/modules";
import { launch as launchProject } from "./core/repl";
import type { BuildOptions } from "./core/runtime";
import type { LaunchOptions } from "./types";

export { ConfigLoader, DEFAULT_ENV } from "./core/config";
export { DownloaderRegistry } from "./core/downloaders";
export { AntelopeRuntime, createRuntime } from "./core/embedded";
export type {
  EmbeddedModuleConfig,
  EmbeddedRuntimeOptions,
  ProvideHandle,
} from "./core/embedded";
export {
  Module,
  ModuleCache,
  ModuleManager,
  ModuleManifest,
} from "./core/modules";
export { launchFromBuild } from "./core/repl";
export { BuildModuleSetChangedError } from "./core/runtime";
export type { BuildOptions, RuntimePolicy } from "./core/runtime";
export { TestModule } from "./core/test";
export { BuildLaunchOptions, LaunchOptions } from "./types";

export async function launch(
  projectFolder: string = ".",
  env: string = DEFAULT_ENV,
  options: LaunchOptions = {},
): Promise<ModuleManager> {
  return launchProject(projectFolder, env, options);
}

export async function build(
  projectFolder: string = ".",
  env: string = DEFAULT_ENV,
  options: BuildOptions = {},
): Promise<void> {
  return buildProject(projectFolder, env, options);
}

export default launch;
