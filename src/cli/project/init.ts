import chalk from 'chalk';
import { Command } from 'commander';
import inquirer from 'inquirer';
import path from 'path';
import { readConfig, writeConfig } from '../common';
import { handlers, projectModulesAddCommand } from './modules/add';
import { moduleInitCommand } from '../module/init';
import { Spinner, displayBox, error, info, warning } from '../../utils/cli-ui';
import { mkdir, stat } from 'fs/promises';

export default function () {
  return new Command('init')
    .description(
      `Create a new AntelopeJS project\n` +
        `Creates a new project with an antelope.json file and optionally sets up your first module.`,
    )
    .argument('<project>', 'Directory path for the new project')
    .action(async (project: string) => {
      console.log(''); // Add some spacing for better readability

      // Check if project already exists
      const spinner = new Spinner('Checking project path');
      await spinner.start();

      if (await readConfig(project)) {
        await spinner.fail(`Project already exists at ${chalk.bold(project)}`);
        warning(chalk.yellow`Use a different directory or delete the existing project.`);
        return;
      }

      await spinner.succeed(`Project path ${chalk.bold(project)} is available`);

      // Display welcome message
      console.log('');
      info('Welcome to the AntelopeJS project creation wizard!');
      console.log(chalk.dim('Please provide the following information to set up your project.'));
      console.log('');

      // Prompt for project details
      const answers = await inquirer.prompt<{
        name: string;
        version: string;
        description: string;
        author: string;
      }>([
        {
          type: 'input',
          name: 'name',
          message: 'What would you like to name your project?',
          default: path.basename(project),
        },
      ]);

      // Create project configuration
      const configSpinner = new Spinner('Creating project configuration');
      await configSpinner.start();

      // Create the project directory if it doesn't exist
      const projectDirExists = await stat(project).catch(() => false);
      if (!projectDirExists) {
        await mkdir(project, { recursive: true });
        await configSpinner.update(`Created project directory at ${chalk.bold(project)}`);
      }

      await writeConfig(project, answers);
      await configSpinner.succeed('Project configuration created successfully');

      console.log('');

      // Ask about app module
      const { blmodule } = await inquirer.prompt<{ blmodule: boolean }>([
        {
          type: 'confirm',
          name: 'blmodule',
          message: 'Do you have an existing app module you want to import?',
          default: false,
        },
      ]);

      if (blmodule) {
        const { source } = await inquirer.prompt<{ source: string }>([
          {
            type: 'list',
            name: 'source',
            message: 'Where is your app module located?',
            choices: [...handlers.keys()].filter((key) => key !== 'dir'),
          },
        ]);

        const { module } = await inquirer.prompt<{ module: string }>([
          {
            type: 'input',
            name: 'module',
            message: `Please specify the ${source} source location:
  • npm: Package name (e.g., "my-package")
  • git: Repository URL (e.g., "https://github.com/user/repo")
  • local: Relative path to module (e.g., "../my-module")`,
          },
        ]);

        await projectModulesAddCommand([module], { mode: source, project });
      } else {
        const { init } = await inquirer.prompt<{ init: boolean }>([
          {
            type: 'confirm',
            name: 'init',
            message: 'Would you like to create a new app module now?',
            default: true,
          },
        ]);

        if (init) {
          try {
            await moduleInitCommand(project, {}, true);
            await projectModulesAddCommand(['.'], { mode: 'local', project });
          } catch (err) {
            console.log('');
            if (err instanceof Error) {
              error(`Failed to create module: ${err.message}`);
            } else {
              error(`Failed to create module: ${String(err)}`);
            }
            error('Project creation stopped due to module initialization failure.');
            return;
          }
        }
      }

      // Display success message
      console.log('');
      await displayBox(
        `Your AntelopeJS project ${chalk.green.bold(answers.name)} has been successfully initialized!\n\n` +
          `${chalk.dim('To get started, run:')}\n` +
          `${project !== '.' ? chalk.cyan(`cd ${project}`) + '\n' : ''}` +
          `${chalk.cyan('ajs project modules fix')}\n` +
          `${chalk.cyan('ajs project run -w')}`,
        '🚀 Project Created',
        { borderColor: 'green' },
      );
    });
}
