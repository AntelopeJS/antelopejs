import assert from "node:assert";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { AntelopeModuleConfig } from "@antelopejs/interface-core/config";
import chalk from "chalk";
import { Command, Option } from "commander";
import { ConfigLoader } from "../../../../config";
import { registerGitDownloader } from "../../../../downloaders/git";
import { registerLocalDownloader } from "../../../../downloaders/local";
import { registerLocalFolderDownloader } from "../../../../downloaders/local-folder";
import { registerPackageDownloader } from "../../../../downloaders/package";
import { DownloaderRegistry } from "../../../../downloaders/registry";
import { NodeFileSystem } from "../../../../filesystem";
import { ModuleCache } from "../../../../module-cache";
import type { ModulePackageJson } from "../../../../module-manifest";
import {
  fetchLatestVersion,
  toFloatingSpec,
  validateVersionSpec,
} from "../../../../version-checker";
import { displayBox, error, info, success, warning } from "../../../cli-ui";
import { ExecuteCMD } from "../../../command";
import { Options, readConfig, writeConfig } from "../../../common";

const LOCAL_MODULE_WATCH_DIRS = ["src"];
const LOCAL_MODULE_BUILD_COMMAND = ["npx tsc"];

interface AddOptions {
  mode: string;
  project: string;
  env?: string;
  ignoreCache?: boolean;
}

export const handlers = new Map<
  string,
  (
    module: string,
    options: AddOptions,
  ) => Promise<[string, AntelopeModuleConfig | string]>
>();

interface ModuleLoadResult {
  moduleName: string;
  moduleConfig: AntelopeModuleConfig | string;
  skipped: boolean;
  failed: boolean;
}

export interface AddCommandResult {
  added: string[];
  skipped: string[];
  failed: string[];
}

async function downloadModuleToCache(
  registry: DownloaderRegistry,
  cache: ModuleCache,
  projectPath: string,
  moduleName: string,
  moduleConfig: AntelopeModuleConfig,
): Promise<boolean> {
  const loaderIdentifier = registry.getLoaderIdentifier(
    moduleConfig.source as any,
  );
  if (!loaderIdentifier) {
    return true;
  }
  info(`Downloading module ${chalk.bold(moduleName)} to cache...`);
  try {
    const moduleManifests = await registry.load(projectPath, cache, {
      ...moduleConfig.source,
      id: moduleName,
    } as any);
    if (moduleManifests.length > 0) {
      const manifest = moduleManifests[0];
      if (manifest.manifest.antelopeJs?.defaultConfig) {
        moduleConfig.config = manifest.manifest.antelopeJs.defaultConfig;
      }
    }
    success(
      `Successfully downloaded module ${chalk.bold(moduleName)} to cache`,
    );
    return true;
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error(
      `Failed to download module ${chalk.bold(moduleName)}: ${errorMessage}`,
    );
    return false;
  }
}

async function displayAddResults(
  added: string[],
  skipped: string[],
  failed: string[],
): Promise<void> {
  let resultContent = "";

  if (added.length > 0) {
    resultContent += `${chalk.green.bold("Successfully added:")}\n`;
    added.forEach((name) => {
      resultContent += `  • ${chalk.bold(name)}\n`;
    });
  }

  if (skipped.length > 0) {
    if (resultContent) resultContent += "\n";
    resultContent += `${chalk.yellow.bold("Skipped:")}\n`;
    skipped.forEach((name) => {
      resultContent += `  • ${chalk.dim(name)}\n`;
    });
  }

  if (failed.length > 0) {
    if (resultContent) resultContent += "\n";
    resultContent += `${chalk.red.bold("Failed:")}\n`;
    failed.forEach((name) => {
      resultContent += `  • ${chalk.bold(name)}\n`;
    });
  }

  if (resultContent) {
    const borderColor =
      added.length > 0 ? "green" : failed.length > 0 ? "red" : "yellow";
    await displayBox(resultContent, "📦 Module Addition Results", {
      padding: 1,
      borderColor,
    });
  }
}

