import chalk from 'chalk';
import { Command } from 'commander';
import { Options, readUserConfig, displayNonDefaultGitWarning } from '../common';
import path from 'path';
import { copyTemplate, loadInterfacesFromGit, loadManifestFromGit } from '../git';
import inquirer from 'inquirer';
import { existsSync, readdirSync } from 'fs';
import { moduleImportAddCommand } from './imports/add';
import { Spinner, displayBox, info, error, warning } from '../../utils/cli-ui';

interface InitOptions {
  git?: string;
}

export async function moduleInitCommand(modulePath: string, options: InitOptions, fromProject = false) {
  console.log(''); // Add spacing for readability

  // Check if directory is empty
  const dirSpinner = new Spinner(`Checking directory ${chalk.cyan(modulePath)}`);
  await dirSpinner.start();

  if (
    existsSync(path.join(modulePath)) &&
    modulePath !== '.' &&
    readdirSync(path.join(modulePath)).length > 0 &&
    !fromProject
  ) {
    dirSpinner.fail(`Directory is not empty`);
    error(`Directory ${chalk.bold(modulePath)} is not empty. Please use an empty directory.`);
    return;
  }

  await dirSpinner.succeed(`Directory is valid`);

  // Load git configuration
  const gitSpinner = new Spinner('Loading templates');
  await gitSpinner.start();

  const userConfig = await readUserConfig();
  const git = options.git || userConfig.git;

  // Display warning if using non-default git repository
  await displayNonDefaultGitWarning(git);

  try {
    const gitManifest = await loadManifestFromGit(git);
    await gitSpinner.succeed(`Found ${gitManifest.templates.length} templates`);

    // Display welcome message
    console.log('');
    info('Welcome to the AntelopeJS module creation wizard!');
    console.log(chalk.dim('Please select a template and provide the required information.'));
    console.log('');

    const templates = gitManifest.templates;

    // Prompt for template selection
    const { template: selectedTemplate } = await inquirer.prompt<{ template: string }>([
      {
        type: 'list',
        name: 'template',
        message: 'Choose a template for your module',
        choices: templates.map((template) => ({
          name: `${template.name} - ${chalk.dim('Module template')}`,
          value: template.name,
        })),
      },
    ]);

    const template = templates.find((template) => template.name === selectedTemplate);
    if (!template) {
      error(`Template ${chalk.bold(selectedTemplate)} does not exist`);
      return;
    }

    // Display template information
    console.log('');
    info(`Template: ${chalk.cyan(template.name)}`);

    // Copy and process template files
    console.log('');
    const copySpinner = new Spinner(`Creating module from template`);
    await copySpinner.start();

    await copyTemplate(template, path.join(modulePath));

    await copySpinner.succeed(`Module created successfully at ${chalk.cyan(path.resolve(modulePath))}`);

    // Load and select interfaces
    console.log('');
    const interfacesInfo = await loadInterfacesFromGit(git, gitManifest.starredInterfaces);
    const interfaceCount = Object.keys(interfacesInfo).length;

    if (interfaceCount === 0) {
      warning('No interfaces available for import');
    } else {
      // Prompt for interface selection
      console.log('');
      const { interfaces } = await inquirer.prompt<{ interfaces: string[] }>([
        {
          type: 'checkbox',
          name: 'interfaces',
          message: 'Select interfaces to import into your module',
          choices: Object.values(interfacesInfo).map((interfaceInfo) => ({
            name: `${chalk.cyan(interfaceInfo.name)} - ${chalk.dim(interfaceInfo.manifest.description)}`,
            value: interfaceInfo.name,
          })),
        },
      ]);

      if (interfaces.length > 0) {
        // Import selected interfaces
        await moduleImportAddCommand(interfaces, {
          git: options.git || undefined,
          optionnal: false,
          module: path.join(modulePath),
        });
      } else {
        info('No interfaces selected for import');
      }
    }

    // Display success message
    console.log('');
    await displayBox(
      `Your AntelopeJS module has been successfully created!\n\n` +
        `Template: ${chalk.green(template.name)}\n` +
        `Location: ${chalk.cyan(path.resolve(modulePath))}`,
      '🎉 Module Created',
      { borderColor: 'green' },
    );
  } catch (err) {
    await gitSpinner.fail('Failed to load templates');
    if (err instanceof Error) {
      error(err.message);
    } else {
      error(`Unknown error: ${String(err)}`);
    }
    return;
  }
}

export default function () {
  return new Command('init')
    .description(
      `Create a new AntelopeJS module\n` +
        `Walks you through setting up a new module using templates and lets you import interfaces.`,
    )
    .argument('<path>', 'Directory path for the new module')
    .addOption(Options.git)
    .action(moduleInitCommand);
}
