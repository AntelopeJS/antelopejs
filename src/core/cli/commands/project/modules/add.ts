import chalk from 'chalk';
import assert from 'assert';
import { Command, Option } from 'commander';
import { readFile, stat } from 'fs/promises';
import path from 'path';
import { AntelopeModuleConfig } from '../../../../../types';
import { ConfigLoader } from '../../../../config';
import { NodeFileSystem } from '../../../../filesystem';
import { Options, readConfig, writeConfig } from '../../../common';
import { ExecuteCMD } from '../../../command';
import { displayBox, error, info, success, warning } from '../../../cli-ui';
import { ModulePackageJson } from '../../../../module-manifest';
import { parsePackageInfoOutput } from '../../../package-manager';
import { ModuleCache } from '../../../../module-cache';
import { DownloaderRegistry } from '../../../../downloaders/registry';
import { registerLocalDownloader } from '../../../../downloaders/local';
import { registerLocalFolderDownloader } from '../../../../downloaders/local-folder';
import { registerPackageDownloader } from '../../../../downloaders/package';
import { registerGitDownloader } from '../../../../downloaders/git';

interface AddOptions {
  mode: string;
  project: string;
  env?: string;
  ignoreCache?: boolean;
}

export const handlers = new Map<
  string,
  (module: string, options: AddOptions) => Promise<[string, AntelopeModuleConfig | string]>
>();

