import chalk from 'chalk';
import { Command, Option } from 'commander';
import path from 'path';
import { LoadedConfig, ConfigLoader } from '../../../../config';
import { NodeFileSystem } from '../../../../filesystem';
import { Options, readConfig, readUserConfig, displayNonDefaultGitWarning } from '../../../common';
import { ModuleCache } from '../../../../module-cache';
import { DownloaderRegistry } from '../../../../downloaders/registry';
import { registerLocalDownloader } from '../../../../downloaders/local';
import { registerLocalFolderDownloader } from '../../../../downloaders/local-folder';
import { registerPackageDownloader } from '../../../../downloaders/package';
import { registerGitDownloader } from '../../../../downloaders/git';
import { ModuleManifest } from '../../../../module-manifest';
import { ExecuteCMD } from '../../../command';
import inquirer from 'inquirer';
import { loadInterfaceFromGit } from '../../../git-operations';
import { projectModulesAddCommand } from './add';
import { error, warning, info, success } from '../../../cli-ui';
import { terminalDisplay } from '../../../terminal-display';

interface InstallOptions {
  project: string;
  env?: string;
  git?: string;
}

interface ConfigAnalyze {
  unresolvedImports: string[];
}

// Interface for tracking modules to be installed
interface ModuleToInstall {
  loaderIdentifier: string;
  mode: string;
  moduleName: string;
  imports: string[];
  env: string;
}

async function analyzeConfig(
  projectFolder: string,
  cache: ModuleCache,
  config: LoadedConfig,
  registry: DownloaderRegistry,
  fs: NodeFileSystem,
): Promise<ConfigAnalyze> {
  const modules = (
    await Promise.all(
      Object.entries(config.modules)
        .map(([name, module]) =>
          registry.load(projectFolder, cache, { ...module.source, id: name } as any).catch((err) => {
            throw new Error(`Error loading module ${JSON.stringify(module.source)}: ${err}`);
          }),
        ),
    )
  ).flat();

  // Add core module
  try {
    const coreRoot = path.resolve(__dirname, '../../../../../..');
    const coreManifest = await ModuleManifest.create(
      coreRoot,
      { type: 'local', path: coreRoot, id: 'antelopejs' } as any,
      'antelopejs',
      fs,
    );
    modules.push(coreManifest);
  } catch {
    // Ignore failures when running outside the package workspace
  }

  // Load all exports from modules
  await Promise.all(modules.map((module) => module.loadExports()));

  // Get unique imports across all modules
  const imports = [...new Set(modules.map((module) => module.imports).flat())];

  // Find imports that don't have a corresponding export
  const unresolvedImports = imports.filter((imp) => !modules.find((module) => module.exports[imp]));

  return { unresolvedImports };
}

