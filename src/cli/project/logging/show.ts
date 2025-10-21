import chalk from 'chalk';
import { Command, Option } from 'commander';
import { Options, readConfig } from '../../common';
import { LoadConfig } from '../../../common/config';
import { defaultConfigLogging, levelNames } from '../../../logging';
import { mergeDeep } from '../../../utils/object';
import { displayBox, header, error, keyValue, warning } from '../../../utils/cli-ui';

interface ShowOptions {
  project: string;
  env?: string;
  json: boolean;
}

export default function () {
  return new Command('show')
    .alias('ls')
    .description(`Show project logging configuration\n` + `Display the current logging settings for the project`)
    .addOption(Options.project)
    .addOption(new Option('-e, --env <environment>', 'Environment to show').env('ANTELOPEJS_LAUNCH_ENV'))
    .addOption(new Option('-j, --json', 'Output in JSON format').default(false))
    .action(async (options: ShowOptions) => {
      console.log(''); // Add spacing for better readability

      const config = await readConfig(options.project);
      if (!config) {
        error(`No project configuration found at: ${chalk.bold(options.project)}`);
        warning(`Make sure you're in an AntelopeJS project or use the --project option.`);
        process.exitCode = 1;
        return;
      }

      const antelopeConfig = await LoadConfig(options.project, options.env || 'default');
      const logging = mergeDeep({}, defaultConfigLogging, antelopeConfig.logging);
      const projectName = config.name;

      // JSON output mode
      if (options.json) {
        console.log(JSON.stringify(logging, null, 2));
        return;
      }

      // Pretty output mode
      const formatStatus = (status: boolean) => (status ? chalk.green('enabled') : chalk.red('disabled'));

      // Create the heading with project and environment info
      const title = `📋 Logging Configuration: ${chalk.cyan(projectName)}${
        options.env ? ` (${chalk.yellow(options.env)})` : ''
      }`;

      // Build up the sections for our display
      let content = `${keyValue('Logging', formatStatus(logging.enabled))}\n\n`;

      // Module tracking section
      content += `${chalk.blue.bold('Module Tracking:')}\n`;
      content += `${keyValue('Status', formatStatus(logging.moduleTracking.enabled))}\n`;

      if (logging.moduleTracking.enabled) {
        const includes = logging.moduleTracking.includes || [];
        const excludes = logging.moduleTracking.excludes || [];

        // Show tracking mode
        if (includes.length > 0) {
          content += `${keyValue('Mode', chalk.cyan('Whitelist') + ' - only log selected modules')}\n`;
        } else if (excludes.length > 0) {
          content += `${keyValue('Mode', chalk.yellow('Blacklist') + ' - log all except excluded ones')}\n`;
        } else {
          content += `${keyValue('Mode', chalk.green('All') + ' - log all modules')}\n`;
        }

        // Show included modules
        if (includes.length > 0) {
          content += `\n${chalk.cyan('Included Modules:')}\n`;
          includes.forEach((module: string) => {
            content += `  • ${chalk.cyan(module)}\n`;
          });
        } else if (includes.length === 0 && excludes.length === 0) {
          content += `\n${keyValue('Included Modules', chalk.dim('none'))}\n`;
        }

        // Show excluded modules
        if (excludes.length > 0) {
          content += `\n${chalk.yellow('Excluded Modules:')}\n`;
          excludes.forEach((module: string) => {
            content += `  • ${chalk.yellow(module)}\n`;
          });
        } else if (includes.length === 0 && excludes.length === 0) {
          content += `\n${keyValue('Excluded Modules', chalk.dim('none'))}\n`;
        }
      }

      // Log formatters section
      content += `\n${chalk.blue.bold('Log Formatters:')}\n`;
      Object.entries(logging.formatter).forEach(([level, format]) => {
        // Convert numeric level to string name
        const levelName = levelNames[parseInt(level)] || level;
        content += `  ${chalk.cyan(levelName.padEnd(8))}: ${chalk.dim(format)}\n`;
      });

      // Date Format section
      content += `\n${chalk.blue.bold('Date Format:')}\n`;
      content += `  ${chalk.dim(logging.dateFormat || defaultConfigLogging.dateFormat)}\n`;

      // Display the configuration box
      await displayBox(content, title, {
        padding: 1,
        borderColor: 'blue',
      });

      // Help section
      header('Configuration Tips');
      console.log(`• Use ${chalk.cyan('ajs project logging set --enable')} to enable logging`);
      console.log(`• Include specific modules with ${chalk.cyan('--includeModule <n>')}`);
      console.log(`• Format string variables: ${chalk.dim('DATE, LEVEL_NAME, ARGS, MODULE_NAME')}`);
      console.log(`• Configure date format with ${chalk.cyan('--dateFormat "yyyy-MM-dd HH:mm:ss"')}`);
      console.log(`• Try ${chalk.cyan('--interactive')} for a guided configuration experience`);
      console.log('');
    });
}