export async function projectModulesAddCommand(modules: string[], options: AddOptions) {
  console.log(''); // Add spacing for better readability
  info(`Adding modules to your project...`);

  const resolvedProjectPath = path.resolve(options.project);
  const envLabel = options.env || 'default';

  // Get project config
  const config = await readConfig(resolvedProjectPath);
  if (!config) {
    error(`No project configuration found at: ${chalk.bold(resolvedProjectPath)}`);
    warning(`Make sure you're in an AntelopeJS project or use the --project option.`);
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

  let sources = await Promise.all(
    modules.map((module) => {
      const modulePath =
        options.mode === 'local' || options.mode === 'dir'
          ? path.isAbsolute(module)
            ? module
            : path.join(resolvedProjectPath, module)
          : module;
      info(`Adding ${chalk.bold(modulePath)} using ${options.mode} mode`);
      return handlers.get(options.mode)!(module, { ...options, project: resolvedProjectPath }).catch((err) => {
        error(`Failed to add module "${module}": ${err.message || err}`);
        return null;
      });
    }),
  );

  // Filter out failed handlers
  sources = sources.filter((source): source is [string, AntelopeModuleConfig] => source !== null);

  // Get correct environment config
  const env =
    options.env && options.env !== 'default' ? config?.environments && config?.environments[options.env] : config;
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
  const cacheFolder = config.cacheFolder ?? '.antelope/cache';
  const cachePath = path.isAbsolute(cacheFolder) ? cacheFolder : path.join(resolvedProjectPath, cacheFolder);
  const cache = new ModuleCache(cachePath);
  await cache.load();

  // Prepare module loading tasks for parallel execution
  const moduleLoadingTasks = sources.map(async (source) => {
    if (!source) return null;

    let [moduleName, moduleConfig] = source;

    // Check if module already exists
    if (antelopeConfig.modules[moduleName]) {
      return { moduleName, moduleConfig, skipped: true };
    }

    // Download module to cache if needed
    if (typeof moduleConfig === 'object' && moduleConfig !== null && 'source' in moduleConfig) {
      const loaderIdentifier = registry.getLoaderIdentifier(moduleConfig.source as any);
      if (loaderIdentifier) {
        info(`Downloading module ${chalk.bold(moduleName)} to cache...`);
        try {
          const moduleManifests = await registry.load(resolvedProjectPath, cache, {
            ...moduleConfig.source,
            id: moduleName,
          } as any);
          if (moduleManifests.length > 0) {
            const manifest = moduleManifests[0];
            if (manifest.manifest.antelopeJs?.defaultConfig) {
              moduleConfig.config = manifest.manifest.antelopeJs.defaultConfig;
            }
          }
          success(`Successfully downloaded module ${chalk.bold(moduleName)} to cache`);
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          warning(`Failed to download module ${chalk.bold(moduleName)} to cache: ${errorMessage}`);
        }
      }
    }

    return { moduleName, moduleConfig, skipped: false };
  });

  // Execute all module loading tasks in parallel
  const moduleResults = await Promise.all(moduleLoadingTasks);

  // Process results and update config
  for (const result of moduleResults) {
    if (!result) continue;

    const { moduleName, moduleConfig, skipped: wasSkipped } = result;

    if (wasSkipped) {
      skipped.push(moduleName);
    } else {
      env.modules[moduleName] = moduleConfig;
      added.push(moduleName);
    }
  }

  // Save the updated config
  await writeConfig(resolvedProjectPath, config);

  // Show results
  let resultContent = '';

  if (added.length > 0) {
    resultContent += `${chalk.green.bold('Successfully added:')}\n`;
    added.forEach((name) => {
      resultContent += `  • ${chalk.bold(name)}\n`;
    });
  }

  if (skipped.length > 0) {
    if (resultContent) resultContent += '\n';
    resultContent += `${chalk.yellow.bold('Skipped:')}\n`;
    skipped.forEach((name) => {
      resultContent += `  • ${chalk.dim(name)}\n`;
    });
  }

  if (resultContent) {
    await displayBox(resultContent, '📦 Module Addition Results', {
      padding: 1,
      borderColor: added.length > 0 ? 'green' : 'yellow',
    });
  }
}

export default function () {
  return new Command('add')
    .description(`Add modules to your project\n` + `Import modules from npm, git, or local directories.`)
    .argument('<modules...>', 'Modules to add (format depends on --mode)')
    .addOption(
      new Option('-m, --mode <mode>', 'Source type for the modules').choices([...handlers.keys()]).default('package'),
    )
    .addOption(Options.project)
    .addOption(new Option('-e, --env <environment>', 'Environment to add modules to').env('ANTELOPEJS_LAUNCH_ENV'))
    .action(projectModulesAddCommand);
}

// Module source handlers

handlers.set('package', async (module) => {
  const m = module.match(/^(.+?)(?:@(.*))?$/);
  assert(m, `Invalid npm module format: '${module}'. Use <name>@<version>, <name>version or <name>`);
  let [, name, version] = m;
  if (!version) {
    const result = await ExecuteCMD(`npm view ${name} version`, {});
    if (result.code !== 0) {
      throw new Error(`Failed to fetch version: ${result.stderr}`);
    }
    version = parsePackageInfoOutput(result.stdout);
  }
  return [
    name,
    {
      source: {
        type: 'package',
        package: name,
        version: version,
      },
    },
  ];
});

handlers.set('git', async (module) => {
  // Validate git URL format
  assert(module.includes('://') || module.includes('@'), `Invalid git URL format: '${module}'`);
  return [
    path.basename(module, '.git'),
    {
      source: {
        type: 'git',
        remote: module,
      },
    },
  ];
});

handlers.set('local', async (module, options) => {
  const resolvedModulePath = path.isAbsolute(module)
    ? path.resolve(module)
    : path.resolve(path.join(options.project, module));

  assert((await stat(resolvedModulePath)).isDirectory(), `Path '${module}' is not a directory`);
  const packagePath = path.join(resolvedModulePath, 'package.json');
  assert((await stat(packagePath)).isFile(), `No package.json found in '${module}'`);

  const info = JSON.parse((await readFile(packagePath)).toString()) as ModulePackageJson;

  return [
    info.name,
    {
      source: {
        type: 'local',
        path: path.relative(options.project, resolvedModulePath) || '.',
        installCommand: ['npx tsc'],
      },
    },
  ];
});

handlers.set('dir', async (module, options) => {
  const resolvedFolderPath = path.isAbsolute(module)
    ? path.resolve(module)
    : path.resolve(path.join(options.project, module));
  assert((await stat(resolvedFolderPath)).isDirectory(), `Path '${module}' is not a directory`);
  return [
    ':' + resolvedFolderPath,
    {
      source: {
        type: 'local-folder',
        path: path.relative(options.project, resolvedFolderPath) || '.',
        installCommand: ['npx tsc'],
      },
    },
  ];
});