export default function () {
  return new Command('install')
    .description(
      `Install module dependencies in your project\n` + `Identifies and resolves missing module dependencies`,
    )
    .addOption(Options.project)
    .addOption(Options.git)
    .addOption(new Option('-e, --env <environment>', 'Environment to analyze').env('ANTELOPEJS_LAUNCH_ENV'))
    .action(async (options: InstallOptions) => {
      info(chalk.blue`Analyzing project dependencies...`);

      const baseConfig = await readConfig(options.project);
      if (!baseConfig) {
        error(chalk.red`No project configuration found at: ${options.project}`);
        info(`Make sure you're in an AntelopeJS project or use the --project option.`);
        process.exitCode = 1;
        return;
      }

      const userConfig = await readUserConfig();
      const git = options.git || userConfig.git;

      // Display warning if using non-default git repository
      await displayNonDefaultGitWarning(git);

      const fs = new NodeFileSystem();
      const loader = new ConfigLoader(fs);

      const registry = new DownloaderRegistry();
      registerLocalDownloader(registry, { fs, exec: ExecuteCMD });
      registerLocalFolderDownloader(registry, { fs });
      registerPackageDownloader(registry, { fs, exec: ExecuteCMD });
      registerGitDownloader(registry, { fs, exec: ExecuteCMD });

      // Initialize the module cache
      const cacheFolder = baseConfig.cacheFolder ?? '.antelope/cache';
      const cachePath = path.isAbsolute(cacheFolder) ? cacheFolder : path.join(options.project, cacheFolder);
      const cache = new ModuleCache(cachePath);
      await cache.load();

      // Determine which environments to analyze
      const envs = options.env
        ? [options.env]
        : baseConfig?.environments
          ? Object.keys(baseConfig.environments)
          : ['default'];

      // Track changes made
      const addedModules: Record<string, string[]> = {};
      const removedModules: string[] = [];

      // Collect all modules to install across all environments
      const modulesToInstall: ModuleToInstall[] = [];

      // First pass: Analyze all environments and collect user selections
      for (const env of envs) {
        info(chalk.bold`Analyzing environment: ${env}`);
        await terminalDisplay.startSpinner(`Analyzing environment: ${env}`);

        const config = await loader.load(options.project, env);
        let unresolvedImports: string[] = [];
        try {
          ({ unresolvedImports } = await analyzeConfig(options.project, cache, config, registry, fs));
        } catch (err) {
          await terminalDisplay.failSpinner(`Error analyzing config: ${err}`);
          await new Promise((resolve) => setTimeout(resolve, 10));
          process.exit(1);
        }
        await terminalDisplay.stopSpinner(`Analyzed environment: ${env}`);
        // Handle unresolved imports
        if (unresolvedImports.length > 0) {
          warning(chalk.yellow`Found ${unresolvedImports.length} unresolved imports:`);

          for (const imp of unresolvedImports) {
            const m = imp.match(/^([^@]+)(?:@(.+))?$/);
            if (!m || !m[1] || !m[2]) {
              warning(`    ${chalk.yellow('↳')} Malformed interface name, skipping`);
              continue;
            }

            // Look for modules implementing this interface
            const interfaceInfo = await loadInterfaceFromGit(git, m[1]);

            // Prepare choice for user to select a module
            const choices = [...(interfaceInfo?.manifest.modules.map((module) => module.name) || [])];
            const alreadySelectedModule = modulesToInstall.find((module) => choices.includes(module.moduleName));

            if (interfaceInfo && choices.length > 0 && !alreadySelectedModule) {
              info(`  ${chalk.yellow('•')} ${chalk.bold(imp)}`);

              // Suggest modules that implement this interface
              info(`    ${chalk.blue('↳')} Available modules that implement this interface:`);
              interfaceInfo.manifest.modules.forEach((mod, i) => {
                info(`      ${i + 1}. ${chalk.bold(mod.name)}`);
              });

              // Ask user to select a module
              const { moduleName } = await inquirer.prompt<{ moduleName: string }>([
                {
                  type: 'list',
                  name: 'moduleName',
                  message: `Select a module to add for ${imp}:`,
                  choices,
                },
              ]);

              // Find the selected module
              const moduleInterfaceInfo = interfaceInfo.manifest.modules.find((module) => module.name === moduleName);

              if (moduleInterfaceInfo) {
                const source = moduleInterfaceInfo.source;
                const mode = source.type;
                const loaderIdentifier = registry.getLoaderIdentifier(source as any);

                if (loaderIdentifier) {
                  success(`    ${chalk.green('↳')} Selected module: ${chalk.bold(moduleName)} for ${imp}`);

                  // Add to modules to install
                  modulesToInstall.push({
                    loaderIdentifier,
                    mode,
                    moduleName,
                    imports: [imp],
                    env,
                  });

                  addedModules[moduleName] = [imp];
                }
              } else {
                warning(`    ${chalk.yellow('↳')} No modules found implementing this interface in repository ${git}`);
              }
            } else if (alreadySelectedModule) {
              // Module already selected for another import, just track the import
              alreadySelectedModule.imports.push(imp);
              addedModules[alreadySelectedModule.moduleName].push(imp);
            } else {
              warning(`    ${chalk.yellow('↳')} No modules found implementing this interface in repository ${git}`);
            }
          }
        } else {
          success(chalk.green`No unresolved imports found`);
        }
      }

      // Second pass: Install all selected modules sequentially by environment
      if (modulesToInstall.length > 0) {
        await terminalDisplay.startSpinner(`Installing selected modules`);
        info(chalk.blue.bold`Installing selected modules...`);

        // Group modules by environment and mode for installation
        const modulesByEnvAndMode = modulesToInstall.reduce(
          (acc, module) => {
            const key = `${module.env}:${module.mode}`;
            if (!acc[key]) {
              acc[key] = [];
            }
            acc[key].push(module);
            return acc;
          },
          {} as Record<string, ModuleToInstall[]>,
        );

        // Install modules for each environment/mode combination sequentially
        for (const [key, modules] of Object.entries(modulesByEnvAndMode)) {
          const [env, mode] = key.split(':');
          const loaderIdentifiers = modules.map((m) => m.loaderIdentifier);

          info(
            chalk.blue`Installing ${modules.length} module${modules.length === 1 ? '' : 's'} for environment ${env} (mode: ${mode})...`,
          );

          try {
            await projectModulesAddCommand(loaderIdentifiers, {
              mode,
              project: options.project,
              env,
            });

            success(chalk.green`Successfully installed modules for environment ${env} (mode: ${mode})`);
          } catch (err) {
            error(chalk.red`Failed to install modules for environment ${env} (mode: ${mode}): ${err}`);
          }
        }
        await terminalDisplay.stopSpinner(
          `Installed ${modulesToInstall.length} module${modulesToInstall.length === 1 ? '' : 's'}`,
        );
      }

      // Summary of changes
      info(chalk.blue.bold`Dependency analysis summary:`);

      if (Object.keys(addedModules).length > 0) {
        success(chalk.green`Added ${Object.keys(addedModules).length} module(s):`);
        Object.entries(addedModules).forEach(([moduleName, imports]) => {
          info(`  ${chalk.green('•')} ${moduleName} for: ${imports.join(', ')}`);
        });
      }

      if (removedModules.length > 0) {
        success(chalk.green`Removed ${removedModules.length} module(s):`);
        removedModules.forEach((name) => {
          info(`  ${chalk.green('•')} ${name}`);
        });
      }

      if (Object.keys(addedModules).length === 0 && removedModules.length === 0) {
        success(chalk.green`No changes were made. Your project dependencies are already optimized!`);
      }

      info(chalk.blue`Dependency analysis complete!`);
    });
}
