import type { LaunchOptions } from "../../types";
import { DEFAULT_ENV } from "../config";
import type { ModuleManager } from "../modules";
import { prepareFromConfig } from "../runtime";
import { startProject } from "./project-launch";

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
