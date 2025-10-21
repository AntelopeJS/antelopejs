import chalk from 'chalk';
import { Command, Option } from 'commander';
import { LoadConfig } from '../../../common/config';
import { Options, readConfig, writeConfig } from '../../common';
import { ExecuteCMD } from '../../../utils/command';
import { ModuleSourcePackage } from '../../../common/downloader/package';
import { parsePackageInfoOutput } from '../../../utils/package-manager';
import { error as errorUI, warning, info, success } from '../../../utils/cli-ui';

interface UpdateOptions {
  project: string;
  env?: string;
  dryRun: boolean;
}

export default function () {
  return new Command('update')
    .description(`Update modules to latest versions\n` + `Checks for and applies module updates from npm`)
    .argument('[modules...]', 'Specific modules to update (default: all)')
    .addOption(Options.project)
    .addOption(new Option('-e, --env <environment>', 'Environment to update modules in').env('ANTELOPEJS_LAUNCH_ENV'))
    .addOption(new Option('--dry-run', 'Show what would be updated without making changes').default(false))
    .action(async (modules: string[], options: UpdateOptions) => {
      info(chalk.blue`Checking for module updates...`);

      const config = await readConfig(options.project);
      if (!config) {
        errorUI(chalk.red`No project configuration found at: ${options.project}`);
        info(`Make sure you're in an AntelopeJS project or use the --project option.`);
        process.exitCode = 1;
        return;
      }

      const env = options.env ? config?.environments && config?.environments[options.env] : config;
      if (!env) {
        errorUI(chalk.red`Environment ${options.env || 'default'} not found in project config`);
        process.exitCode = 1;
        return;
      }

      if (!env.modules || Object.keys(env.modules).length === 0) {
        errorUI(chalk.red`No modules installed in this environment`);
        return;
      }

      const antelopeConfig = await LoadConfig(options.project, options.env || 'default');

      // If no modules specified, check all npm modules
      const modulesToUpdate =
        modules.length > 0
          ? modules
          : Object.entries(antelopeConfig.modules)
              .filter(([_, info]) => info.source?.type === 'package')
              .map(([name]) => name);

      if (modulesToUpdate.length === 0) {
        errorUI(chalk.red`No npm modules found to update`);
        info(`Only npm modules can be automatically updated.`);
        return;
      }

      // Track results
      const updated: string[] = [];
      const skipped: string[] = [];
      const notFound: string[] = [];

      for (const module of modulesToUpdate) {
        const moduleInfo = antelopeConfig.modules[module];

        if (!moduleInfo) {
          warning(chalk.yellow`Module ${chalk.bold(module)} not found in project`);
          notFound.push(module);
          continue;
        }

        if (!moduleInfo.source || moduleInfo.source.type !== 'package') {
          info(`${chalk.bold(module)}: Skipped (not an npm package)`);
          skipped.push(module);
          continue;
        }

        info(`${chalk.bold(module)}: Checking for updates...`);

        try {
          const result = await ExecuteCMD(`npm view ${module} version`, {});
          if (result.code !== 0) {
            throw new Error(`Failed to fetch version: ${result.stderr}`);
          }
          const latestVersion = parsePackageInfoOutput(result.stdout);
          const currentVersion = (moduleInfo.source as ModuleSourcePackage).version;

          if (currentVersion === latestVersion) {
            info(`${chalk.bold(module)}: ${chalk.green('Already up to date')} (${currentVersion})`);
            skipped.push(module);
            continue;
          }

          if (!options.dryRun) {
            env.modules[module] = {
              ...moduleInfo,
              source: {
                ...(moduleInfo.source as ModuleSourcePackage),
                version: latestVersion,
              } as ModuleSourcePackage,
            };
            updated.push(`${module}: ${chalk.dim(currentVersion)} → ${latestVersion}`);
          } else {
            updated.push(`${module}: ${chalk.dim(currentVersion)} → ${latestVersion}`);
          }
        } catch (err) {
          errorUI(chalk.red`${chalk.bold(module)}: Error: ${err instanceof Error ? err.message : String(err)}`);
          skipped.push(module);
        }
      }

      // Save changes
      if (updated.length > 0 && !options.dryRun) {
        await writeConfig(options.project, config);
      }

      // Display results
      if (options.dryRun) {
        warning(chalk.yellow`Dry run - no changes were made`);
      }

      if (updated.length > 0) {
        success(chalk.green`${options.dryRun ? 'Would update' : 'Updated'} ${updated.length} module(s):`);
        updated.forEach((msg) => {
          info(`  ${chalk.green('•')} ${msg}`);
        });
      } else {
        success(chalk.green`All modules are up to date!`);
      }

      if (notFound.length > 0) {
        warning(chalk.yellow`${notFound.length} module(s) not found in project:`);
        notFound.forEach((name) => {
          info(`  ${chalk.yellow('•')} ${chalk.bold(name)}`);
        });
      }

      // Add helpful guidance
      if (updated.length > 0 && !options.dryRun) {
        info(`Run ${chalk.bold('ajs project run')} to use the updated modules.`);
      }
    });
}
