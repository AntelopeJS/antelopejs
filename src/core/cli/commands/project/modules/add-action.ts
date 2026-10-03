import chalk from "chalk";
import path from "node:path";
import assert from "node:assert";
import { readFile, stat } from "node:fs/promises";
import type {
  AntelopeConfig,
  AntelopeModuleConfig,
} from "@antelopejs/interface-core/config";

import { ExecuteCMD } from "../../../command";
import { ConfigLoader } from "../../../../config";
import { ModuleCache } from "../../../../module-cache";
import { NodeFileSystem } from "../../../../filesystem";
import { writeConfig } from "../../../common";
import { FAILURE_EXIT_CODE } from "../../../exit-codes";
import { registerGitDownloader } from "../../../../downloaders/git";
import type { ModulePackageJson } from "../../../../module-manifest";
import { DownloaderRegistry } from "../../../../downloaders/registry";
import { registerLocalDownloader } from "../../../../downloaders/local";
import { registerPackageDownloader } from "../../../../downloaders/package";
import {
  CliError,
  getProcessTasks,
  getProcessUi,
  pluralize,
  reportFailure,
  type NextStep,
  type TaskHandle,
} from "../../../output";
import { TS_CONFIG_FILE } from "../../../../config/config-paths";
import { scopedCommand } from "../../shared/next-steps";
import { resolveProjectContext } from "../../shared/project-command";
import { registerLocalFolderDownloader } from "../../../../downloaders/local-folder";
import {
  fetchLatestVersion,
  toFloatingSpec,
  validateVersionSpec,
} from "../../../../version-checker";

const LOCAL_MODULE_WATCH_DIRS = ["src"];
const LOCAL_MODULE_BUILD_COMMAND = ["npx tsc"];
const DEFAULT_CACHE_FOLDER = ".antelope/cache";
const INSTALL_COMMAND = "ajs project modules install";
const INSTALL_DESCRIPTION = "resolve the interfaces they need";

interface AddOptions {
  mode: string;
  project: string;
  env?: string;
  ignoreCache?: boolean;
}

type ModuleEntry = [string, AntelopeModuleConfig | string];

export const handlers = new Map<
  string,
  (module: string, options: AddOptions) => Promise<ModuleEntry>
>();

export interface AddCommandResult {
  added: string[];
  skipped: string[];
  failed: string[];
}

type AddStatus = keyof AddCommandResult;

interface ModuleAddOutcome {
  status: AddStatus;
  moduleName: string;
  moduleConfig?: AntelopeModuleConfig | string;
}

interface AddContext {
  options: AddOptions;
  registry: DownloaderRegistry;
  cache: ModuleCache;
  existingModules: Record<string, unknown>;
}

interface SourceReference {
  version?: string;
  remote?: string;
  path?: string;
}

function sourceReference(moduleConfig: AntelopeModuleConfig | string): string {
  if (typeof moduleConfig === "string") {
    return moduleConfig;
  }
  const source = moduleConfig.source as SourceReference;
  return source.version ?? source.remote ?? source.path ?? "";
}

function createRegistry(): DownloaderRegistry {
  const fs = new NodeFileSystem();
  const registry = new DownloaderRegistry();
  registerLocalDownloader(registry, { fs, exec: ExecuteCMD });
  registerLocalFolderDownloader(registry, { fs });
  registerPackageDownloader(registry, { fs, exec: ExecuteCMD });
  registerGitDownloader(registry, { fs, exec: ExecuteCMD });
  return registry;
}

async function createAddContext(
  options: AddOptions,
  config: AntelopeConfig,
  environment: string,
): Promise<AddContext> {
  const loader = new ConfigLoader(new NodeFileSystem());
  const antelopeConfig = await loader.load(options.project, environment);
  const cacheFolder = config.cacheFolder ?? DEFAULT_CACHE_FOLDER;
  const cache = new ModuleCache(path.resolve(options.project, cacheFolder));
  await cache.load();
  return {
    options,
    registry: createRegistry(),
    cache,
    existingModules: antelopeConfig.modules,
  };
}

function resolveModule(module: string, options: AddOptions) {
  const handler = handlers.get(options.mode);
  if (!handler) {
    throw new CliError({ title: `Unknown module source '${options.mode}'` });
  }
  return handler(module, options);
}

async function downloadModule(
  context: AddContext,
  moduleName: string,
  moduleConfig: AntelopeModuleConfig | string,
): Promise<void> {
  if (typeof moduleConfig !== "object" || !("source" in moduleConfig)) {
    return;
  }
  const source = moduleConfig.source as any;
  if (!context.registry.getLoaderIdentifier(source)) {
    return;
  }
  const [manifest] = await context.registry.load(
    context.options.project,
    context.cache,
    { ...source, id: moduleName },
  );
  const defaultConfig = manifest?.manifest.antelopeJs?.defaultConfig;
  if (defaultConfig) {
    moduleConfig.config = defaultConfig;
  }
}

async function addResolvedModule(
  context: AddContext,
  [moduleName, moduleConfig]: ModuleEntry,
  task: TaskHandle,
): Promise<ModuleAddOutcome> {
  const name = chalk.bold(moduleName);
  if (context.existingModules[moduleName]) {
    task.skip(`Skipped ${name}: already in the project`);
    return { status: "skipped", moduleName };
  }
  task.update(`Downloading ${name}`);
  await downloadModule(context, moduleName, moduleConfig);
  task.succeed(`Added ${name} ${chalk.dim(sourceReference(moduleConfig))}`);
  return { status: "added", moduleName, moduleConfig };
}

/**
 * Adds one module as one task: resolve, skip when already present,
 * download. A failure is reported once, with what / why / fix.
 */
