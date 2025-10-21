import chalk from 'chalk';
import { Command, Option } from 'commander';
import { Options, readConfig, writeConfig } from '../../common';
import { defaultConfigLogging } from '../../../logging';
import inquirer from 'inquirer';
import { displayBox, error, info, success, warning } from '../../../utils/cli-ui';

interface SetOptions {
  project: string;
  env?: string;
  enable?: boolean;
  disable?: boolean;
  enableModuleTracking?: boolean;
  disableModuleTracking?: boolean;
  includeModule?: string;
  excludeModule?: string;
  removeInclude?: string;
  removeExclude?: string;
  interactive?: boolean;
  formatter?: string;
  level?: string;
  format?: string;
  dateFormat?: string;
}

// Map the levelMap numeric values to strings for command options
const levelStringMap: Record<string, string> = {
  trace: '0',
  debug: '10',
  info: '20',
  warn: '30',
  error: '40',
  default: 'default',
};

export default function () {
  return new Command('set')
    .description(`Configure project logging settings\n` + `Enable/disable logging and set up module tracking`)
    .addOption(Options.project)
    .addOption(new Option('-e, --env <environment>', 'Environment to configure').env('ANTELOPEJS_LAUNCH_ENV'))
    .addOption(new Option('--enable', 'Enable logging'))
    .addOption(new Option('--disable', 'Disable logging'))
    .addOption(new Option('--enableModuleTracking', 'Enable module tracking'))
    .addOption(new Option('--disableModuleTracking', 'Disable module tracking'))
    .addOption(new Option('--includeModule <module>', 'Add module to include list'))
    .addOption(new Option('--excludeModule <module>', 'Add module to exclude list'))
    .addOption(new Option('--removeInclude <module>', 'Remove module from include list'))
    .addOption(new Option('--removeExclude <module>', 'Remove module from exclude list'))
    .addOption(
      new Option('--level <level>', 'Set log level formatter').choices([
        'trace',
        'debug',
        'info',
        'warn',
        'error',
        'default',
      ]),
    )
    .addOption(new Option('--format <format>', 'Format string for the selected level'))
    .addOption(new Option('--dateFormat <format>', 'Set date format for logs (e.g. "yyyy-MM-dd HH:mm:ss")'))
    .addOption(new Option('-i, --interactive', 'Interactive configuration mode').default(false))
    .action(async (options: SetOptions) => {
      console.log(''); // Add spacing for better readability

      const config = await readConfig(options.project);
      if (!config) {
        error(`No project configuration found at: ${chalk.bold(options.project)}`);
        console.log(`Make sure you're in an AntelopeJS project or use the --project option.`);
        process.exitCode = 1;
        return;
      }

      const projectName = config.name;
      const env =
        options.env && options.env !== 'default' ? config?.environments && config?.environments[options.env] : config;

      if (!env) {
        error(`Environment ${options.env || 'default'} not found in project config`);
        process.exitCode = 1;
        return;
      }

      // Initialize logging config if not present
      if (!env.logging) {
        env.logging = JSON.parse(JSON.stringify(defaultConfigLogging));
      }

      // Initialize moduleTracking if needed
      if (env.logging && !env.logging.moduleTracking) {
        env.logging.moduleTracking = {
          enabled: false,
          includes: [],
          excludes: [],
        };
      }

      // If no options were provided, enable interactive mode
      if (
        !options.enable &&
        !options.disable &&
        !options.enableModuleTracking &&
        !options.disableModuleTracking &&
        !options.includeModule &&
        !options.excludeModule &&
        !options.removeInclude &&
        !options.removeExclude &&
        !options.level &&
        !options.format &&
        !options.dateFormat &&
        !options.interactive
      ) {
        options.interactive = true;
      }

      // Handle interactive mode
      if (options.interactive) {
        await configureInteractively(projectName, env, options.env);
        await writeConfig(options.project, config);
        return;
      }

      // Process command line options
      const changes: string[] = [];

      // Basic toggles
      if (options.enable && env.logging) {
        env.logging.enabled = true;
        changes.push(chalk.green('Enabled logging'));
      }

      if (options.disable && env.logging) {
        env.logging.enabled = false;
        changes.push(chalk.red('Disabled logging'));
      }

      if (options.enableModuleTracking && env.logging?.moduleTracking) {
        env.logging.moduleTracking.enabled = true;
        changes.push(chalk.green('Enabled module tracking'));
      }

      if (options.disableModuleTracking && env.logging?.moduleTracking) {
        env.logging.moduleTracking.enabled = false;
        changes.push(chalk.red('Disabled module tracking'));
      }

      // Date format setting
      if (options.dateFormat && env.logging) {
        env.logging.dateFormat = options.dateFormat;
        const msg = `Set date format to: ${chalk.dim(options.dateFormat)}`;
        changes.push(chalk.cyan(msg));
      }

      // Module lists
      if (options.includeModule && env.logging?.moduleTracking?.includes) {
        if (!env.logging.moduleTracking.includes.includes(options.includeModule)) {
          env.logging.moduleTracking.includes.push(options.includeModule);
          const msg = `Added module ${chalk.bold(options.includeModule)} to include list`;
          changes.push(chalk.cyan(msg));
        } else {
          const msg = `Module ${chalk.bold(options.includeModule)} already in include list`;
          changes.push(chalk.yellow(msg));
        }
      }

      if (options.excludeModule && env.logging?.moduleTracking?.excludes) {
        if (!env.logging.moduleTracking.excludes.includes(options.excludeModule)) {
          env.logging.moduleTracking.excludes.push(options.excludeModule);
          const msg = `Added module ${chalk.bold(options.excludeModule)} to exclude list`;
          changes.push(chalk.yellow(msg));
        } else {
          const msg = `Module ${chalk.bold(options.excludeModule)} already in exclude list`;
          changes.push(chalk.yellow(msg));
        }
      }

      // Remove from lists
      if (options.removeInclude && env.logging?.moduleTracking?.includes) {
        const index = env.logging.moduleTracking.includes.indexOf(options.removeInclude);
        if (index !== -1) {
          env.logging.moduleTracking.includes.splice(index, 1);
          const msg = `Removed module ${chalk.bold(options.removeInclude)} from include list`;
          changes.push(chalk.cyan(msg));
        } else {
          const msg = `Module ${chalk.bold(options.removeInclude)} not found in include list`;
          changes.push(chalk.yellow(msg));
        }
      }

      if (options.removeExclude && env.logging?.moduleTracking?.excludes) {
        const index = env.logging.moduleTracking.excludes.indexOf(options.removeExclude);
        if (index !== -1) {
          env.logging.moduleTracking.excludes.splice(index, 1);
          const msg = `Removed module ${chalk.bold(options.removeExclude)} from exclude list`;
          changes.push(chalk.cyan(msg));
        } else {
          const msg = `Module ${chalk.bold(options.removeExclude)} not found in exclude list`;
          changes.push(chalk.yellow(msg));
        }
      }

      // Format strings
      if (options.level && options.format && env.logging) {
        const levelKey = levelStringMap[options.level];
        if (levelKey) {
          if (!env.logging.formatter) {
            env.logging.formatter = {};
          }
          env.logging.formatter[levelKey] = options.format;
          const levelUpper = options.level.toUpperCase();
          const msg = `Set ${chalk.bold(levelUpper)} format to: ${chalk.dim(options.format)}`;
          changes.push(chalk.cyan(msg));
        }
      }

      // Save configuration
      await writeConfig(options.project, config);

      // Show results
      if (changes.length > 0) {
        let content = '';

        content += `${chalk.bold.cyan(`Project: ${projectName}${options.env ? ` (${options.env})` : ''}`)}\n`;
        content += `${chalk.cyan('─'.repeat(40))}\n\n`;

        changes.forEach((change) => {
          content += `  ${change}\n`;
        });

        await displayBox(content, '🔧 Logging Configuration Updated', {
          padding: 1,
          borderColor: 'blue',
        });

        success(`Configuration saved successfully.`);
        console.log(`Use ${chalk.cyan('ajs project logging show')} to view current settings.`);
      } else {
        warning(`No changes were made to the logging configuration.`);
      }
    });
}

