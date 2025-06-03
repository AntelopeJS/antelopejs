import chalk from 'chalk';
import { Command, Option } from 'commander';
import { AntelopeProjectEnvConfigStrict, LoadConfig } from '../../../common/config';
import { Options, readConfig, readUserConfig, displayNonDefaultGitWarning } from '../../common';
import { ModuleCache } from '../../../common/cache';
import LoadModule, { GetLoaderIdentifier } from '../../../common/downloader';
import path from 'path';
import { ModuleManifest } from '../../../common/manifest';
import inquirer from 'inquirer';
import { loadInterfaceFromGit } from '../../git';
import { projectModulesAddCommand } from './add';
import { error, warning, info, success } from '../../../utils/cli-ui';
import { parseInterfaceRef } from '../../../utils/module';

interface FixOptions {
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
  config: AntelopeProjectEnvConfigStrict,
): Promise<ConfigAnalyze> {
  const modules = (
    await Promise.all(
      Object.values(config.modules)
        .filter((module) => 'source' in module)
        .map((module) =>
          LoadModule(projectFolder, cache, module.source).catch((err) => {
            error(chalk.red`Error loading module: ${err}`);
            return [];
          }),
        ),
    )
  ).flat();

  // Add core module
  modules.push(new ModuleManifest(path.resolve(path.join(__dirname, '..', '..', '..', '..')), { type: 'none' }));

  // Load all exports from modules
  await Promise.all(modules.map((module) => module.loadExports()));

  // Get unique imports across all modules
  const imports = [...new Set(modules.map((module) => module.imports).flat())];

  // Find imports that don't have a corresponding export
  const unresolvedImports = imports.filter((imp) => !modules.find((module) => module.exports[imp]));

  return { unresolvedImports };
}

export default function () {
  return new Command('fix')
    .description(
      `Fix module dependencies in your project\n` + `Identifies and resolves missing or unused module dependencies`,
    )
    .addOption(Options.project)
    .addOption(Options.git)
    .addOption(new Option('-e, --env <environment>', 'Environment to analyze').env('ANTELOPEJS_LAUNCH_ENV'))
    .action(async (options: FixOptions) => {
      info(chalk.blue`Analyzing project dependencies...`);

      const baseConfig = await readConfig(options.project);
      if (!baseConfig) {
        error(chalk.red`No project configuration found at: ${options.project}`);
        info(`Make sure you're in an AntelopeJS project or use the --project option.`);
        return;
      }

      const userConfig = await readUserConfig();
      const git = options.git || userConfig.git;

      // Display warning if using non-default git repository
      await displayNonDefaultGitWarning(git);

      // Initialize the module cache
      const cache = new ModuleCache(path.join(options.project, baseConfig?.cacheFolder || '.antelope/cache'));
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
        info(chalk.bold`\nAnalyzing environment: ${env}`);

        const config = await LoadConfig(options.project, env);
        const { unresolvedImports } = await analyzeConfig(options.project, cache, config);

        // Handle unresolved imports
        if (unresolvedImports.length > 0) {
          warning(chalk.yellow`Found ${unresolvedImports.length} unresolved imports:`);

          for (const imp of unresolvedImports) {
            const ref = parseInterfaceRef(imp);
            if (!ref?.name || !ref.version) {
              warning(`    ${chalk.yellow('↳')} Malformed interface name, skipping`);
              continue;
            }

            // Look for modules implementing this interface
            const interfaceInfo = await loadInterfaceFromGit(git, ref.name);

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
                const loaderIdentifier = GetLoaderIdentifier(source);

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
          success(chalk.green`✓ No unresolved imports found`);
        }
      }

      // Second pass: Install all selected modules sequentially by environment
      if (modulesToInstall.length > 0) {
        info(chalk.blue.bold`\nInstalling selected modules...`);

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

          info(chalk.blue`Installing ${modules.length} module(s) for environment ${env} (mode: ${mode})...`);

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
      }

      // Summary of changes
      info(chalk.blue.bold`\nDependency analysis summary:`);

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

      info(chalk.blue`\nDependency analysis complete!`);
    });
}
