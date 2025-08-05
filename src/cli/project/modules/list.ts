import chalk from 'chalk';
import { Command, Option } from 'commander';
import { LoadConfig } from '../../../common/config';
import { Options, readConfig } from '../../common';
import { displayBox, error, info, keyValue, warning } from '../../../utils/cli-ui';
import { ModuleSourcePackage } from '../../../common/downloader/package';
import { ModuleSourceGit } from '../../../common/downloader/git';
import { ModuleSourceLocal } from '../../../common/downloader/local';

interface ListOptions {
  project: string;
  env?: string;
}

export default function () {
  return new Command('list')
    .alias('ls')
    .description(
      `List installed modules in your project\n` +
        `Display all modules configured in the project with their source information.`,
    )
    .addOption(Options.project)
    .addOption(new Option('-e, --env <environment>', 'Environment to list modules from').env('ANTELOPEJS_LAUNCH_ENV'))
    .action(async (options: ListOptions) => {
      console.log(''); // Add spacing for better readability

      const config = await readConfig(options.project);
      if (!config) {
        error(`No project configuration found at: ${chalk.bold(options.project)}`);
        warning(`Make sure you're in an AntelopeJS project or use the --project option.`);
        return;
      }

      const antelopeConfig = await LoadConfig(options.project, options.env || 'default');
      const modules = antelopeConfig.modules;
      const projectName = config.name;

      // Check if there are any modules
      const moduleEntries = Object.entries(modules);
      if (moduleEntries.length === 0) {
        const title = `📦 Installed Modules: ${chalk.cyan(projectName)}${
          options.env ? ` (${chalk.yellow(options.env)})` : ''
        }`;

        await displayBox(
          `${chalk.dim('No modules installed in this project.')}\n\n` +
            `Use ${chalk.bold('ajs project modules add <module>')} to add modules.`,
          title,
          {
            padding: 1,
            borderColor: 'yellow',
          },
        );
        return;
      }

      // Build the content for display
      let content = '';

      for (const [moduleName, moduleConfig] of moduleEntries) {
        content += `${chalk.bold.blue('●')} ${chalk.bold(moduleName)}\n`;

        const source = moduleConfig.source;
        if (!source) {
          content += `  ${keyValue('Type', chalk.gray('unknown'))}\n`;
          content += `  ${keyValue('Source', JSON.stringify(moduleConfig))}\n`;
          continue;
        }

        // Display source information
        switch (source.type) {
          case 'package': {
            const packageSource = source as ModuleSourcePackage;
            content += `  ${keyValue('Type', chalk.green('npm package'))}\n`;
            content += `  ${keyValue('Package', packageSource.package)}\n`;
            content += `  ${keyValue('Version', packageSource.version)}\n`;
            break;
          }

          case 'git': {
            const gitSource = source as ModuleSourceGit;
            content += `  ${keyValue('Type', chalk.blue('git repository'))}\n`;
            content += `  ${keyValue('Remote', gitSource.remote)}\n`;
            if (gitSource.branch) {
              content += `  ${keyValue('Branch', gitSource.branch)}\n`;
            }
            if (gitSource.commit) {
              content += `  ${keyValue('Commit', gitSource.commit.substring(0, 8))}\n`;
            }
            break;
          }

          case 'local':
          case 'local-folder': {
            const localSource = source as ModuleSourceLocal;
            content += `  ${keyValue('Type', chalk.yellow('local directory'))}\n`;
            content += `  ${keyValue('Path', localSource.path)}\n`;
            break;
          }

          default:
            content += `  ${keyValue('Type', chalk.gray('unknown'))}\n`;
            content += `  ${keyValue('Source', JSON.stringify(source))}\n`;
        }

        content += '\n';
      }

      // Remove trailing newline
      content = content.trim();

      const title = `📦 Installed Modules: ${chalk.cyan(projectName)}${
        options.env ? ` (${chalk.yellow(options.env)})` : ''
      }`;

      await displayBox(content, title, {
        padding: 1,
        borderColor: 'green',
      });

      // Show summary
      info(`Found ${chalk.bold(moduleEntries.length)} module${moduleEntries.length === 1 ? '' : 's'} installed.`);
    });
}