// Interactive configuration mode
async function configureInteractively(projectName: string, env: any, envName?: string) {
  console.log('');
  info(`Configuring logging for ${chalk.bold(projectName)}${envName ? ` (${envName})` : ''}`);
  console.log('');

  // Enable/disable logging
  const { enableLogging } = await inquirer.prompt<{ enableLogging: boolean }>([
    {
      type: 'confirm',
      name: 'enableLogging',
      message: 'Enable logging?',
      default: env.logging.enabled,
    },
  ]);

  env.logging.enabled = enableLogging;

  if (!enableLogging) {
    warning(`Logging has been disabled.`);
    return;
  }

  // Module tracking
  const { enableModuleTracking } = await inquirer.prompt<{ enableModuleTracking: boolean }>([
    {
      type: 'confirm',
      name: 'enableModuleTracking',
      message: 'Enable module tracking?',
      default: env.logging.moduleTracking.enabled,
    },
  ]);

  env.logging.moduleTracking.enabled = enableModuleTracking;

  if (enableModuleTracking) {
    const { trackingMode } = await inquirer.prompt<{ trackingMode: string }>([
      {
        type: 'list',
        name: 'trackingMode',
        message: 'Select module tracking mode:',
        choices: [
          { name: 'Log all modules', value: 'all' },
          { name: 'Only log specific modules (whitelist)', value: 'whitelist' },
          { name: 'Log all except specific modules (blacklist)', value: 'blacklist' },
        ],
        default:
          env.logging.moduleTracking.includes.length > 0
            ? 'whitelist'
            : env.logging.moduleTracking.excludes.length > 0
              ? 'blacklist'
              : 'all',
      },
    ]);

    if (trackingMode === 'whitelist') {
      // Handle include list
      await handleModuleList(
        env.logging.moduleTracking.includes,
        'Enter module name to include (empty to finish):',
        'Included modules:',
      );

      // Clear exclude list in whitelist mode
      env.logging.moduleTracking.excludes = [];
    } else if (trackingMode === 'blacklist') {
      // Handle exclude list
      await handleModuleList(
        env.logging.moduleTracking.excludes,
        'Enter module name to exclude (empty to finish):',
        'Excluded modules:',
      );

      // Clear include list in blacklist mode
      env.logging.moduleTracking.includes = [];
    } else {
      // Clear both lists in 'all' mode
      env.logging.moduleTracking.includes = [];
      env.logging.moduleTracking.excludes = [];
    }
  }

  // Format strings
  const { configureFormatters } = await inquirer.prompt<{ configureFormatters: boolean }>([
    {
      type: 'confirm',
      name: 'configureFormatters',
      message: 'Do you want to configure log formatters?',
      default: false,
    },
  ]);

  if (configureFormatters) {
    const levels = ['trace', 'debug', 'info', 'warn', 'error', 'default'];

    for (const level of levels) {
      const levelKey = levelStringMap[level];
      const defaultFormat = defaultConfigLogging.formatter ? defaultConfigLogging.formatter[levelKey] : '';
      const currentFormat = env.logging.formatter ? env.logging.formatter[levelKey] || defaultFormat : defaultFormat;

      const { customizeFormat } = await inquirer.prompt<{ customizeFormat: boolean }>([
        {
          type: 'confirm',
          name: 'customizeFormat',
          message: `Customize ${level.toUpperCase()} log format?`,
          default: false,
        },
      ]);

      if (customizeFormat) {
        const { format } = await inquirer.prompt<{ format: string }>([
          {
            type: 'input',
            name: 'format',
            message: `Enter format for ${level.toUpperCase()} level:`,
            default: currentFormat,
          },
        ]);

        if (!env.logging.formatter) {
          env.logging.formatter = {};
        }
        env.logging.formatter[levelKey] = format;
      }
    }
  }

  // Date format configuration
  const { configureDateFormat } = await inquirer.prompt<{ configureDateFormat: boolean }>([
    {
      type: 'confirm',
      name: 'configureDateFormat',
      message: 'Do you want to customize the date format?',
      default: false,
    },
  ]);

  if (configureDateFormat) {
    const currentDateFormat = env.logging.dateFormat || defaultConfigLogging.dateFormat;
    const { dateFormat } = await inquirer.prompt<{ dateFormat: string }>([
      {
        type: 'input',
        name: 'dateFormat',
        message: 'Enter date format:',
        default: currentDateFormat,
      },
    ]);

    env.logging.dateFormat = dateFormat;
    console.log(`${chalk.cyan('Date format set to:')} ${chalk.dim(dateFormat)}`);
    console.log(`${chalk.cyan('Format tokens:')} ${chalk.dim('yyyy, MM, dd, HH, mm, ss (padded values)')}`);
    console.log(`${chalk.cyan('Additional:')} ${chalk.dim('SSS (milliseconds), M, d, H, m, s (non-padded)')}`);
  }

  console.log('');
  success(`Logging configuration updated successfully.`);
}