export async function projectModulesAddCommand(
  modules: string[],
  options: AddOptions,
): Promise<AddCommandResult | undefined> {
  console.log(""); // Add spacing for better readability
  info(`Adding modules to your project...`);

  const resolvedProjectPath = path.resolve(options.project);
  const envLabel = options.env || "default";

  // Get project config
  const config = await readConfig(resolvedProjectPath);
  if (!config) {
    error(
      `No project configuration found at: ${chalk.bold(resolvedProjectPath)}`,
    );
    warning(
      `Make sure you're in an AntelopeJS project or use the --project option.`,
    );
    process.exitCode = 1;
    return;
  }

  const fs = new NodeFileSystem();
  const loader = new ConfigLoader(fs);
  const antelopeConfig = await loader.load(resolvedProjectPath, envLabel);

  const registry = new DownloaderRegistry();
  registerLocalDownloader(registry, { fs, exec: ExecuteCMD });
  registerLocalFolderDownloader(registry, { fs });
  registerPackageDownloader(registry, { fs, exec: ExecuteCMD });
  registerGitDownloader(registry, { fs, exec: ExecuteCMD });

  const failed: string[] = [];

  let sources = await Promise.all(
    modules.map((module) => {
      const modulePath =
        options.mode === "local" || options.mode === "dir"
          ? path.isAbsolute(module)
            ? module
            : path.join(resolvedProjectPath, module)
          : module;
      info(`Adding ${chalk.bold(modulePath)} using ${options.mode} mode`);
      return handlers
        .get(options.mode)?.(module, {
          ...options,
          project: resolvedProjectPath,
        })
        .catch((err) => {
          error(
            err instanceof Error
              ? err
              : `Failed to add module "${module}": ${String(err)}`,
          );
          failed.push(module);
          return null;
        });
    }),
  );

  // Filter out failed handlers
  sources = sources.filter(
    (source): source is [string, AntelopeModuleConfig] => source !== null,
  );

  // Get correct environment config
  const env =
    options.env && options.env !== "default"
      ? config?.environments?.[options.env]
      : config;
  if (!env) {
    error(`Environment ${envLabel} not found in project config`);
    process.exitCode = 1;
    return;
  }

  if (!env.modules) {
    env.modules = {};
  }

  // Track successful additions
  const added: string[] = [];
  const skipped: string[] = [];

  // Initialize module cache
  const cacheFolder = config.cacheFolder ?? ".antelope/cache";
  const cachePath = path.isAbsolute(cacheFolder)
    ? cacheFolder
    : path.join(resolvedProjectPath, cacheFolder);
  const cache = new ModuleCache(cachePath);
  await cache.load();

  // Prepare module loading tasks for parallel execution
  const moduleLoadingTasks = sources.map(
    async (source): Promise<ModuleLoadResult | null> => {
      if (!source) return null;

      const [moduleName, moduleConfig] = source;

      // Check if module already exists
      if (antelopeConfig.modules[moduleName]) {
        return { moduleName, moduleConfig, skipped: true, failed: false };
      }

      // Download module to cache if needed
      const downloadable =
        typeof moduleConfig === "object" &&
        moduleConfig !== null &&
        "source" in moduleConfig;
      const downloaded = downloadable
        ? await downloadModuleToCache(
            registry,
            cache,
            resolvedProjectPath,
            moduleName,
            moduleConfig,
          )
        : true;

      return { moduleName, moduleConfig, skipped: false, failed: !downloaded };
    },
  );

  // Execute all module loading tasks in parallel
  const moduleResults = await Promise.all(moduleLoadingTasks);

  // Process results and update config
  for (const result of moduleResults) {
    if (!result) continue;

    const {
      moduleName,
      moduleConfig,
      skipped: wasSkipped,
      failed: hasFailed,
    } = result;

    if (hasFailed) {
      failed.push(moduleName);
    } else if (wasSkipped) {
      skipped.push(moduleName);
    } else {
      env.modules[moduleName] = moduleConfig;
      added.push(moduleName);
    }
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }

  // Save the updated config
  if (added.length > 0) {
    await writeConfig(resolvedProjectPath, config);
  }

  // Show results
  await displayAddResults(added, skipped, failed);

  return { added, skipped, failed };
}

export default function () {
  return new Command("add")
    .description(
      `Add modules to your project\n` +
        `Import modules from npm, git, or local directories.`,
    )
    .argument("<modules...>", "Modules to add (format depends on --mode)")
    .addOption(
      new Option("-m, --mode <mode>", "Source type for the modules")
        .choices([...handlers.keys()])
        .default("package"),
    )
    .addOption(Options.project)
    .addOption(
      new Option(
        "-e, --env <environment>",
        "Environment to add modules to",
      ).env("ANTELOPEJS_LAUNCH_ENV"),
    )
    .action(async (modules: string[], options: AddOptions) => {
      await projectModulesAddCommand(modules, options);
    });
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
