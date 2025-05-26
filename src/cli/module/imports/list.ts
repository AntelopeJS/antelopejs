import chalk from 'chalk';
import { Command, Option } from 'commander';
import { Options, readModuleManifest, readConfig } from '../../common';
import path from 'path';
import { AntelopeModuleSourceConfig } from '../../../common/config';
import { displayBox, error, info, warning } from '../../../utils/cli-ui';

interface ListOptions {
  module: string;
  verbose: boolean;
}

export default function () {
  return new Command('list')
    .alias('ls')
    .description(
      `List all imports of an AntelopeJS module\n` + `Shows required and optional module imports with their sources`,
    )
    .addOption(Options.module)
    .addOption(new Option('-v, --verbose', 'Show detailed information including overrides').default(false))
    .action(async (options: ListOptions) => {
      console.log(''); // Add spacing for better readability
      info(`Fetching imports for module...`);

      const moduleManifest = await readModuleManifest(options.module);
      if (!moduleManifest) {
        error(`Failed to read package.json at ${chalk.bold(options.module)}`);
        console.log(`Make sure you're in a valid AntelopeJS module directory.`);
        return;
      }

      if (!moduleManifest.antelopeJs) {
        warning(`No AntelopeJS configuration found in package.json`);
        console.log(`This doesn't appear to be an AntelopeJS module.`);
        return;
      }

      // Get project config to check for import overrides
      const projectConfig = await readConfig(path.dirname(options.module));
      const moduleId = moduleManifest.name;
      const moduleConfig = projectConfig?.modules?.[moduleId] as AntelopeModuleSourceConfig | undefined;
      const importOverrides = moduleConfig?.importOverrides || [];

      // Build content for display box
      let content = `${chalk.bold.blue(`Module: ${moduleManifest.name} (${moduleManifest.version})`)}\n`;
      content += `${chalk.blue('─'.repeat(30))}\n\n`;

      // Required imports section
      content += chalk.bold.blue('Required Imports:') + '\n';
      if (!moduleManifest.antelopeJs.imports || moduleManifest.antelopeJs.imports.length === 0) {
        content += chalk.italic`  No required imports defined\n`;
      } else {
        moduleManifest.antelopeJs.imports.forEach((importItem) => {
          const importName = typeof importItem === 'string' ? importItem : importItem.name;
          const gitSource =
            typeof importItem === 'string' ? '' : importItem.git ? ` (from ${chalk.cyan(importItem.git)})` : '';
          const skipInstallFlag =
            typeof importItem === 'object' && importItem.skipInstall ? ` ${chalk.magenta('[skip-install]')}` : '';
          content += `  ${chalk.green('•')} ${chalk.bold(importName)}${gitSource}${skipInstallFlag}\n`;

          // Show override if exists and verbose mode is on
          if (options.verbose && importOverrides && Array.isArray(importOverrides)) {
            const override = importOverrides.find(
              (item) => item.interface === importName || item.interface === importName.split('@')[0],
            );
            if (override) {
              content += `    ${chalk.dim('↳')} ${chalk.yellow('Overridden:')} ${override.source}\n`;
            }
          }
        });
      }

      content += '\n';

      // Optional imports section
      content += chalk.bold.blue('Optional Imports:') + '\n';
      if (!moduleManifest.antelopeJs.importsOptional || moduleManifest.antelopeJs.importsOptional.length === 0) {
        content += chalk.italic`  No optional imports defined\n`;
      } else {
        moduleManifest.antelopeJs.importsOptional.forEach((importItem) => {
          const importName = typeof importItem === 'string' ? importItem : importItem.name;
          const gitSource =
            typeof importItem === 'string' ? '' : importItem.git ? ` (from ${chalk.cyan(importItem.git)})` : '';
          const skipInstallFlag =
            typeof importItem === 'object' && importItem.skipInstall ? ` ${chalk.magenta('[skip-install]')}` : '';
          content += `  ${chalk.yellow('•')} ${chalk.bold(importName)}${gitSource}${skipInstallFlag}\n`;

          // Show override if exists and verbose mode is on
          if (options.verbose && importOverrides && Array.isArray(importOverrides)) {
            const override = importOverrides.find(
              (item) => item.interface === importName || item.interface === importName.split('@')[0],
            );
            if (override) {
              content += `    ${chalk.dim('↳')} ${chalk.yellow('Overridden:')} ${override.source}\n`;
            }
          }
        });
      }

      // Show tips when imports exist
      const hasImports =
        (moduleManifest.antelopeJs.imports?.length || 0) + (moduleManifest.antelopeJs.importsOptional?.length || 0) > 0;

      // Display the module imports
      await displayBox(content, '📦 Module Imports', {
        padding: 1,
        borderColor: 'blue',
      });

      // Show help text
      if (hasImports && !options.verbose) {
        console.log('');
        console.log(chalk.dim`Use --verbose to see more details including overrides.`);
      }

      // Show module format for informational purposes when verbose
      if (options.verbose) {
        console.log('');
        console.log(chalk.dim`Module import format follows the pattern: interface@version`);
        console.log(chalk.dim`Use 'ajs module imports add <interface[@version]>' to add new imports.`);
      }
    });
}