async function addModule(
  module: string,
  context: AddContext,
): Promise<ModuleAddOutcome> {
  const task = getProcessTasks().start(`Adding ${chalk.bold(module)}`);
  let moduleName = module;
  try {
    const entry = await resolveModule(module, context.options);
    moduleName = entry[0];
    return await addResolvedModule(context, entry, task);
  } catch (err: unknown) {
    task.dismiss();
    reportFailure(err);
    return { status: "failed", moduleName };
  }
}

function groupOutcomes(outcomes: ModuleAddOutcome[]): AddCommandResult {
  const result: AddCommandResult = { added: [], skipped: [], failed: [] };
  outcomes.forEach((outcome) =>
    result[outcome.status].push(outcome.moduleName),
  );
  return result;
}

/**
 * Adds modules to the project configuration, one line per module, and
 * writes the configuration when at least one was added. Prints no summary,
 * so other commands can add modules as one of their steps.
 */
export async function addModules(
  modules: string[],
  options: AddOptions,
): Promise<AddCommandResult> {
  const addOptions = { ...options, project: path.resolve(options.project) };
  const { config, environment, environmentConfig } =
    await resolveProjectContext(addOptions.project, options.env);
  const context = await createAddContext(addOptions, config, environment);
  const outcomes = await Promise.all(
    modules.map((module) => addModule(module, context)),
  );
  const envModules = (environmentConfig.modules ??= {});
  outcomes
    .filter((outcome) => outcome.status === "added")
    .forEach((outcome) => {
      envModules[outcome.moduleName] = outcome.moduleConfig!;
    });
  const result = groupOutcomes(outcomes);
  if (result.failed.length > 0) {
    process.exitCode = FAILURE_EXIT_CODE;
  }
  if (result.added.length > 0) {
    await writeConfig(addOptions.project, config);
  }
  return result;
}

function addHeadline(result: AddCommandResult): string {
  const { added, skipped, failed } = result;
  if (skipped.length === 0 && failed.length === 0) {
    return `${pluralize(added.length, "module")} added to ${TS_CONFIG_FILE}`;
  }
  const counts = Object.entries(result)
    .filter(([, names]) => names.length > 0)
    .map(([status, names]) => `${names.length} ${status}`)
    .join(", ");
  const change = added.length > 0 ? "updated" : "unchanged";
  return `${counts} · ${TS_CONFIG_FILE} ${change}`;
}

function addNextSteps(
  result: AddCommandResult,
  options: AddOptions,
): NextStep[] {
  if (result.added.length === 0) {
    return [];
  }
  return [
    {
      command: scopedCommand(INSTALL_COMMAND, options),
      description: INSTALL_DESCRIPTION,
    },
  ];
}

export async function projectModulesAddCommand(
  modules: string[],
  options: AddOptions,
): Promise<AddCommandResult | undefined> {
  const startedAt = Date.now();
  const result = await addModules(modules, options);
  getProcessUi().summary({
    headline: addHeadline(result),
    durationMs: Date.now() - startedAt,
    nextSteps: addNextSteps(result, options),
  });
  return result;
}

// Module source handlers

handlers.set("package", async (module) => {
  const m = module.match(/^(.+?)(?:@(.*))?$/);
  assert(
    m,
    `Invalid npm module format: '${module}'. Use <name>@<version>, <name>version or <name>`,
  );
  const [, name, version] = m;
  if (version) {
    await validateVersionSpec(name, version);
  }
  const resolvedVersion = version
    ? version
    : toFloatingSpec(await fetchLatestVersion(name));
  return [
    name,
    {
      source: {
        type: "package",
        package: name,
        version: resolvedVersion,
      },
    },
  ];
});

handlers.set("git", async (module) => {
  // Validate git URL format
  assert(
    module.includes("://") || module.includes("@"),
    `Invalid git URL format: '${module}'`,
  );
  return [
    path.basename(module, ".git"),
    {
      source: {
        type: "git",
        remote: module,
      },
    },
  ];
});

handlers.set("local", async (module, options) => {
  const resolvedModulePath = path.isAbsolute(module)
    ? path.resolve(module)
    : path.resolve(path.join(options.project, module));

  assert(
    (await stat(resolvedModulePath)).isDirectory(),
    `Path '${module}' is not a directory`,
  );
  const packagePath = path.join(resolvedModulePath, "package.json");
  assert(
    (await stat(packagePath)).isFile(),
    `No package.json found in '${module}'`,
  );

  const info = JSON.parse(
    (await readFile(packagePath)).toString(),
  ) as ModulePackageJson;

  return [
    info.name,
    {
      source: {
        type: "local",
        path: path.relative(options.project, resolvedModulePath) || ".",
        watchDir: LOCAL_MODULE_WATCH_DIRS,
        installCommand: LOCAL_MODULE_BUILD_COMMAND,
        reloadCommand: LOCAL_MODULE_BUILD_COMMAND,
      },
    },
  ];
});

handlers.set("dir", async (module, options) => {
  const resolvedFolderPath = path.isAbsolute(module)
    ? path.resolve(module)
    : path.resolve(path.join(options.project, module));
  assert(
    (await stat(resolvedFolderPath)).isDirectory(),
    `Path '${module}' is not a directory`,
  );
  return [
    `:${resolvedFolderPath}`,
    {
      source: {
        type: "local-folder",
        path: path.relative(options.project, resolvedFolderPath) || ".",
        watchDir: LOCAL_MODULE_WATCH_DIRS,
        installCommand: LOCAL_MODULE_BUILD_COMMAND,
        reloadCommand: LOCAL_MODULE_BUILD_COMMAND,
      },
    },
  ];
});
