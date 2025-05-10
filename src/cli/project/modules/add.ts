import chalk from 'chalk';
import assert from 'assert';
import { Command, Option } from 'commander';
import { readFile, stat } from 'fs/promises';
import path from 'path';
import { AntelopeModuleSourceConfig, LoadConfig } from '../../../common/config';
import { Options, readConfig, writeConfig } from '../../common';
import { ExecuteCMD } from '../../../utils/command';
import inquirer from 'inquirer';
import { displayBox, error, info, success } from '../../../utils/cli-ui';
import { parsePackageInfoOutput } from '../../../utils/package-manager';

interface AddOptions {
  mode: string;
  project: string;
  env?: string;
}

export const handlers = new Map<
  string,
  (module: string, options: AddOptions) => Promise<[string, AntelopeModuleSourceConfig | string]>
>();

export async function projectModulesAddCommand(modules: string[], options: AddOptions) {
  console.log(''); // Add spacing for better readability
  info(`Adding modules to your project...`);

  let sources = await Promise.all(
    modules.map((module) => {
      console.log(
        // eslint-disable-next-line max-len
        `Adding ${chalk.bold(options.mode === 'local' || options.mode === 'dir' ? path.join(options.project, module) : module)} using ${options.mode} mode`,
      );
      return handlers.get(options.mode)!(module, options).catch((err) => {
        error(`Failed to add module "${module}": ${err.message || err}`);
        return null;
      });
    }),
  );

  // Filter out fhandlersconfig
  const config = await readConfig(options.project);
  if (!config) {
    error(`No project configuration found at: ${chalk.bold(options.project)}`);
    console.log(`Make sure you're in an AntelopeJS project or use the --project option.`);
    return;
  }

  // Get correct environment config
  const env =
    options.env && options.env !== 'default' ? config?.environments && config?.environments[options.env] : config;
  if (!env) {
    error(`Environment ${options.env || 'default'} not found in project config`);
    return;
  }

  if (!env.modules) {
    env.modules = {};
  }

  const antelopeConfig = await LoadConfig(options.project, options.env || 'default');

  // Track successful additions
  const added: string[] = [];
  const skipped: string[] = [];

  for (const source of sources) {
    if (!source) continue;

    let [moduleName, moduleConfig] = source;

    // Check if module already exists
    if (antelopeConfig.modules[moduleName]) {
      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Module ${chalk.yellow(moduleName)} already exists. Add with a different name?`,
        },
      ]);

      if (!confirm) {
        skipped.push(moduleName);
        continue;
      }

      // Create unique name
      const newName = `${moduleName}-${Object.keys(env.modules).filter((key) => key.startsWith(moduleName)).length}`;

      info(`Using name ${chalk.bold(newName)} instead of ${moduleName}`);
      moduleName = newName;
    }

    env.modules[moduleName] = moduleConfig;
    added.push(moduleName);
  }

  // Save the updated config
  await writeConfig(options.project, config);

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
      new Option('-m, --mode <mode>', 'Source type for the modules').choices([...handlers.keys()]).default('npm'),
    )
    .addOption(Options.project)
    .addOption(new Option('-e, --env <environment>', 'Environment to add modules to').env('ANTELOPEJS_LAUNCH_ENV'))
    .action(projectModulesAddCommand);
}

// Module source handlers

handlers.set('npm', async (module) => {
  const m = module.match(/^(.+?)(?:@(.*))?$/);
  assert(m, `Invalid npm module format: '${module}'. Use <name>@<version>, <name>version or <name>`);
  let [, name, version] = m;
  if (!version) {
    info(`Fetching latest version for ${chalk.bold(name)}...`);
    const [output, err] = await ExecuteCMD(`npm view ${name} version`, {});
    assert(!err, err);
    version = parsePackageInfoOutput(output);
    success(`Using version ${version}`);
  }
  return [name, version];
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
  const modulePath = path.join(options.project, module);
  assert((await stat(modulePath)).isDirectory(), `Path '${module}' is not a directory`);
  const packagePath = path.join(modulePath, 'package.json');
  assert((await stat(packagePath)).isFile(), `No package.json found in '${module}'`);
  const info = JSON.parse((await readFile(packagePath)).toString());
  return [
    info.name,
    {
      source: {
        type: 'local',
        path: path.relative(options.project, modulePath) || '.',
        installCommand: ['npx tsc'],
      },
    },
  ];
});

handlers.set('dir', async (module, options) => {
  const folderPath = path.join(options.project, module);
  assert((await stat(folderPath)).isDirectory(), `Path '${module}' is not a directory`);
  return [
    ':' + folderPath,
    {
      source: {
        type: 'local-folder',
        path: path.relative(options.project, folderPath) || '.',
        installCommand: ['npx tsc'],
      },
    },
  ];
});