// Helper function to manage module lists interactively
async function handleModuleList(list: string[], prompt: string, listTitle: string) {
  let done = false;

  // Display current list
  if (list.length > 0) {
    console.log(chalk.cyan(listTitle));
    for (let index = 0; index < list.length; index++) {
      const module = list[index];
      console.log(`  ${index + 1}. ${module}`);
    }
  }

  while (!done) {
    const { moduleName } = await inquirer.prompt<{ moduleName: string }>([
      {
        type: 'input',
        name: 'moduleName',
        message: prompt,
      },
    ]);

    if (!moduleName) {
      done = true;
      continue;
    }

    if (!list.includes(moduleName)) {
      list.push(moduleName);
      success(`Added ${chalk.bold(moduleName)} to the list.`);
    } else {
      warning(`Module ${chalk.bold(moduleName)} is already in the list.`);

      // Ask if they want to remove it
      const { removeModule } = await inquirer.prompt<{ removeModule: boolean }>([
        {
          type: 'confirm',
          name: 'removeModule',
          message: `Do you want to remove ${moduleName} from the list?`,
          default: false,
        },
      ]);

      if (removeModule) {
        const index = list.indexOf(moduleName);
        list.splice(index, 1);
        info(`Removed ${chalk.bold(moduleName)} from the list.`);
      }
    }
  }
}
