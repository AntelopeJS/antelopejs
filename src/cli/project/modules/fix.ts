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
import { projectModulesRemoveCommand } from './remove';
import { projectModulesAddCommand } from './add';
import { error, warning, info, success } from '../../../utils/cli-ui';

interface FixOptions {
  project: string;
  env?: string;
  git?: string;
}

interface ConfigAnalyze {
  unresolvedImports: string[];
  unusedModulesExports: ModuleManifest[];
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

  // Find modules that don't export anything used by other modules
  const unusedModulesExports = modules.filter(
    (module) => !Object.keys(module.exports).find((exp) => imports.includes(exp)) && module.source.type !== 'none',
  );

  return { unresolvedImports, unusedModulesExports };
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
      const addedModules: string[] = [];
      const removedModules: string[] = [];

      // Process each environment
      for (const env of envs) {
        info(chalk.bold`\nAnalyzing environment: ${env}`);

        const config = await LoadConfig(options.project, env);
        const { unresolvedImports, unusedModulesExports } = await analyzeConfig(options.project, cache, config);

        // Handle unresolved imports
        if (unresolvedImports.length > 0) {
          warning(chalk.yellow`Found ${unresolvedImports.length} unresolved imports:`);

          for (const imp of unresolvedImports) {
            info(`  ${chalk.yellow('•')} ${chalk.bold(imp)}`);

            const m = imp.match(/^([^@]+)(?:@(.+))?$/);
            if (!m || !m[1] || !m[2]) {
              warning(`    ${chalk.yellow('↳')} Malformed interface name, skipping`);
              continue;
            }

            // Look for modules implementing this interface
            const interfaceInfo = await loadInterfaceFromGit(git, m[1]);

            if (interfaceInfo && interfaceInfo.manifest.modules.length > 0) {
              // Suggest modules that implement this interface
              info(`    ${chalk.blue('↳')} Available modules that implement this interface:`);
              interfaceInfo.manifest.modules.forEach((mod, i) => {
                info(`      ${i + 1}. ${chalk.bold(mod.name)}`);
              });

              // Ask user to select a module
              const choices = [...interfaceInfo.manifest.modules.map((module) => module.name)];

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
                  success(`    ${chalk.green('↳')} Adding module: ${chalk.bold(moduleName)}`);

                  await projectModulesAddCommand([loaderIdentifier], {
                    mode,
                    project: options.project,
                    env,
                  });

                  addedModules.push(`${moduleName} (for ${imp})`);
                }
              } else {
                warning(`    ${chalk.yellow('↳')} No modules found implementing this interface in repository ${git}`);
              }
            } else {
              warning(`    ${chalk.yellow('↳')} No modules found implementing this interface in repository ${git}`);
            }
          }
        } else {
          success(chalk.green`✓ No unresolved imports found`);
        }

        // Handle unused modules
        if (unusedModulesExports.length > 0) {
          warning(chalk.yellow`\nFound ${unusedModulesExports.length} unused modules:`);

          for (const module of unusedModulesExports) {
            info(`  ${chalk.yellow('•')} ${chalk.bold(module.name)}`);

            // Ask user for confirmation
            const { shouldRemove } = await inquirer.prompt<{ shouldRemove: boolean }>([
              {
                type: 'confirm',
                name: 'shouldRemove',
                message: `Remove this unused module? (All exports are unused)`,
                default: false,
              },
            ]);

            if (shouldRemove) {
              try {
                await projectModulesRemoveCommand([module.name], {
                  project: options.project,
                  env,
                  force: true,
                });

                removedModules.push(`${module.name} (environment: ${env})`);
              } catch (err) {
                error(chalk.red`    Failed to remove module: ${err}`);
              }
            } else {
              info(`    ${chalk.dim('↳')} Keeping module`);
            }
          }
        } else {
          success(chalk.green`✓ No unused modules found`);
        }
      }

      // Summary of changes
      info(chalk.blue.bold`\nDependency analysis summary:`);

      if (addedModules.length > 0) {
        success(chalk.green`Added ${addedModules.length} module(s):`);
        addedModules.forEach((name) => {
          info(`  ${chalk.green('•')} ${name}`);
        });
      }

      if (removedModules.length > 0) {
        success(chalk.green`Removed ${removedModules.length} module(s):`);
        removedModules.forEach((name) => {
          info(`  ${chalk.green('•')} ${name}`);
        });
      }

      if (addedModules.length === 0 && removedModules.length === 0) {
        success(chalk.green`No changes were made. Your project dependencies are already optimized!`);
      }

      info(chalk.blue`\nDependency analysis complete!`);
    });
}
